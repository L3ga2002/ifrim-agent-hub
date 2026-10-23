// M15: ONE vocabulary of work states for the whole Hub, read from what the Hub reports (never invented): ready, in progress, your decision,
// something missing / blocked, an error you can continue from, a result ready, an outdated (STALE) result, an expired decision. Each state has
// its own word, its own icon (components/StatePill.jsx) and its own colour; colour is never the only sign. The commercial / document meanings
// (approved internally, accepted by the client, text approved, document generated, document sent, result accepted) are separate MEANINGS:
// a state says where the work is, a meaning says what a decision already made means. Pure functions: nothing here decides or starts anything.

export const STATES = Object.freeze({
  ready: { label: "Pregătit", hint: "Nu rulează nimic și nu așteaptă nimic de la tine." },
  run: { label: "În lucru", hint: "Hub-ul lucrează; poți scrie în continuare, Stop All rămâne la un clic." },
  decide: { label: "Decizia ta", hint: "Așteaptă confirmarea ta pe ținta exactă; nimic nu pornește fără ea." },
  block: { label: "Lipsește ceva", hint: "Lipsesc informații sau o condiție; nimic nu e ghicit." },
  error: { label: "Eroare · poți continua", hint: "Ce era salvat e păstrat; motivul și următoarea acțiune sunt afișate." },
  done: { label: "Rezultat gata", hint: "Rezultatul e verificat și te așteaptă; gata nu înseamnă acceptat." },
  stale: { label: "Depășit", hint: "Ceva s-a schimbat după ce rezultatul a fost făcut; motivul și următoarea acțiune sunt afișate." },
  expired: { label: "Expirat", hint: "Fereastra deciziei a trecut; nimic nu s-a executat. Ceri din nou dacă vrei." },
  closed: { label: "Încheiat", hint: "Încheiat sau acceptat; rămâne în istoric." },
});
export const STATE_KEYS = Object.freeze(Object.keys(STATES));

/** The meanings of decisions already made — never mixed up with each other or with a work state. */
export const MEANINGS = Object.freeze({
  approved_internal: { label: "Aprobată intern", says: "decizia ta internă; clientul nu e contactat și Engineering nu pornește" },
  client_accepted: { label: "Acceptată de client", says: "consemnată de tine, cu dovada clientului" },
  text_approved: { label: "Text aprobat", says: "conținutul e aprobat; nu înseamnă trimis" },
  doc_generated: { label: "Document generat", says: "fișier local, netrimis" },
  doc_sent: { label: "Document trimis", says: "trimiterea e dezactivată în Hub" },
  result_accepted: { label: "Rezultat acceptat", says: "software sau livrare acceptate de tine" },
});

const up = (s) => String(s || "").toUpperCase();

/**
 * A domain status → one work state. `domain`: delivery, bundle, desk, sales_prep, dossier, proposal, opportunity, envelope, ops, run,
 * mission (factory stage), render. Unknown statuses fall back to "ready" only when nothing waits; never to "done".
 */
export function stateOf(domain, status) {
  const s = up(status);
  if (!s) return "ready";
  if (s === "STALE" || s === "SUPERSEDED_STALE") return "stale";
  if (s === "EXPIRED") return "expired";
  if (["FAILED", "FAILED_TO_START", "ERROR"].includes(s)) return "error";
  if (["BLOCKED", "STOPPED", "INCOMPLETE", "MISSING_INPUT", "NEEDS_INPUT"].includes(s)) return "block";
  if (["WAITING_OWNER", "NEEDS_OWNER", "NEEDS_OWNER_DECISION", "READY_FOR_OWNER_ACCEPTANCE", "READY_FOR_OWNER_REVIEW", "PENDING_APPROVAL", "PROPOSED", "WAITING_APPROVAL", "PENDING"].includes(s)) return "decide";
  if (["OWNER_ACCEPTED", "APPROVED_INTERNAL", "WON", "CLOSED", "COMPLETED", "ACCEPTED", "DONE"].includes(s)) return domain === "proposal" || domain === "opportunity" ? "done" : "closed";
  if (["CANCELLED", "REVOKED", "REJECTED", "LOST", "SUPERSEDED", "RETIRED"].includes(s)) return "closed";
  if (s === "DELIVERY_READY") return "decide";
  if (s === "READY") return "done";
  if (["RUNNING", "ACTIVE", "ARMED", "CONFIRMED", "PREPARING", "PACKAGING", "WRITING", "PLANNING", "QUEUED", "VERIFYING", "STREAMING", "IN_PROGRESS", "WRITER", "CHECKS", "REVIEW", "REPAIR", "QA", "PREVIEW", "E2E", "APPLYING"].includes(s)) return "run";
  if (["PLANNED", "DRAFT", "SPEC_DRAFT", "IDENTIFIED", "QUALIFIED", "ON_HOLD"].includes(s)) return "ready";
  return "ready";
}

