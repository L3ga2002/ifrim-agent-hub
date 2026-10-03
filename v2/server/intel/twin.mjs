import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Digital Twin (M08 §07): a verifiable map of what the Hub KNOWS about the company — not a simulation of the firm and not a memory
 * of every conversation. Relations are derived on read from the tables that already hold the facts (projects, clients, missions,
 * change sets, bundles, decisions, envelopes, incidents, events); only what someone explicitly RECORDS is stored (twin_claims).
 *
 * Every relation carries: type, kind (OBSERVED = read from a Hub record; DECLARED = stated by the owner; HYPOTHESIS = proposed,
 * unverified), source { table, id }, version and date. Two incidents touching the same component are an OBSERVED shared
 * component — never "the same cause": a cause is a HYPOTHESIS until evidence confirms it. Unknowns and conflicts are returned,
 * never filled in.
 */
export const CLAIM_KINDS = Object.freeze(["OBSERVED", "DECLARED", "HYPOTHESIS"]);
export const CLAIM_STATUSES = Object.freeze(["open", "confirmed", "refuted", "retracted"]);
/** Predicates where two different objects for the same subject are a conflict (one value expected). */
const FUNCTIONAL_PREDICATES = new Set(["cause", "cauza", "owner", "responsabil", "version", "versiune", "environment", "mediu", "status"]);

/** The component a project-relative path belongs to (its top folder; tests and root files grouped). */
export function componentOf(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p) return null;
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 1) return "(rădăcină)";
  const top = parts[0].toLowerCase();
  if (["test", "tests", "__tests__", "spec", "e2e"].includes(top)) return "teste";
  return parts[0];
}

