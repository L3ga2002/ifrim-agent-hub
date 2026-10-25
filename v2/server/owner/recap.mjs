import { newId } from "../core/ids.mjs";
import { HubError } from "../core/errors.mjs";
import { decisionsInbox } from "../delivery/inbox.mjs";
import { ACTIVE_STAGES } from "../factory/factory.mjs";
import { TZ, bucharestDayStart, hhmm, dateTimeRo, roCount, roList } from "./ro-text.mjs";
import { OPPORTUNITY_TRANSITIONS } from "../sales/sales.mjs";

/** Closed opportunities: the statuses with no outgoing transition in the Sales state machine (never retyped here: S-08). */
const CLOSED_OPPORTUNITY = Object.freeze(Object.keys(OPPORTUNITY_TRANSITIONS).filter((status) => OPPORTUNITY_TRANSITIONS[status].length === 0));

export const activeWork = (hub) => hub.factory.list().filter((m) => ACTIVE_STAGES.has(m.stage) && !["PAUSED", "CANCEL_REQUESTED"].includes(m.stage)).length;
export function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export function provenanceOf(rows) {
  const synthetic = rows.filter((r) => !r.provenanceUnknown && (r.synthetic === true || r.synthetic === 1 || r.real === false)).length;
  const unknown = rows.filter((r) => r.provenanceUnknown).length;
  const real = rows.length - synthetic - unknown;
  return { provenance: (real && (synthetic || unknown)) || (synthetic && unknown) ? "mixed" : synthetic ? "synthetic" : real ? "real" : "none", split: { real, synthetic, ...(unknown ? { unknown } : {}) } };
}
const META = [
  ["waiting", "Ce te așteaptă", null, "/livrare/decizii"], ["work", "Lucrări", "trace", "/missions"],
  ["results", "Livrări și rezultate", "result", "/rezultate"], ["sales", "Vânzări", "funnel", "/sales"],
  ["desk", "Birou intern", null, "/lega"], ["system", "Sistemul", "system", "/system"],
];
const NO_SEND = "Trimiterea e oprită în cod (OUTREACH_DISABLED); contactele făcute de tine se înregistrează manual.";