/** The meaning chip of a decided status, or null (a work state is shown instead). */
export function meaningOf(domain, status) {
  const s = up(status);
  if ((domain === "proposal" || domain === "opportunity") && s === "APPROVED_INTERNAL") return "approved_internal";
  if (domain === "opportunity" && s === "WON") return "client_accepted";
  if (domain === "draft" && s === "CONTENT_APPROVED") return "text_approved";
  if ((domain === "desk_doc" || domain === "desk") && s === "APPROVED_INTERNAL") return "approved_internal";
  if (domain === "dossier" && s === "READY") return "doc_generated";
  if (domain === "export" && s === "READY") return "doc_generated";
  if (domain === "bundle" && s === "OWNER_ACCEPTED") return "result_accepted";
  return null;
}

const PRIORITY = { decide: 0, block: 1, error: 2, run: 3, stale: 4, done: 5, expired: 6, ready: 7, closed: 8 };
const ms = (iso) => { const n = Date.parse(iso || ""); return Number.isFinite(n) ? n : 0; };
const INBOX_LABEL = { software_bundle: "Pachet software de acceptat", mission_decision: "Misiune oprită: decizia ta", delivery: "Livrare: deciziile tale", sales_offer: "Ofertă de aprobat intern",
  desk_support_reply: "Răspuns de suport de aprobat", desk_finance_doc: "Deviz de aprobat", delivery_correction: "Corectură propusă" };

/**
 * What needs the owner's attention, from the Hub's own lists (each read-only): the decisions inbox, the desk records, the deliveries, the
 * active runs and the requests the Hub kept while blocked. One row per thing (a delivery whose decisions are in the inbox is not repeated),
 * sorted by state (decisions first) then newest first. Each row names where it is decided or opened (`link`), never an id to remember.
 */
export function attentionItems({ inbox = [], desk = [], deliveries = [], runs = [], workRequests = [], projectId = null, now = Date.now() } = {}) {
  const rows = [];
  const seen = new Set();
  const inProject = (pid) => !projectId || !pid || pid === projectId;
  for (const it of Array.isArray(inbox) ? inbox : []) {
    if (!it || !inProject(it.projectId)) continue;
    const key = `${it.kind}:${it.id}`;
    if (it.kind === "delivery") seen.add(`delivery:${it.id}`);
    if (it.kind === "software_bundle" && String(it.link || "").startsWith("/livrare/")) seen.add(`delivery:${String(it.link).split("/")[2]}`);
    if (it.recordId) seen.add(`desk:${it.recordId}`);
    rows.push({ key, state: "decide", kind: it.kind, title: it.title || INBOX_LABEL[it.kind] || "Decizie", what: INBOX_LABEL[it.kind] || "Decizie",
      sub: [it.projectName, it.why].filter(Boolean).join(" · "), link: it.link || null, deskRecordId: it.recordId || null, at: it.waitingSince || null, target: it.target || null, opportunityId: it.opportunityId || null,
      // „sintetic” where the Hub says the row is not about a real project (M15: delivery rows now say it from the project, not a fixed false).
      synthetic: it.synthetic === true, testProject: it.synthetic !== true && it.real === false });
  }
  for (const r of Array.isArray(desk) ? desk : []) {
    if (!r || !inProject(r.projectId)) continue;
    const state = stateOf("desk", r.status);
    if (seen.has(`desk:${r.id}`)) continue;
    if (!["decide", "block", "error", "stale", "done"].includes(state)) continue;
    if (state === "done" && now - ms(r.updatedAt) > 3 * 24 * 3600e3) continue;
    rows.push({ key: `desk:${r.id}`, state, kind: `desk_${r.kind}`, title: `${r.internalNo ? `${r.internalNo} · ` : ""}${r.title || "Birou intern"}`, what: "Birou intern",
      sub: r.statusReason || r.statusText || "", next: r.nextAction || "", link: "/lega", deskRecordId: r.id, at: r.updatedAt || r.createdAt || null, real: r.synthetic !== true });
  }
  for (const d of Array.isArray(deliveries) ? deliveries : []) {
    if (!d || !inProject(d.projectId) || seen.has(`delivery:${d.id}`)) continue;
    const state = stateOf("delivery", d.status);
    if (!["decide", "error", "stale", "block"].includes(state)) continue; // READY: its pending decisions are already inbox rows
    rows.push({ key: `delivery:${d.id}`, state, kind: "delivery", title: d.title || "Livrare", what: "Camera de livrare", sub: d.statusReason || "", link: `/livrare/${d.id}`, at: d.updatedAt || d.createdAt || null });
  }
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r) continue;
    rows.push({ key: `run:${r.runId}`, state: "run", kind: "run", title: `${r.provider === "codex" ? "Codex" : r.provider === "claude" ? "Claude" : r.provider || "Agent"} ${r.phase === "streaming" ? "lucrează" : "așteaptă providerul"}`,
      what: "Execuție", sub: r.title || "", link: r.conversationId ? `/conversations/${r.conversationId}` : null, at: r.startedAt || null });
  }
  for (const w of Array.isArray(workRequests) ? workRequests : []) {
    if (!w) continue;
    rows.push({ key: `request:${w.id}`, state: "block", kind: "work_request", title: w.text ? `Cererea ta: „${String(w.text).slice(0, 80)}”` : "Cerere păstrată", what: "Cerere păstrată",
      sub: w.blockedBy?.text || w.reason || "păstrată până se poate continua", link: null, at: w.createdAt || null });
  }
  return rows.sort((a, b) => (PRIORITY[a.state] - PRIORITY[b.state]) || (ms(b.at) - ms(a.at)));
}