/** Local calendar day boundaries (the machine's time zone), for "since yesterday". */
export function localDayStart(date, offsetDays = 0) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export function createTwin({ db, bus, clock, projects, settings, envelopes = null, approvals = null }) {
  const now = () => clock();
  const iso = (d = now()) => d.toISOString();
  const edge = (from, to, type, kind, source, { version = null, at = null, detail = null, status = null } = {}) => ({ from, to, type, kind, source, version, at, detail, status });
  const projectOf = (projectId) => {
    const p = projects.get(projectId);
    if (!p) throw new HubError("not_found", "Proiect necunoscut");
    return p;
  };
  const missionRows = (projectId) => db.prepare("SELECT * FROM missions WHERE project_id = ? ORDER BY created_at").all(projectId);
  const changeSetRows = (missionIds) => (missionIds.length ? db.prepare(`SELECT id, mission_id, seq, changes_json, status, created_at, run_id FROM factory_change_sets WHERE mission_id IN (${missionIds.map(() => "?").join(",")}) ORDER BY created_at`).all(...missionIds) : []);
  const filesOf = (row) => parse(row.changes_json, []).map((c) => c.path).filter(Boolean);
  const claimRow = (r) => r && ({ id: r.id, projectId: r.project_id, subject: { type: r.subject_type, id: r.subject_id }, predicate: r.predicate, object: { type: r.object_type, id: r.object_id },
    kind: r.kind, status: r.status, sourceKind: r.source_kind, sourceRef: r.source_ref, note: r.note, author: r.author, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });

  // ---------- graph ----------
  /** Nodes and relations for one project (or the company overview when projectId is null). Derived; bounded. */
  function graph(projectId) {
    if (!projectId) return companyGraph();
    const p = projectOf(projectId);
    const nodes = new Map();
    const edges = [];
    const node = (id, type, label, extra = {}) => { if (!nodes.has(id)) nodes.set(id, { id, type, label: String(label || id).slice(0, 120), ...extra }); return id; };
    const pid = node(`project:${p.id}`, "project", p.name, { source: { table: "projects", id: p.id }, testProject: p.source === "hub-test" });
    const client = p.clientId || p.client_id ? db.prepare("SELECT * FROM clients WHERE id = ?").get(p.clientId || p.client_id) : null;
    if (client) edges.push(edge(node(`client:${client.id}`, "client", client.name, { demo: Boolean(client.demo) }), pid, "has_project", "OBSERVED", { table: "projects", id: p.id }, { version: client.version, at: client.updated_at }));
    const missions = missionRows(p.id);
    for (const m of missions) {
      const f = db.prepare("SELECT stage, wait_reason, stage_reason, repair_cycles, work_type FROM factory_missions WHERE mission_id = ?").get(m.id);
      edges.push(edge(pid, node(`mission:${m.id}`, "mission", m.title, { status: m.status, stage: f?.stage || null, workType: f?.work_type || null }), "has_mission", "OBSERVED", { table: "missions", id: m.id }, { version: m.version, at: m.created_at }));
    }
    const sets = changeSetRows(missions.map((m) => m.id));
    for (const cs of sets) {
      const csId = node(`changeset:${cs.id}`, "change_set", `Change set #${cs.seq}`, { status: cs.status });
      edges.push(edge(`mission:${cs.mission_id}`, csId, "produced", "OBSERVED", { table: "factory_change_sets", id: cs.id }, { version: cs.seq, at: cs.created_at }));
      const byComponent = new Map();
      for (const file of filesOf(cs)) { const c = componentOf(file); if (c) byComponent.set(c, [...(byComponent.get(c) || []), file]); }
      for (const [c, files] of byComponent) edges.push(edge(csId, node(`component:${p.id}:${c}`, "component", c), "touched", "OBSERVED", { table: "factory_change_sets", id: cs.id }, { version: cs.seq, at: cs.created_at, detail: files.slice(0, 8) }));
    }
    for (const b of missions.length ? db.prepare(`SELECT id, mission_id, status, created_at, decided_at FROM factory_bundles WHERE mission_id IN (${missions.map(() => "?").join(",")})`).all(...missions.map((m) => m.id)) : []) {
      edges.push(edge(`mission:${b.mission_id}`, node(`bundle:${b.id}`, "bundle", `Pachet ${b.id.slice(-6)}`, { status: b.status }), "delivered", "OBSERVED", { table: "factory_bundles", id: b.id }, { at: b.created_at, status: b.status }));
    }
    for (const d of db.prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at").all(p.id)) {
      edges.push(edge(node(`decision:${d.id}`, "decision", d.title, { status: d.status }), pid, "about", "OBSERVED", { table: "decisions", id: d.id }, { at: d.created_at, status: d.status }));
      if (d.supersedes_id) edges.push(edge(`decision:${d.id}`, node(`decision:${d.supersedes_id}`, "decision", d.supersedes_id), "supersedes", "OBSERVED", { table: "decisions", id: d.id }, { at: d.created_at }));
    }
    for (const inc of db.prepare("SELECT * FROM incidents WHERE project_id = ? ORDER BY created_at").all(p.id)) {
      const iid = node(`incident:${inc.id}`, "incident", inc.title, { status: inc.status });
      edges.push(edge(iid, pid, "affects", inc.impact_confirmed_json ? "OBSERVED" : "HYPOTHESIS", { table: "incidents", id: inc.id }, { version: inc.version, at: inc.created_at, detail: inc.impact_confirmed_json ? "impact confirmat de proprietar" : "impact neconfirmat" }));
      for (const c of parse(inc.components_json, [])) edges.push(edge(iid, node(`component:${p.id}:${c.name}`, "component", c.name), "involves", c.kind || "HYPOTHESIS", { table: "incidents", id: inc.id }, { at: inc.created_at, detail: c.source || null }));
    }
    for (const c of db.prepare("SELECT * FROM twin_claims WHERE project_id = ? AND status <> 'retracted' ORDER BY created_at").all(p.id).map(claimRow)) {
      edges.push(edge(node(`${c.subject.type}:${c.subject.id}`, c.subject.type, c.subject.id), node(`${c.object.type}:${c.object.id}`, c.object.type, c.object.id), c.predicate, c.kind,
        { table: "twin_claims", id: c.id }, { version: c.version, at: c.createdAt, status: c.status, detail: c.note || null }));
    }
    // Shared components between incidents: an observation, never a cause.
    const incidentsByComponent = new Map();
    for (const e of edges.filter((x) => x.type === "involves")) incidentsByComponent.set(e.to, [...(incidentsByComponent.get(e.to) || []), e.from]);
    const shared = [...incidentsByComponent.entries()].filter(([, list]) => new Set(list).size > 1).map(([component, list]) => ({ component, incidents: [...new Set(list)],
      note: "Incidentele implică aceeași componentă; asta NU arată o cauză comună (o cauză rămâne ipoteză până o confirmă o dovadă)." }));
    return { projectId: p.id, generatedAt: iso(), nodes: [...nodes.values()], edges, shared, contradictions: contradictions(p.id),
      unknowns: [
        "Contractele API, consumatorii externi și datele de producție nu sunt modelate decât dacă le declari (relație DECLARED).",
        ...(client ? [] : ["Clientul proiectului nu este înregistrat."]),
        ...(sets.length ? [] : ["Nicio schimbare înregistrată de Hub pe acest proiect: componentele nu sunt încă cunoscute."]),
      ] };
  }

  function companyGraph() {
    const list = projects.list();
    const nodes = [{ id: "company", type: "company", label: "Ifrim Digital" }];
    const edges = [];
    for (const p of list) {
      nodes.push({ id: `project:${p.id}`, type: "project", label: p.name, testProject: p.source === "hub-test" });
      edges.push(edge("company", `project:${p.id}`, "has_project", "OBSERVED", { table: "projects", id: p.id }, { at: p.createdAt || p.created_at || null }));
    }
    return { projectId: null, generatedAt: iso(), nodes, edges, shared: [], contradictions: [], unknowns: ["Venituri, contracte și clienți apar doar dacă sunt înregistrate în Hub."] };
  }

  // ---------- "De ce este blocat proiectul?" ----------
  function blocked(projectId) {
    const p = projectOf(projectId);
    const chain = [];
    // kind: "blocker" (something that really stops work) or "attention" (an open report: it does not block the project by itself).
    const add = (what, why, source, next, kind = "blocker") => chain.push({ what, why: redactText(String(why || "")).slice(0, 400), evidence: source, next, kind });
    const freeze = settings.get("projectFreeze")?.[p.id];
    if (freeze) add("Proiectul este înghețat", freeze.reason || "înghețat de tine", { table: "settings", id: "projectFreeze", at: freeze.at || null }, "Spune „Dezgheață” când vrei să reia munca.");
    const missions = missionRows(p.id);
    const byId = new Map(missions.map((m) => [m.id, m]));
    for (const f of missions.length ? db.prepare(`SELECT * FROM factory_missions WHERE mission_id IN (${missions.map(() => "?").join(",")}) AND stage IN ('BLOCKED','NEEDS_OWNER_DECISION','PAUSED')`).all(...missions.map((m) => m.id)) : []) {
      const last = db.prepare("SELECT id, seq, created_at FROM events WHERE type = 'factory.stage' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(f.mission_id);
      add(`„${byId.get(f.mission_id)?.title || f.mission_id}” este ${f.stage}`, f.stage_reason || f.wait_reason, { table: "events", id: last?.id || null, seq: last?.seq || null, at: last?.created_at || f.updated_at },
        f.stage === "NEEDS_OWNER_DECISION" ? "Decizia ta: reiei, oprești sau schimbi scope-ul." : f.stage === "PAUSED" ? "Reia misiunea când vrei." : "Rezolvă cauza indicată, apoi reia.");
    }
    if (envelopes) for (const e of db.prepare("SELECT id, derived_json, close_reason, updated_at FROM mission_envelopes WHERE project_id = ? AND status = 'WAITING_OWNER'").all(p.id)) {
      add("Planul autorizat așteaptă", parse(e.derived_json, {}).hold || "o decizie a ta", { table: "mission_envelopes", id: e.id, at: e.updated_at }, "Confirmă diferența sau retrage planul.");
    }
    // An open incident is a report (often unconfirmed), not a block: it is shown for attention and never makes the project "blocked".
    for (const inc of db.prepare("SELECT id, title, status, impact_confirmed_json, updated_at FROM incidents WHERE project_id = ? AND status NOT IN ('RESOLVED','DISMISSED')").all(p.id)) {
      add(`Incident deschis: ${inc.title}`, `stare ${inc.status}${inc.impact_confirmed_json ? " · impact confirmat de tine" : " · raport neconfirmat"}`, { table: "incidents", id: inc.id, at: inc.updated_at }, "Vezi War Room.", "attention");
    }
    // Objective tasks waiting on a dependency that is not delivered yet.
    for (const o of db.prepare("SELECT * FROM autopilot_objectives WHERE project_id = ? AND status NOT IN ('DELIVERED','STOPPED','SUPERSEDED')").all(p.id)) {
      const plan = parse(o.plan_json, {});
      const stageOf = (mid) => (mid ? db.prepare("SELECT stage FROM factory_missions WHERE mission_id = ?").get(mid)?.stage || null : null);
      for (const t of plan.tasks || []) {
        const waiting = (t.dependsOn || []).filter((k) => !["DELIVERY_READY", "ACCEPTED"].includes(stageOf((plan.tasks.find((x) => x.key === k) || {}).missionId)));
        if (waiting.length && stageOf(t.missionId) === "SPEC_DRAFT") add(`Sarcina „${t.title}” din obiectivul „${o.title}” așteaptă`, `depinde de: ${waiting.join(", ")}`, { table: "autopilot_objectives", id: o.id, at: o.updated_at }, "Se deblochează când dependențele sunt livrate.");
      }
    }
    const missionIdList = missions.map((m) => m.id);
    if (approvals) for (const a of approvals.list("pending").filter((x) => String(x.target || "").includes(p.id) || missionIdList.some((id) => String(x.target || "").startsWith(id))).slice(0, 10)) {
      add(`Aprobare în așteptare: ${a.actionKind}`, a.target, { table: "approvals", id: a.id, at: a.createdAt }, "Decide în Aprobări.");
    }
    let readiness = null;
    if (envelopes?.readiness) {
      try { readiness = envelopes.readiness(p, []); } catch { readiness = null; }
      for (const b of readiness?.blockers || []) add("O execuție nouă ar fi oprită", b.detail, { table: "gate", id: b.id, at: iso() }, b.kind === "isolation" ? "Necesită ruta izolată și politica de izolare." : "Rezolvă verificarea indicată.");
    }
    const blocked = chain.some((c) => c.kind === "blocker");
    return { projectId: p.id, at: iso(), blocked, chain, unknowns: blocked ? [] : ["Nu am găsit nimic blocat în datele Hub-ului; dacă ceva nu merge în afara lor, spune-mi ce observi."] };
  }

  // ---------- "Ce s-a schimbat de ieri?" ----------
  /** Observable differences since `since` (default: the last visit of the project, else the start of yesterday, local time). */
  function changesSince(projectId, { since = null } = {}) {
    const p = projectId ? projectOf(projectId) : null;
    const visit = p ? db.prepare("SELECT last_seen_at FROM owner_visits WHERE project_id = ?").get(p.id) : null;
    const yesterday = localDayStart(now(), -1);
    const from = since ? new Date(since) : visit ? new Date(visit.last_seen_at) : yesterday;
    if (Number.isNaN(from.getTime())) throw new HubError("validation", "Dată invalidă");
    const sinceSource = since ? "explicit" : visit ? "ultima vizită" : "începutul zilei de ieri (ora locală)";
    const missionIds = p ? missionRows(p.id).map((m) => m.id) : [];
    const rows = p
      ? db.prepare(`SELECT id, seq, type, scope_type, scope_id, source, payload_json, created_at FROM events WHERE created_at > ? AND (project_id = ? OR mission_id IN (${missionIds.map(() => "?").join(",") || "''"})) ORDER BY seq LIMIT 3000`).all(iso(from), p.id, ...missionIds)
      : db.prepare("SELECT id, seq, type, scope_type, scope_id, source, payload_json, created_at FROM events WHERE created_at > ? ORDER BY seq LIMIT 3000").all(iso(from));
    const group = (prefix) => rows.filter((r) => r.type.startsWith(prefix));
    const stages = group("factory.stage").map((r) => ({ missionId: r.scope_id, stage: parse(r.payload_json, {}).stage, at: r.created_at, source: { table: "events", id: r.id, seq: r.seq } }));
    const lastStage = new Map();
    for (const s of stages) lastStage.set(s.missionId, s);
    const titles = new Map(missionIds.map((id) => [id, db.prepare("SELECT title FROM missions WHERE id = ?").get(id)?.title || id]));
    const items = [
      ...[...lastStage.values()].map((s) => ({ kind: "mission", text: `„${titles.get(s.missionId) || s.missionId}” → ${s.stage}`, at: s.at, source: s.source })),
      ...group("envelope.").filter((r) => ["envelope.confirmed", "envelope.status", "envelope.proposed"].includes(r.type)).map((r) => ({ kind: "plan", text: `${r.type.replace("envelope.", "plan ")}${parse(r.payload_json, {}).status ? `: ${parse(r.payload_json, {}).status}` : ""}`, at: r.created_at, source: { table: "events", id: r.id, seq: r.seq } })),
      ...group("incident.").map((r) => ({ kind: "incident", text: `${r.type}: ${parse(r.payload_json, {}).title || ""}`, at: r.created_at, source: { table: "events", id: r.id, seq: r.seq } })),
      ...group("autopilot.").map((r) => ({ kind: "objective", text: `${r.type}: ${parse(r.payload_json, {}).title || ""}`, at: r.created_at, source: { table: "events", id: r.id, seq: r.seq } })),
      ...(p ? db.prepare("SELECT id, title, created_at FROM decisions WHERE project_id = ? AND created_at > ?").all(p.id, iso(from)) : []).map((d) => ({ kind: "decision", text: `Decizie: ${d.title}`, at: d.created_at, source: { table: "decisions", id: d.id } })),
      ...(p ? db.prepare(`SELECT id, mission_id, status, created_at FROM factory_bundles WHERE created_at > ? AND mission_id IN (${missionIds.map(() => "?").join(",") || "''"})`).all(iso(from), ...missionIds) : []).map((b) => ({ kind: "delivery", text: `Pachet de livrare (${b.status}) pentru „${titles.get(b.mission_id) || b.mission_id}”`, at: b.created_at, source: { table: "factory_bundles", id: b.id } })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    // The Hub cannot have worked while it was not running: boots in the window are listed, and nothing is claimed for the gaps.
    const boots = db.prepare("SELECT created_at FROM events WHERE type = 'system.booted' AND created_at > ? ORDER BY seq").all(iso(from)).map((r) => r.created_at);
    return { projectId: p?.id || null, since: iso(from), sinceSource, until: iso(), localDay: now().toLocaleDateString("ro-RO"), counts: { events: rows.length, items: items.length }, items: items.slice(-200),
      hubBoots: boots, note: items.length ? null : "Nimic nou în datele Hub-ului în acest interval.",
      offlineNote: boots.length ? `Hub-ul a (re)pornit de ${boots.length} ori în interval; între opriri și porniri nu a rulat nimic (nicio execuție cloud nu e configurată).` : null };
  }

  // ---------- "Ce poate afecta schimbarea asta?" ----------
  function impact(projectId, { paths = [], changeSetId = null, component = null } = {}) {
    const p = projectOf(projectId);
    let files = (Array.isArray(paths) ? paths : []).map(String).filter(Boolean).slice(0, 200);
    if (changeSetId) {
      const cs = db.prepare("SELECT * FROM factory_change_sets WHERE id = ?").get(changeSetId);
      if (!cs) throw new HubError("not_found", "Change set necunoscut");
      files = [...files, ...filesOf(cs)];
    }
    const components = [...new Set([...(component ? [component] : []), ...files.map(componentOf).filter(Boolean)])];
    if (!components.length) return { projectId: p.id, components: [], known: [], unknowns: ["Spune-mi fișierele sau change set-ul: fără ele nu pot calcula impactul."] };
    const missions = missionRows(p.id);
    const titles = new Map(missions.map((m) => [m.id, m.title]));
    const history = [];
    for (const cs of changeSetRows(missions.map((m) => m.id))) {
      if (cs.id === changeSetId) continue;
      const touched = filesOf(cs).filter((f) => components.includes(componentOf(f)));
      if (touched.length) history.push({ changeSetId: cs.id, mission: titles.get(cs.mission_id) || cs.mission_id, at: cs.created_at, files: touched.slice(0, 8), source: { table: "factory_change_sets", id: cs.id } });
    }
    const incidents = db.prepare("SELECT id, title, status, components_json, created_at FROM incidents WHERE project_id = ?").all(p.id)
      .filter((i) => parse(i.components_json, []).some((c) => components.includes(c.name)))
      .map((i) => ({ incidentId: i.id, title: i.title, status: i.status, at: i.created_at, source: { table: "incidents", id: i.id }, note: "implică aceeași componentă (nu dovedește o legătură cauzală)" }));
    const words = components.filter((c) => c.length >= 3);
    const decisions = words.length ? db.prepare("SELECT id, title, decision, created_at FROM decisions WHERE project_id = ?").all(p.id)
      .filter((d) => words.some((w) => `${d.title} ${d.decision}`.toLowerCase().includes(w.toLowerCase()))).map((d) => ({ decisionId: d.id, title: d.title, at: d.created_at, source: { table: "decisions", id: d.id } })) : [];
    const declared = db.prepare("SELECT * FROM twin_claims WHERE project_id = ? AND status IN ('open','confirmed') AND ((subject_type = 'component' AND subject_id IN (" + components.map(() => "?").join(",") + ")) OR (object_type = 'component' AND object_id IN (" + components.map(() => "?").join(",") + ")))").all(p.id, ...components, ...components).map(claimRow);
    const tests = [...new Set(history.flatMap((h) => h.files).filter((f) => componentOf(f) === "teste"))];
    return { projectId: p.id, components, files: files.slice(0, 50), known: { history, incidents, decisions, declared, tests },
      unknowns: ["Consumatorii externi, contractele API și datele de producție nu sunt cunoscute decât dacă au fost declarate.", ...(declared.length ? [] : ["Nicio relație declarată pentru aceste componente."])],
      limits: "Impactul se bazează doar pe ce a schimbat Hub-ul și pe ce ai declarat; nu analizează codul în afara acestor date." };
  }

  // ---------- "De ce am ales soluția?" ----------
  function why(projectId, query = "") {
    const p = projectId ? projectOf(projectId) : null;
    const terms = String(query || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) || [];
    const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    const decisions = db.prepare(`SELECT * FROM decisions ${p ? "WHERE project_id = ?" : ""} ORDER BY created_at DESC LIMIT 500`).all(...(p ? [p.id] : []))
      .map((d) => ({ d, score: terms.filter((t) => norm(`${d.title} ${d.decision} ${d.rationale}`).includes(t)).length }))
      .filter((x) => !terms.length || x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
      .map(({ d }) => ({ decisionId: d.id, title: d.title, decision: d.decision, rationale: d.rationale, sourceRef: d.source_ref, author: d.author, status: d.status, at: d.created_at, supersedes: d.supersedes_id,
        source: { table: "decisions", id: d.id } }));
    const board = db.prepare("SELECT bi.id, bi.title, bi.status, bi.decision_note, bi.decided_at, bi.meeting_id FROM board_items bi WHERE bi.status = 'DECIDED' ORDER BY bi.decided_at DESC LIMIT 200").all()
      .filter((b) => !terms.length || terms.some((t) => norm(`${b.title} ${b.decision_note}`).includes(t))).slice(0, 5)
      .map((b) => ({ boardItemId: b.id, title: b.title, note: b.decision_note, at: b.decided_at, source: { table: "board_items", id: b.id } }));
    return { query, projectId: p?.id || null, found: decisions.length + board.length > 0, decisions, board,
      note: decisions.length + board.length ? null : "Nu există o decizie înregistrată care să răspundă; nu o reconstitui din presupuneri. O poți înregistra acum ca decizie." };
  }

  // ---------- claims (what someone records) ----------
  function addClaim({ projectId = null, subject, predicate, object, kind = "HYPOTHESIS", sourceKind, sourceRef = "", note = "", author }) {
    if (!CLAIM_KINDS.includes(kind)) throw new HubError("validation", "Tip de relație necunoscut");
    if (!subject?.type || !subject?.id || !object?.type || !object?.id || !String(predicate || "").trim()) throw new HubError("validation", "Relația cere subiect, predicat și obiect");
    if (kind === "OBSERVED" && !String(sourceRef || "").trim()) throw new HubError("validation", "O observație cere o sursă verificabilă (sourceRef)");
    // Only the owner declares; a model or a tool may only propose a hypothesis.
    const owner = /^(owner|user)/.test(String(author || ""));
    if (kind === "DECLARED" && !owner) throw new HubError("policy", "Doar tu poți declara o relație; un agent sau un tool propune cel mult o ipoteză");
    if (kind !== "HYPOTHESIS" && ["model", "tool", "document", "web"].includes(sourceKind)) throw new HubError("policy", "Conținutul unui model, tool sau document intră doar ca ipoteză");
    if (projectId) projectOf(projectId);
    const id = newId("clm");
    const t = iso();
    bus.transaction(() => {
      db.prepare(`INSERT INTO twin_claims (id, project_id, subject_type, subject_id, predicate, object_type, object_id, kind, status, source_kind, source_ref, note, author, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`).run(id, projectId, String(subject.type).slice(0, 40), String(subject.id).slice(0, 160), String(predicate).trim().slice(0, 80),
          String(object.type).slice(0, 40), String(object.id).slice(0, 160), kind, String(sourceKind || "owner").slice(0, 40), String(sourceRef).slice(0, 300), redactText(String(note)).slice(0, 1000), String(author).slice(0, 80), t, t);
      bus.append({ type: "twin.claim_added", scopeType: "twin", scopeId: id, projectId, source: author, payload: { kind, predicate } });
    });
    return claimRow(db.prepare("SELECT * FROM twin_claims WHERE id = ?").get(id));
  }

  function setClaimStatus(id, status, { actor, evidenceRef = "" } = {}) {
    if (!CLAIM_STATUSES.includes(status)) throw new HubError("validation", "Stare necunoscută");
    const row = db.prepare("SELECT * FROM twin_claims WHERE id = ?").get(id);
    if (!row) throw new HubError("not_found", "Relație necunoscută");
    if (status === "confirmed" && !String(evidenceRef || row.source_ref).trim()) throw new HubError("validation", "Confirmarea cere o dovadă (evidenceRef)");
    bus.transaction(() => {
      db.prepare("UPDATE twin_claims SET status = ?, source_ref = CASE WHEN ? <> '' THEN ? ELSE source_ref END, version = version + 1, updated_at = ? WHERE id = ?").run(status, evidenceRef, evidenceRef, iso(), id);
      bus.append({ type: "twin.claim_status", scopeType: "twin", scopeId: id, projectId: row.project_id, source: actor, payload: { status } });
    });
    return claimRow(db.prepare("SELECT * FROM twin_claims WHERE id = ?").get(id));
  }

  /** Two live claims giving different values to a one-value relation (cause, owner, version…) of the same subject. */
  function contradictions(projectId) {
    const rows = db.prepare("SELECT * FROM twin_claims WHERE project_id = ? AND status IN ('open','confirmed')").all(projectId).map(claimRow);
    const out = [];
    const groups = new Map();
    for (const c of rows.filter((x) => FUNCTIONAL_PREDICATES.has(String(x.predicate).toLowerCase()))) {
      const k = `${c.subject.type}:${c.subject.id}:${String(c.predicate).toLowerCase()}`;
      groups.set(k, [...(groups.get(k) || []), c]);
    }
    for (const [key, list] of groups) {
      const objects = new Set(list.map((c) => `${c.object.type}:${c.object.id}`));
      if (objects.size > 1) out.push({ key, claims: list.map((c) => ({ id: c.id, object: c.object, kind: c.kind, status: c.status, source: c.sourceRef })), note: "Relații în conflict: păstrez ambele până le rezolvi cu o dovadă." });
    }
    return out;
  }

  /** Change sets and deliveries of the last `hours` (candidates for an incident's timeline, never its cause by themselves). */
  function recentChanges(projectId, hours = 72) {
    const p = projectOf(projectId);
    const since = new Date(now().getTime() - hours * 3600000).toISOString();
    const missions = missionRows(p.id);
    const titles = new Map(missions.map((m) => [m.id, m.title]));
    return changeSetRows(missions.map((m) => m.id)).filter((cs) => cs.created_at > since)
      .map((cs) => ({ changeSetId: cs.id, mission: titles.get(cs.mission_id) || cs.mission_id, at: cs.created_at, components: [...new Set(filesOf(cs).map(componentOf).filter(Boolean))], source: { table: "factory_change_sets", id: cs.id } }));
  }

  /** The project's repository head (read-only), for an incident's version reference. */
  function versionRef(projectId) {
    const p = projectOf(projectId);
    const head = p.path && fs.existsSync(path.join(p.path, ".git", "HEAD")) ? String(fs.readFileSync(path.join(p.path, ".git", "HEAD"), "utf8")).trim().slice(0, 120) : null;
    return { projectId: p.id, headRef: head, readAt: iso(), note: head ? null : "Proiectul nu are un repository propriu; versiunea nu e cunoscută." };
  }

  return { graph, blocked, changesSince, impact, why, addClaim, setClaimStatus, contradictions, recentChanges, versionRef, claims: (projectId) => db.prepare("SELECT * FROM twin_claims WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId).map(claimRow) };
}