/** Text only: reads the chapter's already-built indicators. */
export function recapSentences(c, period) {
  const by = Object.fromEntries(c.indicators.map(i => [i.id.split(".")[1], i]));
  const numeric = c.indicators.filter(i => typeof i.value === "number" && i.value > 0);
  const allTest = numeric.length > 0 && numeric.every(i => i.provenance === "synthetic");
  const periodWord = period === "today" ? "Azi" : "De la ultima vizită";
  const subjects = { decisions: "decizii te așteaptă", plans: "planuri sunt de confirmat", blocked: "blocaje așteaptă deblocarea", approvals: "aprobări tehnice te așteaptă", active: c.key === "desk" ? "dosare sunt în lucru" : "lucrări sunt în lucru", paused: "lucrări sunt în pauză sau se opresc", ready: "lucrări au ajuns gata de livrare", runs: "rulări de model au fost", bundles_ready: "pachete așteaptă acceptarea", deliveries: "livrări sunt pregătite", accepted: "pachete ai acceptat", qa_warn: "avertismente QA au fost la clipuri", open: "oportunități sunt deschise", prepared: "oferte sunt pregătite", approved: "oferte sunt aprobate intern", sent: "oferte sunt trimise prin transportul de test", ops: "dosare de pornire sunt pregătite", sup: "cazuri de suport sunt pregătite", dvz: "devize sunt pregătite", failures: "execuții au eșuat" };
  const exceptional = i => {
    const key = i.id.split(".")[1];
    if (i.state === "disabled") return `${i.label}: dezactivată`;
    if (!subjects[key]) return `${i.label}: ${i.state === "unknown" ? "necunoscut" : "indisponibil: sursa nu a răspuns"}`;
    return `nu știu câte ${subjects[key]}: ${i.state === "unavailable" ? "sursa nu a răspuns" : "numărul este necunoscut"}`;
  };
  const count = (key, one, many, none) => {
    const i = by[key];
    if (["unknown", "unavailable", "disabled"].includes(i.state)) return exceptional(i);
    let text = roCount(i.value, { one, many, none });
    if (one.startsWith("e ") || one.startsWith("aprobată ") || one.startsWith("trimisă ")) text = text.replace(/^(\d[\d.]*) de /, "$1 ");
    const details = [!allTest && i.split?.synthetic ? `din care ${i.split.synthetic} din date de test` : null, i.split?.unknown ? `${i.split.unknown} cu proveniență necunoscută` : null].filter(Boolean);
    if (details.length) text = text.replace(/^([\d.]+)/, `$1 (${details.join(", ")})`);
    return text;
  };
  const zero = key => by[key]?.state === "zero";
  const needed = key => !zero(key);
  const upper = text => text.charAt(0).toLocaleUpperCase("ro-RO") + text.slice(1);
  let sentences = [];
  if (c.key === "waiting") {
    const parts = [["decisions", "decizie", "decizii"], ["plans", "plan de confirmat", "planuri de confirmat"], ["approvals", "aprobare tehnică", "aprobări tehnice"]].filter(([key]) => needed(key)).map(args => count(...args));
    const block = needed("blocked") ? `${count("blocked", "blocaj", "blocaje")}${typeof by.blocked.value === "number" ? " așteaptă deblocarea" : ""}` : null;
    sentences = parts.length ? [`Te așteaptă ${roList(parts)}.`, ...(block ? [`${upper(block)}.`] : [])] : [block ? `Nicio decizie nu te așteaptă; ${block}.` : "Nimic nu te așteaptă acum."];
  } else if (c.key === "work") {
    sentences = [`${upper(count("active", "lucrare e în lucru acum", "lucrări sunt în lucru acum", "Nicio lucrare nu e în lucru acum"))}${needed("paused") ? `, iar ${count("paused", "e în pauză sau se oprește", "sunt în pauză sau se opresc")}` : ""}.`];
    if (period !== "now") sentences.push(`${periodWord}: ${count("ready", "lucrare a ajuns gata de livrare", "lucrări au ajuns gata de livrare", "nicio lucrare nu a ajuns gata de livrare")}, ${count("runs", "rulare de model", "rulări de model", "niciun model nu a rulat")}.`);
  } else if (c.key === "results") {
    sentences = [`${upper(count("bundles_ready", "pachet așteaptă acceptarea ta", "pachete așteaptă acceptarea ta", "Niciun pachet nu așteaptă acceptarea ta"))}; ${count("deliveries", "livrare pregătită", "livrări pregătite", "nicio livrare pregătită")}.`];
    if (period !== "now") sentences.push(`${periodWord}: ${count("accepted", "pachet acceptat de tine", "pachete acceptate de tine", "niciun pachet acceptat de tine")}, ${count("qa_warn", "avertisment QA la clipuri", "avertismente QA la clipuri", "niciun avertisment QA la clipuri")}.`);
  } else if (c.key === "sales") {
    sentences = [`${upper(count("open", "oportunitate deschisă", "oportunități deschise", "Nicio oportunitate deschisă"))}.`];
    if (period !== "now") sentences.push(`${periodWord}: ${count("prepared", "ofertă pregătită", "oferte pregătite", "nicio ofertă pregătită")}, ${count("approved", "aprobată intern", "aprobate intern", "nicio ofertă aprobată intern")}; ${by.sent.state === "disabled" ? "trimiterea din Hub e dezactivată" : count("sent", "trimisă prin transportul de test", "trimise prin transportul de test", "nicio ofertă trimisă prin transportul de test")}.`);
  } else if (c.key === "desk") {
    if (period !== "now") sentences.push(["ops", "sup", "dvz"].every(zero) ? `${periodWord} nu s-a pregătit nimic în Biroul intern.` : `${periodWord}: s-au pregătit ${roList([count("ops", "dosar de pornire", "dosare de pornire", "niciun dosar de pornire"), count("sup", "caz de suport", "cazuri de suport", "niciun caz de suport"), count("dvz", "deviz", "devize", "niciun deviz")])}.`);
    if (needed("active")) sentences.push(`${upper(count("active", "dosar e în lucru acum", "dosare sunt în lucru acum"))}.`);
  } else if (c.key === "system") {
    const text = key => ["unknown", "unavailable", "disabled"].includes(by[key].state) ? exceptional(by[key]) : by[key].display;
    sentences = [`Hub-ul e în ${text("mode")}${by.mode.value === "BUILD_SAFE" ? ", modul sigur" : ""}, cu poarta de execuție ${text("gate")}.`, `Ultimul backup verificat: ${by.backup.state === "unknown" ? "necunoscut" : by.backup.state === "unavailable" ? "indisponibil: sursa nu a răspuns" : by.backup.display}${period !== "now" ? `; ${periodWord}: ${count("failures", "execuție eșuată", "execuții eșuate", "nicio execuție eșuată")}` : ""}.`];
  }
  if (c.key === "sales" && period !== "now" && by.sent.state === "disabled") {
    sentences = [`${sentences[0].slice(0, -1)}; ${periodWord}: ${count("prepared", "ofertă pregătită", "oferte pregătite", "nicio ofertă pregătită")}, ${count("approved", "aprobată intern", "aprobate intern", "nicio ofertă aprobată intern")}.`, "Trimiterea din Hub e dezactivată."];
  }
  if (c.key !== "system" && c.indicators.some(i => ["unknown", "unavailable"].includes(i.state))) {
    const forms = {
      decisions: ["decizie te așteaptă", "decizii te așteaptă", "nicio decizie nu te așteaptă"], plans: ["plan de confirmat", "planuri de confirmat", "niciun plan de confirmat"], blocked: ["blocaj așteaptă deblocarea", "blocaje așteaptă deblocarea", "niciun blocaj"], approvals: ["aprobare tehnică te așteaptă", "aprobări tehnice te așteaptă", "nicio aprobare tehnică"],
      active: c.key === "desk" ? ["dosar e în lucru", "dosare sunt în lucru", "niciun dosar în lucru"] : ["lucrare e în lucru", "lucrări sunt în lucru", "nicio lucrare în lucru"], paused: ["lucrare e în pauză sau se oprește", "lucrări sunt în pauză sau se opresc", "nicio lucrare în pauză"], ready: ["lucrare a ajuns gata de livrare", "lucrări au ajuns gata de livrare", "nicio lucrare nu a ajuns gata de livrare"], runs: ["rulare de model", "rulări de model", "niciun model nu a rulat"],
      bundles_ready: ["pachet așteaptă acceptarea ta", "pachete așteaptă acceptarea ta", "niciun pachet nu așteaptă acceptarea ta"], deliveries: ["livrare pregătită", "livrări pregătite", "nicio livrare pregătită"], accepted: ["pachet acceptat de tine", "pachete acceptate de tine", "niciun pachet acceptat de tine"], qa_warn: ["avertisment QA la clipuri", "avertismente QA la clipuri", "niciun avertisment QA la clipuri"],
      open: ["oportunitate deschisă", "oportunități deschise", "nicio oportunitate deschisă"], prepared: ["ofertă pregătită", "oferte pregătite", "nicio ofertă pregătită"], approved: ["ofertă aprobată intern", "oferte aprobate intern", "nicio ofertă aprobată intern"], sent: ["ofertă trimisă prin transportul de test", "oferte trimise prin transportul de test", "nicio ofertă trimisă prin transportul de test"],
      ops: ["dosar de pornire pregătit", "dosare de pornire pregătite", "niciun dosar de pornire pregătit"], sup: ["caz de suport pregătit", "cazuri de suport pregătite", "niciun caz de suport pregătit"], dvz: ["deviz pregătit", "devize pregătite", "niciun deviz pregătit"],
    };
    sentences = ["now", ...(period === "now" ? [] : ["interval"])].flatMap(applies => {
      const phrases = c.indicators.filter(i => i.applies === applies).map(i => i.state === "disabled" && i.id === "sales.sent" ? "trimiterea din Hub e dezactivată" : count(i.id.split(".")[1], ...forms[i.id.split(".")[1]]));
      return phrases.length ? [`${applies === "now" ? "Acum" : periodWord}: ${roList(phrases)}.`] : [];
    });
  }
  if (c.state === "nothing_new" && !["waiting", "desk"].includes(c.key)) sentences = [period === "now" ? "Nimic în lucru acum." : "Nimic nou în această perioadă."];
  if (!sentences.length) sentences = [period === "now" ? "Nimic în lucru acum." : "Nimic nou în această perioadă."];
  if (c.badge === "SINTETIC" || allTest) sentences[0] = `${c.badge === "SINTETIC" ? "Date sintetice" : "Date de test"}: ${sentences[0]}`;
  return sentences;
}