/** Counts per state for the attention header („3 decizii · 1 blocaj”). */
export function attentionSummary(items = []) {
  const n = (k) => items.filter((x) => x.state === k).length;
  const parts = [];
  if (n("decide")) parts.push(n("decide") === 1 ? "1 decizie" : `${n("decide")} decizii`);
  if (n("block")) parts.push(n("block") === 1 ? "1 blocaj" : `${n("block")} blocaje`);
  if (n("error")) parts.push(n("error") === 1 ? "1 eroare" : `${n("error")} erori`);
  if (n("run")) parts.push(n("run") === 1 ? "1 în lucru" : `${n("run")} în lucru`);
  if (n("stale")) parts.push(n("stale") === 1 ? "1 depășit" : `${n("stale")} depășite`);
  if (n("done")) parts.push(n("done") === 1 ? "1 rezultat" : `${n("done")} rezultate`);
  return parts.length ? parts.join(" · ") : "Nimic nu te așteaptă";
}

/**
 * The open activity on the L3ga screen: what the screen is about right now and its ONE primary action, from real data only. Order: a plan
 * waiting for the owner, an operation plan waiting, a blocked request, an execution running, the first decision in the attention list, the
 * newest delivery ready / outdated, else ready. → { state, title, context, primary: { label, kind } , sub }
 */
export function currentActivity({ projectName = "", plan = null, opsPlan = null, runs = [], workRequests = [], attention = [], deliveries = [], error = null, busy = false } = {}) {
  const ctx = projectName || "Compania";
  if (plan?.envelope?.status === "PROPOSED" || plan?.envelope?.status === "EXPIRED") {
    const expired = plan.envelope.status === "EXPIRED" || (plan.envelope.confirmBy && Date.parse(plan.envelope.confirmBy) <= Date.now());
    return expired
      ? { state: "expired", context: ctx, title: plan.summary?.headline || "Planul propus", sub: "Fereastra de confirmare a trecut; nimic nu a pornit.", primary: { label: "Cere planul din nou", kind: "replan" } }
      : { state: "decide", context: ctx, title: plan.summary?.headline || "Planul propus", sub: "Un plan așteaptă confirmarea ta (o singură confirmare).", primary: { label: "Vezi planul și confirmă", kind: "focus-plan" } };
  }
  if (opsPlan?.status === "PROPOSED") return { state: "decide", context: ctx, title: opsPlan.title || "Planul operației", sub: "Un plan de operație așteaptă confirmarea ta.", primary: { label: "Vezi planul și confirmă", kind: "focus-ops" } };
  if (error) return { state: "error", context: ctx, title: "Cererea nu a mers", sub: `${String(error?.message || error).slice(0, 160)}. Ce era salvat a rămas neschimbat; poți repeta cererea.`, primary: { label: "Scrie din nou cererea", kind: "composer" } };
  if (busy) return { state: "run", context: ctx, title: "Procesez cererea ta", sub: "Citirea și planul nu pornesc nimic.", primary: null };
  const req = (workRequests || [])[0];
  if (req) return { state: "block", context: ctx, title: "O cerere așteaptă o condiție", sub: req.blockedBy?.text || req.reason || "Cererea e păstrată; o continui când se poate.", primary: { label: "Arată ce lipsește", kind: "requests" } };
  const run = (runs || [])[0];
  if (run) return { state: "run", context: ctx, title: `${run.provider === "codex" ? "Codex" : "Claude"} ${run.phase === "streaming" ? "lucrează" : "așteaptă providerul"}${runs.length > 1 ? ` (+${runs.length - 1})` : ""}`, sub: "Poți scrie în continuare; Stop All rămâne la un clic.", primary: { label: "Urmăresc execuția", kind: "link", link: run.conversationId ? `/conversations/${run.conversationId}` : null } };
  const first = (attention || []).find((x) => x.state === "decide" || x.state === "block" || x.state === "error");
  if (first) return { state: first.state, context: ctx, title: first.title, sub: first.sub || first.what, primary: first.link ? { label: first.state === "decide" ? "Deschide locul deciziei" : "Deschide", kind: "link", link: first.link } : null, item: first };
  const latest = (deliveries || []).slice().sort((a, b) => ms(b.updatedAt || b.createdAt) - ms(a.updatedAt || a.createdAt))[0];
  if (latest && ["STALE"].includes(up(latest.status))) return { state: "stale", context: ctx, title: latest.title || "Livrarea", sub: latest.statusReason || "S-a schimbat ceva după ce livrarea a fost pregătită.", primary: { label: "Deschide livrarea", kind: "link", link: `/livrare/${latest.id}` } };
  return { state: "ready", context: ctx, title: projectName ? `Lucrezi la ${projectName}` : "Pregătit de lucru", sub: "Spune sau scrie ce vrei. Citirea și planul nu pornesc nimic.", primary: { label: "Scrie o cerere", kind: "composer" } };
}

