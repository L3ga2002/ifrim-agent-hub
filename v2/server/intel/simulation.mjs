import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Simulation Mode (M08 §12): what-if scenarios on DECLARED inputs — a scenario, never a prediction. The calculation is a small,
 * deterministic capacity model (same inputs → same result), inspectable line by line, with its units, period and version. A
 * missing input is never invented: the result is INSUFFICIENT_DATA with the list of what is missing. Ranges (min/max) give a
 * low/high band only when the owner supplies them. A simulation reserves nothing, changes no price, contacts no one and never
 * enters the real metrics; "turn into a proposal" creates a separate DRAFT decision that follows the normal decision flow.
 * A model may help explain a result elsewhere; it never fills a parameter and no code from a conversation is executed here.
 */
export const SIM_MODEL_VERSION = "capacity-1";
const FIELDS = Object.freeze({
  currentProjects: { unit: "proiecte", label: "Proiecte în lucru acum" },
  newProjects: { unit: "proiecte", label: "Proiecte noi (clienți noi)" },
  effortHoursPerProject: { unit: "ore/proiect", label: "Efort mediu pe proiect" },
  capacityHoursPerWeek: { unit: "ore/săptămână", label: "Capacitate disponibilă" },
  horizonWeeks: { unit: "săptămâni", label: "Orizont" },
  delayFactor: { unit: "×", label: "Factor de întârziere (1 = fără)" },
  pricePerProject: { unit: "RON/proiect", label: "Preț pe proiect (declarat de tine)" },
  costPerHour: { unit: "RON/oră", label: "Cost pe oră (declarat de tine)" },
});
const REQUIRED = ["currentProjects", "newProjects", "effortHoursPerProject", "capacityHoursPerWeek", "horizonWeeks"];

/** A number, or a { min, max } range; anything else is missing. */
function readValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && v !== null && ("min" in v || "max" in v)) {
    const min = Number(v.min); const max = Number(v.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return { invalid: true };
    return { min, max, range: true };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { invalid: true };
  return { min: n, max: n, range: false };
}
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

/** The capacity model. Pure: (inputs) → result. */
export function simulateCapacity(inputs = {}) {
  const values = {};
  const missing = [];
  const invalid = [];
  for (const key of Object.keys(FIELDS)) {
    const v = readValue(inputs[key]);
    if (v?.invalid) invalid.push(key);
    else if (v) values[key] = v;
    else if (REQUIRED.includes(key)) missing.push(key);
  }
  if (values.capacityHoursPerWeek && values.capacityHoursPerWeek.min === 0) invalid.push("capacityHoursPerWeek");
  if (values.horizonWeeks && values.horizonWeeks.min === 0) invalid.push("horizonWeeks");
  const assumptions = [
    "Efortul pe proiect e același pentru proiectele noi și cele în lucru (modelul nu știe altfel).",
    "Capacitatea e constantă pe orizont; nu modelează concedii, vânzări sau mentenanță în afara efortului declarat.",
    "Lucrul se face în ordinea sosirii (nicio prioritizare).",
  ];
  if (missing.length || invalid.length) {
    return { status: "INSUFFICIENT_DATA", modelVersion: SIM_MODEL_VERSION, missing: missing.map((k) => ({ key: k, ...FIELDS[k] })), invalid: invalid.map((k) => ({ key: k, ...FIELDS[k] })),
      assumptions, note: "Fără aceste intrări nu calculez nimic: nu completez parametri lipsă." };
  }
  const delay = values.delayFactor || { min: 1, max: 1, range: false };
  const at = (pick) => {
    const v = (k) => (values[k] ? (pick === "low" ? values[k].min : values[k].max) : null);
    // Low = optimistic (less work, more capacity); high = pessimistic.
    const projects = v("currentProjects") + v("newProjects");
    const effort = (pick === "low" ? values.effortHoursPerProject.min : values.effortHoursPerProject.max) * (pick === "low" ? delay.min : delay.max);
    const capacity = pick === "low" ? values.capacityHoursPerWeek.max : values.capacityHoursPerWeek.min;
    const horizon = values.horizonWeeks.min;
    const totalHours = projects * effort;
    const weeksNeeded = totalHours / capacity;
    const available = capacity * horizon;
    const utilization = totalHours / available;
    const finishedInHorizon = Math.min(projects, Math.floor(available / effort));
    const out = { projects, effortHoursPerProject: round(effort), capacityHoursPerWeek: capacity, totalHours: round(totalHours), weeksNeeded: round(weeksNeeded), utilizationPct: round(utilization * 100),
      finishedInHorizon, backlogAtHorizon: Math.max(0, projects - finishedInHorizon) };
    if (values.pricePerProject) out.revenueIfAllDelivered = round(projects * (pick === "low" ? values.pricePerProject.max : values.pricePerProject.min), 0);
    if (values.costPerHour) out.laborCost = round(totalHours * (pick === "low" ? values.costPerHour.min : values.costPerHour.max), 0);
    return out;
  };
  const anyRange = Object.values(values).some((v) => v.range) || delay.range;
  const low = at("low");
  const high = anyRange ? at("high") : null;
  const verdict = (r) => (r.utilizationPct > 100 ? "PESTE_CAPACITATE" : r.utilizationPct > 85 ? "LA_LIMITĂ" : "ÎN_CAPACITATE");
  return {
    status: "COMPUTED", modelVersion: SIM_MODEL_VERSION, inputs: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { ...v, ...FIELDS[k] }])),
    result: anyRange ? { optimistic: low, pessimistic: high } : { single: low },
    verdict: anyRange ? { optimistic: verdict(low), pessimistic: verdict(high) } : { single: verdict(low) },
    formula: [
      "ore totale = (proiecte în lucru + proiecte noi) × efort pe proiect × factor de întârziere",
      "săptămâni necesare = ore totale ÷ capacitate pe săptămână",
      "utilizare = ore totale ÷ (capacitate × orizont)",
      "proiecte terminate în orizont = min(proiecte, ⌊capacitate × orizont ÷ efort⌋)",
      ...(values.pricePerProject ? ["venit DACĂ toate sunt livrate și plătite = proiecte × preț (un scenariu, nu un venit)"] : []),
    ],
    assumptions, scenario: true, note: "Scenariu pe intrările tale; nu e o predicție și nu schimbă nimic în Hub.",
  };
}