export function recapOpening({ kind, from, to, fallback }) {
  if (kind === "now") return `Rezumatul de acum, la ${hhmm(to)}.`;
  if (fallback === "no_visit") return `Rezumatul de azi, de la miezul nopții până la ${hhmm(to)}; nu am o vizită anterioară.`;
  if (kind === "since_visit") {
    if (!from) return `Rezumatul de la ultima vizită; sursa vizitei nu a răspuns, până la ${hhmm(to)}.`;
    const day = new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, day: "numeric", month: "long" }).format(new Date(from));
    return `Rezumatul de la ultima vizită, din ${day}, ${hhmm(from)}, până la ${hhmm(to)}.`;
  }
  return `Rezumatul de azi, de la miezul nopții până la ${hhmm(to)}.`;
}

/** Deterministic company-wide reads; a failed source affects only its own indicator. */
export function createRecap(hub) {
  const store = new Map();
  const clock = () => hub.config?.now?.() || new Date();
  const all = (sql, ...args) => hub.db.prepare(sql).all(...args);
  const isHeld = (id) => hub.lega?.isHeld?.(id) === true;
  const clean = () => { const now = clock().getTime(); for (const [id, entry] of store) if (!isHeld(id) && now - entry.storedAt >= 21600000) store.delete(id); };
  const get = (id) => { clean(); return store.get(id)?.snapshot || null; };
  function build({ period = "today", projectId = null, now = clock() } = {}) {
    if (!["today", "since_visit", "now"].includes(period)) throw new HubError("validation", "Perioadă necunoscută");
    now = new Date(now);
    const to = now.toISOString();
    let from = period === "now" ? null : bucharestDayStart(now).toISOString();
    let firstVisit = false; let fallback = null; let periodUnavailable = false;
    if (period === "since_visit") {
      try { const visit = hub.db.prepare("SELECT last_seen_at FROM owner_visits WHERE project_id = ?").get("__company__"); if (visit) from = visit.last_seen_at; else { firstVisit = true; fallback = "no_visit"; } }
      catch { from = null; periodUnavailable = true; }
    }
    const label = `${periodUnavailable ? `Ultima vizită este indisponibilă; până la ${hhmm(to)}` : period === "now" ? `Acum (${hhmm(to)})` : period === "since_visit" && !firstVisit ? `De la ultima vizită (${dateTimeRo(from)}) la ${hhmm(to)}` : `${firstVisit ? "Prima vizită înregistrată: azi" : "Azi"}, de la 00:00 la ${hhmm(to)}`}`;
    const interval = (rows, field = "created_at") => rows.filter((r) => r[field] && Date.parse(r[field]) >= Date.parse(from) && Date.parse(r[field]) <= now.getTime());
    const projectRows = (rows) => rows.map((r) => {
      const project = hub.projects.get(r.project_id || r.projectId);
      return { ...r, synthetic: project?.source === "hub-test", provenanceUnknown: !project };
    });
    const decisionRows = () => decisionsInbox(hub).items.map((r) => ["sales_offer", "desk_support_reply", "desk_finance_doc"].includes(r.kind) ? r : projectRows([r])[0]);
    const salesRows = (table) => all(`SELECT x.*, CASE WHEN o.synthetic = 1 OR g.synthetic = 1 THEN 1 ELSE 0 END AS synthetic FROM ${table} x JOIN sales_opportunities o ON o.id = x.opportunity_id JOIN sales_orgs g ON g.id = o.org_id`);
    const chapters = META.map(([key, title, view, path], index) => ({ key, index, title, badge: null, state: "ok", indicators: [], sentences: [], speech: "", open: { view, path }, sources: [] }));
    function read(chapter, name, label, applies, source, sourceKey, fn, provenance = "none") {
      if (period === "now" && applies === "interval") return;
      const readAt = clock().toISOString();
      const i = { id: `${chapter}.${name}`, label, value: null, display: "", unit: null, state: "value", applies, source, sourceKey, readAt, provenance, note: null };
      try {
        if (periodUnavailable && applies === "interval") throw new Error("visit unavailable");
        const result = fn();
        if (Array.isArray(result)) { i.value = result.length; Object.assign(i, provenanceOf(result)); }
        else if (result && typeof result === "object") Object.assign(i, result);
        else i.value = result;
        if (i.value === 0 && !i.unit) i.state = "zero";
        if (!i.display) i.display = i.split && (i.provenance === "mixed" || i.split.unknown) ? [i.split.real && `${i.split.real} ${i.split.real === 1 ? "real" : "reale"}`, i.split.synthetic && `${i.split.synthetic} sintetice`, i.split.unknown && `${i.split.unknown} necunoscut`].filter(Boolean).join(" + ") : String(i.value);
      } catch { Object.assign(i, { value: null, display: "indisponibil", state: "unavailable", note: "Sursa nu a putut fi citită." }); }
      const c = chapters.find((c) => c.key === chapter); c.indicators.push(i);
      c.sources.push({ key: sourceKey, label: source, readAt, ok: i.state !== "unavailable" });
    }
    const r = read;
    r("waiting", "decisions", "Decizii", "now", "Deciziile mele", "decisions_inbox", () => decisionRows());
    r("waiting", "plans", "Planuri de confirmat", "now", "Planuri propuse", "plans_proposed", () => {
      const inInbox = new Set(decisionsInbox(hub).items.filter((i) => i.kind === "delivery_correction").map((i) => i.id));
      return projectRows([...all("SELECT * FROM mission_envelopes"), ...all("SELECT p.*, (SELECT d.project_id FROM delivery_revisions r JOIN deliveries d ON d.id = r.delivery_id WHERE r.ops_plan_id = p.id ORDER BY r.created_at DESC LIMIT 1) AS project_id FROM ops_plans p").filter((p) => !inInbox.has(p.id))].filter((p) => p.status === "PROPOSED" && Date.parse(p.confirm_by) > now.getTime()));
    });
    r("waiting", "blocked", "Blocaje", "now", "Fabrica și cererile păstrate", "blocked", () => projectRows([...hub.factory.list().filter((m) => m.stage === "BLOCKED"), ...all("SELECT * FROM work_requests").filter((w) => ["OPEN", "BLOCKED"].includes(w.status) && Date.parse(w.expires_at) > now.getTime())]));
    r("waiting", "approvals", "Aprobări tehnice", "now", "Aprobări tehnice", "approvals_pending", () => hub.approvals.list("pending").length);
    r("work", "active", "În lucru acum", "now", "Fabrica", "factory_missions", () => projectRows(hub.factory.list().filter((m) => ACTIVE_STAGES.has(m.stage) && !["PAUSED", "CANCEL_REQUESTED"].includes(m.stage))));
    r("work", "paused", "În pauză sau se opresc", "now", "Fabrica", "factory_missions", () => projectRows(hub.factory.list().filter((m) => ["PAUSED", "CANCEL_REQUESTED"].includes(m.stage))));
    r("work", "ready", "Ajunse gata de livrare", "interval", "Fabrica", "factory_events", () => projectRows([...new Set(interval(all("SELECT * FROM events WHERE type = 'factory.stage'")).filter((e) => JSON.parse(e.payload_json || "{}").stage === "DELIVERY_READY").map((e) => e.mission_id || e.scope_id))].map((id) => hub.db.prepare("SELECT project_id FROM missions WHERE id = ?").get(id) || {})));
    r("work", "runs", "Rulări de model", "interval", "Rulările de model", "agent_runs", () => projectRows(interval(all("SELECT r.*, t.project_id FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id"))));
    const bundles = () => all("SELECT b.*, m.project_id FROM factory_bundles b LEFT JOIN missions m ON m.id = b.mission_id");
    r("results", "bundles_ready", "Pachete de acceptat", "now", "Fabrica", "factory_bundles", () => projectRows(bundles().filter((b) => b.status === "READY_FOR_OWNER_ACCEPTANCE")));
    r("results", "accepted", "Acceptate de tine", "interval", "Fabrica", "factory_bundles", () => projectRows(interval(bundles().filter((b) => b.status === "OWNER_ACCEPTED"), "decided_at")));
    r("results", "deliveries", "Livrări pregătite", "now", "Livrările", "deliveries", () => projectRows(all("SELECT * FROM deliveries WHERE status IN ('READY','NEEDS_OWNER')")));
    r("results", "qa_warn", "Avertismente QA la clipuri", "interval", "QA media", "media_qa_reports", () => projectRows(interval(all("SELECT q.*, (SELECT d.project_id FROM media_edit_versions v JOIN deliveries d ON d.edit_project_id = v.edit_project_id WHERE v.id = q.edit_version_id ORDER BY d.created_at DESC LIMIT 1) AS project_id FROM media_qa_reports q WHERE q.status IN ('WARN','FAIL')"))));
    r("sales", "open", "Oportunități deschise", "now", "Vânzări", "sales_opportunities", () => all(`SELECT o.*, CASE WHEN o.synthetic = 1 OR g.synthetic = 1 THEN 1 ELSE 0 END AS synthetic FROM sales_opportunities o JOIN sales_orgs g ON g.id = o.org_id WHERE o.status NOT IN (${CLOSED_OPPORTUNITY.map(() => "?").join(",")})`, ...CLOSED_OPPORTUNITY));
    r("sales", "prepared", "Oferte pregătite", "interval", "Vânzări", "sales_proposals", () => interval(salesRows("sales_proposals")));
    r("sales", "approved", "Aprobate intern", "interval", "Vânzări", "sales_proposals", () => interval(salesRows("sales_proposals"), "approved_at"));
    r("sales", "sent", "Trimise de Hub", "interval", "Vânzări", "sales_contact_events", () => {
      if (hub.sales.overview().outreach === "DISABLED") return { value: null, display: "dezactivată", state: "disabled", note: NO_SEND };
      const rows = interval(salesRows("sales_contact_events").filter((r) => r.kind === "SENT_VIA_HUB"), "occurred_at");
      return { value: rows.length, ...provenanceOf(rows), note: "transport de test" };
    });
    for (const [name, kind, label] of [["ops", "ops_start", "Dosare de pornire (OPS)"], ["sup", "support_case", "Cazuri de suport (SUP)"], ["dvz", "finance_doc", "Devize (DVZ)"]]) r("desk", name, label, "interval", "Birou intern", "desk_records", () => interval(all("SELECT * FROM desk_records WHERE kind = ?", kind)));
    r("desk", "active", "În lucru acum", "now", "Birou intern", "desk_records", () => all("SELECT * FROM desk_records WHERE status IN ('PREPARING','PACKAGING')"));
    r("system", "mode", "Modul Hub-ului", "now", "Setările Hub-ului", "settings", () => hub.settings.get("mode") || { value: null, display: "necunoscut", state: "unknown" });
    r("system", "gate", "Poarta de execuție", "now", "Setările Hub-ului", "settings", () => { const gate = hub.settings.get("executionGate"); return gate ? { value: gate.status !== "open" ? "suspended" : "open", display: gate.status !== "open" ? "suspendată" : "deschisă", note: gate.reason ? String(gate.reason).slice(0, 140) : null } : { value: null, display: "necunoscut", state: "unknown" }; });
    r("system", "backup", "Ultimul backup verificat", "now", "Backupuri verificate", "backups", () => { const b = hub.db.prepare("SELECT * FROM backups WHERE project_id = ? AND status = 'verified' ORDER BY created_at DESC LIMIT 1").get(hub.projects.hub()?.id || ""); return b ? { value: Math.max(0, Math.floor((now - new Date(b.restore_verified_at || b.created_at)) / 60000)), unit: "min", display: bucharestDayStart(new Date(b.restore_verified_at || b.created_at)).getTime() === bucharestDayStart(now).getTime() ? `azi la ${hhmm(b.restore_verified_at || b.created_at)}` : dateTimeRo(b.restore_verified_at || b.created_at), note: "verificat prin restaurare" } : { value: null, display: "necunoscut", state: "unknown", note: "Niciun backup verificat înregistrat." }; });
    r("system", "failures", "Execuții eșuate", "interval", "Rulările de model", "agent_runs", () => projectRows(interval(all("SELECT r.*, t.project_id FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.status IN ('failed','interrupted_unknown','orphaned') OR (r.status = 'blocked' AND COALESCE(r.error_category,'') <> 'gate')"))));
    for (const c of chapters) {
      const failed = c.indicators.filter((i) => i.state === "unavailable").length;
      const kinds = new Set(c.indicators.flatMap((i) => i.provenance === "mixed" ? ["real", "synthetic"] : [i.provenance]));
      if (["sales", "desk"].includes(c.key)) c.badge = kinds.has("synthetic") ? kinds.has("real") ? "REAL + SINTETIC" : "SINTETIC" : null;
      c.state = failed ? failed === c.indicators.length ? "unavailable" : "partial" : c.indicators.every((i) => i.state === "zero") ? "nothing_new" : "ok";
      c.sentences = recapSentences(c, period);
      c.speech = `${c.index === 0 ? `${recapOpening({ kind: period, from, to, fallback })} ` : ""}Capitolul ${c.index + 1} din 6, ${c.title}. ${c.sentences.join(" ")}${c.index < 5 ? ` Spune „următorul” pentru ${META[c.index + 1][1]}.` : " Acesta a fost ultimul capitol."}`;
    }
    const indicators = chapters.flatMap((c) => c.indicators);
    const snapshot = deepFreeze({ id: newId(period === "now" ? "rcpn" : "rcp"), generatedAt: to, lastSeq: hub.bus.lastSeq(), tz: TZ, ...(projectId && hub.projects.get(projectId) ? { projectId } : {}), period: { kind: period, from, to, label, firstVisit, fallback }, scope: "company", provenance: { real: indicators.some((i) => ["real", "mixed"].includes(i.provenance)), synthetic: indicators.some((i) => ["synthetic", "mixed"].includes(i.provenance)) }, chapters });
    if (period !== "now") {
      clean(); store.set(snapshot.id, { snapshot, storedAt: clock().getTime() });
      while (store.size > 50) { const id = [...store.keys()].find((id) => !isHeld(id)); if (!id) break; store.delete(id); }
    }
    return snapshot;
  }
  return { build, get };
}