/**
 * History without ids to remember: one row per result or revision the Hub keeps (deliveries, Sales offers, desk records), named by what it
 * is, with its date and its state / meaning, newest first. `query` filters by words (title, kind, number). Each row opens where it lives.
 */
export function historyRows({ deliveries = [], desk = [], opportunities = [], renders = [], missions = [] } = {}, { query = "", projectId = null } = {}) {
  const rows = [];
  for (const m of missions || []) {
    if (projectId && m.projectId && m.projectId !== projectId) continue;
    const stage = up(m.stage);
    const state = stage === "ACCEPTED" ? "closed" : stage === "REJECTED" || stage === "CANCELLED" ? "closed" : stage === "NEEDS_OWNER_DECISION" ? "decide" : stateOf("mission", stage);
    rows.push({ key: `mis:${m.missionId}`, at: m.updatedAt || m.createdAt, kind: "Lucrare software", title: m.title || "Misiune", state, status: m.stage,
      meaning: stage === "ACCEPTED" ? "result_accepted" : null, link: `/missions/${encodeURIComponent(m.missionId)}`, why: stage === "DELIVERY_READY" ? "Pachet gata: așteaptă acceptarea ta" : "" });
  }
  for (const d of deliveries || []) {
    if (projectId && d.projectId && d.projectId !== projectId) continue;
    rows.push({ key: `dlv:${d.id}`, at: d.updatedAt || d.createdAt, kind: "Livrare", title: d.title || "Livrare", state: stateOf("delivery", d.status), status: d.status, link: `/livrare/${d.id}`, why: d.statusReason || "" });
  }
  for (const r of desk || []) {
    if (projectId && r.projectId && r.projectId !== projectId) continue;
    const kind = r.kind === "finance_doc" ? "Deviz" : r.kind === "support_case" ? "Caz de suport" : r.kind === "ops_start" ? "Dosar de pornire" : "Birou intern";
    const art = r.artifact ? ` · v${r.artifact.version}` : "";
    rows.push({ key: `dsk:${r.id}`, at: r.updatedAt || r.createdAt, kind, title: `${r.internalNo ? `${r.internalNo} ` : ""}${r.title || kind}${art}`, state: stateOf("desk", r.status), status: r.status,
      meaning: r.artifact?.status === "APPROVED_INTERNAL" ? "approved_internal" : r.export?.status === "READY" ? "doc_generated" : null, link: "/lega", deskRecordId: r.id, why: r.statusReason || "" });
  }
  for (const o of opportunities || []) {
    rows.push({ key: `opp:${o.id}`, at: o.updatedAt || o.createdAt, kind: "Ofertă", title: `${o.title || "Ofertă"}${o.orgName ? ` · ${o.orgName}` : ""}`, state: stateOf("opportunity", o.status), status: o.status,
      meaning: meaningOf("opportunity", o.status), link: `/sales?tab=opp&id=${encodeURIComponent(o.id)}`, synthetic: o.synthetic === true });
  }
  for (const r of renders || []) {
    rows.push({ key: `rnd:${r.id}`, at: r.updatedAt || r.createdAt, kind: "Randare", title: r.title || r.name || `Randare ${r.preset || ""}`.trim(), state: stateOf("render", r.status), status: r.status, link: "/studio" });
  }
  const q = String(query || "").trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  return rows.filter((r) => !words.length || words.every((w) => `${r.kind} ${r.title} ${r.why || ""} ${r.status || ""}`.toLowerCase().includes(w)))
    .sort((a, b) => ms(b.at) - ms(a.at));
}