export function createSimulations({ db, bus, clock }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, title: r.title, modelVersion: r.model_version, inputs: parse(r.inputs_json, {}), result: parse(r.result_json, {}), status: r.status, createdBy: r.created_by,
    proposalRef: r.proposal_ref, createdAt: r.created_at, simulated: true });

  /** Observations from the Hub's own data that the owner MAY use as inputs (shown with their sample; never applied silently). */
  function observedInputs() {
    const rows = db.prepare(`SELECT fm.mission_id, fm.started_at, p.source,
      (SELECT MIN(e.created_at) FROM events e WHERE e.type = 'factory.stage' AND e.scope_id = fm.mission_id AND json_extract(e.payload_json, '$.stage') = 'DELIVERY_READY') AS ready_at
      FROM factory_missions fm JOIN missions m ON m.id = fm.mission_id JOIN projects p ON p.id = m.project_id WHERE fm.started_at IS NOT NULL`).all();
    const durations = rows.filter((r) => r.ready_at).map((r) => ({ minutes: (new Date(r.ready_at) - new Date(r.started_at)) / 60000, test: r.source === "hub-test" }));
    const real = durations.filter((d) => !d.test);
    const sorted = (list) => list.map((d) => d.minutes).sort((a, b) => a - b);
    const median = (list) => { const s = sorted(list); return s.length ? round(s[Math.floor(s.length / 2)], 0) : null; };
    return {
      deliveredMissions: { all: durations.length, realProjects: real.length, testProjects: durations.length - real.length },
      medianMissionMinutes: { realProjects: median(real), testProjects: median(durations.filter((d) => d.test)) },
      activeProjects: db.prepare("SELECT COUNT(DISTINCT m.project_id) AS n FROM factory_missions fm JOIN missions m ON m.id = fm.mission_id WHERE fm.stage NOT IN ('DELIVERY_READY','ACCEPTED','REJECTED','CANCELLED','SPEC_DRAFT')").get().n,
      note: real.length < 5 ? "Date reale insuficiente (sub 5 misiuni livrate pe proiecte reale): duratele observate nu sunt reprezentative pentru clienți; folosește estimările tale." : "Observații din misiunile livrate de Hub (durata agentului, nu efortul total al unui proiect de client).",
    };
  }

  function run({ title = "", inputs = {}, actor }) {
    const result = simulateCapacity(inputs);
    const id = newId("sim");
    bus.transaction(() => {
      db.prepare("INSERT INTO simulations (id, title, model_version, inputs_json, result_json, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, redactText(String(title || "Scenariu")).slice(0, 160), SIM_MODEL_VERSION, json(inputs), json(result), result.status, String(actor).slice(0, 80), iso());
      // A simulation event is labelled as such; real metrics never read the simulations table.
      bus.append({ type: "simulation.computed", scopeType: "simulation", scopeId: id, source: actor, payload: { status: result.status, simulated: true } });
    });
    return get(id);
  }

  /** "Transform into a proposal": a separate DRAFT decision (decisions table, status draft) for the normal decision flow. */
  function toProposal(id, { actor, title = "" }) {
    const sim = get(id);
    if (!sim) throw new HubError("not_found", "Scenariu necunoscut");
    if (sim.status !== "COMPUTED") throw new HubError("validation", "Un scenariu fără date suficiente nu devine propunere");
    if (sim.proposalRef) return { simulation: sim, decisionId: sim.proposalRef, existing: true };
    const decisionId = newId("dec");
    const v = sim.result.verdict?.single || `${sim.result.verdict?.optimistic} / ${sim.result.verdict?.pessimistic}`;
    bus.transaction(() => {
      db.prepare("INSERT INTO decisions (id, project_id, conversation_id, title, decision, rationale, source_ref, author, status, created_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'draft', ?)")
        .run(decisionId, redactText(String(title || `Propunere din scenariul „${sim.title}”`)).slice(0, 160), `De discutat: ${v} (scenariu ${SIM_MODEL_VERSION})`,
          "Ciornă creată din simulare; nu schimbă prețuri, roadmap sau capacitate până nu o decizi.", `simulation:${id}`, String(actor).slice(0, 80), iso());
      db.prepare("UPDATE simulations SET proposal_ref = ? WHERE id = ?").run(decisionId, id);
      bus.append({ type: "simulation.proposal_drafted", scopeType: "simulation", scopeId: id, source: actor, payload: { decisionId, simulated: true } });
    });
    return { simulation: get(id), decisionId };
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM simulations WHERE id = ?").get(id));
  const list = () => db.prepare("SELECT * FROM simulations ORDER BY created_at DESC LIMIT 50").all().map(rowTo);
  return { run, get, list, toProposal, observedInputs, fields: FIELDS, required: REQUIRED };
}
