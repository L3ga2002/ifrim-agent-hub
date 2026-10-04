import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * War Room (M08 §08): an operational mode over the existing missions. "ProDelivery a picat" opens a PROPOSED incident and asks for
 * what is needed; it never concludes that anything is offline from the sentence alone and never starts changes in production.
 *
 * - Signals keep their source and stay UNCONFIRMED until a verifiable source confirms them.
 * - The recommended priority (a heuristic on the report) and the confirmed impact (the owner's statement) are different fields.
 * - Hypotheses are checked: a model's or Lega's explanation is a hypothesis, never adopted as the cause; confirming one needs evidence.
 * - Flow: triage → reproduction in a safe environment (the remediation mission's BASELINE, inside the envelope) → remediation
 *   proposal (a draft BUGFIX mission) → authorized Engineering Loop → result for the owner. Rollback, deploy, access to a real
 *   database and messages to clients stay separate decisions; War Room may PROPOSE pausing non-critical missions, never do it.
 */
export const INCIDENT_STATUSES = Object.freeze(["PROPOSED", "TRIAGE", "REPRODUCING", "REMEDIATION", "MONITORING", "RESOLVED", "DISMISSED"]);
const TRANSITIONS = Object.freeze({
  PROPOSED: ["TRIAGE", "DISMISSED"], TRIAGE: ["REPRODUCING", "REMEDIATION", "MONITORING", "DISMISSED"], REPRODUCING: ["REMEDIATION", "TRIAGE", "DISMISSED"],
  REMEDIATION: ["MONITORING", "TRIAGE"], MONITORING: ["RESOLVED", "TRIAGE"], RESOLVED: ["TRIAGE"], DISMISSED: ["TRIAGE"],
});
export const ENTRY_KINDS = Object.freeze(["signal", "hypothesis", "action", "evidence", "note", "timeline"]);
/** Sources whose word can confirm a signal (the owner, or a check the Hub ran itself); everything else stays unconfirmed. */
const CONFIRMING_SOURCES = new Set(["owner", "hub-check"]);
const MODEL_SOURCES = new Set(["model", "lega", "tool", "document", "web", "email", "review"]);
const NEEDED = Object.freeze([
  "Ce anume nu merge (pagina, endpoint-ul sau fluxul) și ce vezi exact (mesajul de eroare)",
  "De când (ora aproximativă) și dacă s-a schimbat ceva atunci",
  "Cine e afectat (toți utilizatorii, un client, doar tu)",
  "Ce verificare autorizată pot rula (un test local, un health check pe un URL pe care mi-l dai)",
]);

/** A priority RECOMMENDED from the words of the report (never the confirmed impact). */
export function recommendPriority(text) {
  const t = String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (/\b(a picat|e jos|este jos|nu merge deloc|nu mai merge|nimeni nu poate|clientii nu pot|down|offline|pierdem (bani|comenzi))\b/.test(t)) return { level: "P1", reason: "descrierea sugerează o întrerupere completă (neconfirmat)" };
  if (/\b(eroare|nu merge|greseste|lent|incet|uneori)\b/.test(t)) return { level: "P2", reason: "descrierea sugerează o funcționare degradată (neconfirmat)" };
  return { level: "P3", reason: "descrierea nu indică o întrerupere (neconfirmat)" };
}

export function createWarRoom({ db, bus, clock, projects, twin, missions, factory, commands }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, projectId: r.project_id, title: r.title, status: r.status, reportedText: r.reported_text, reportedBy: r.reported_by, reportSource: r.report_source,
    priorityRecommended: parse(r.priority_recommended, null), impactConfirmed: parse(r.impact_confirmed_json, null), responsible: r.responsible, versionRef: parse(r.version_ref_json, {}),
    components: parse(r.components_json, []), recentChanges: parse(r.recent_changes_json, []), remediationMissionId: r.remediation_mission_id, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at });
  const entryTo = (e) => ({ id: e.id, incidentId: e.incident_id, kind: e.kind, status: e.status, text: e.text, sourceKind: e.source_kind, sourceRef: e.source_ref, actor: e.actor, createdAt: e.created_at, updatedAt: e.updated_at });
  const need = (id) => { const r = rowTo(db.prepare("SELECT * FROM incidents WHERE id = ?").get(id)); if (!r) throw new HubError("not_found", "Incident necunoscut"); return r; };

  function insertEntry(incidentId, { kind, text, sourceKind, sourceRef = "", status = "UNCONFIRMED", actor }) {
    if (!ENTRY_KINDS.includes(kind)) throw new HubError("validation", "Tip de intrare necunoscut");
    const id = newId("ine");
    const t = iso();
    db.prepare("INSERT INTO incident_entries (id, incident_id, kind, status, text, source_kind, source_ref, actor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, incidentId, kind, status, redactText(String(text || "")).slice(0, 2000), String(sourceKind || "owner").slice(0, 40), String(sourceRef || "").slice(0, 300), String(actor || "hub").slice(0, 80), t, t);
    return id;
  }

  /** "<proiect> a picat": a PROPOSED incident with the report as an UNCONFIRMED signal, the context the Hub has, and what it needs. */
  function propose({ projectId, text, reportedBy, source = "owner" }) {
    const p = projects.get(projectId);
    if (!p) throw new HubError("not_found", "Proiect necunoscut");
    const report = String(text || "").trim();
    if (report.length < 3) throw new HubError("validation", "Descrie pe scurt ce s-a întâmplat");
    const open = db.prepare("SELECT id FROM incidents WHERE project_id = ? AND status NOT IN ('RESOLVED','DISMISSED') ORDER BY created_at DESC LIMIT 1").get(p.id);
    const priority = recommendPriority(report);
    const recent = twin.recentChanges(p.id, 72);
    const version = twin.versionRef(p.id);
    const id = newId("inc");
    const t = iso();
    bus.transaction(() => {
      db.prepare(`INSERT INTO incidents (id, project_id, title, status, reported_text, reported_by, report_source, priority_recommended, impact_confirmed_json, version_ref_json, components_json, recent_changes_json, created_at, updated_at)
        VALUES (?, ?, ?, 'PROPOSED', ?, ?, ?, ?, NULL, ?, '[]', ?, ?, ?)`).run(id, p.id, `Raport: ${redactText(report).slice(0, 120)}`, redactText(report).slice(0, 2000), String(reportedBy || "owner").slice(0, 80),
          String(source).slice(0, 40), json(priority), json(version), json(recent.slice(0, 20)), t, t);
      insertEntry(id, { kind: "signal", text: report, sourceKind: source === "owner" ? "owner" : source, status: "UNCONFIRMED", actor: reportedBy });
      insertEntry(id, { kind: "timeline", text: `Incident propus din raportul tău. Nimic nu a fost oprit, modificat sau trimis cuiva.`, sourceKind: "hub", actor: "hub" });
      bus.append({ type: "incident.proposed", scopeType: "incident", scopeId: id, projectId: p.id, source: reportedBy, payload: { title: report.slice(0, 120), priority: priority.level } });
    });
    return { incident: view(id), existingOpen: open?.id || null, needed: NEEDED,
      note: "Am deschis un incident PROPUS. Raportul tău este un semnal neconfirmat: nu presupun că ceva e offline și nu pornesc nicio modificare." };
  }

  function view(id) {
    const r = need(id);
    const entries = db.prepare("SELECT * FROM incident_entries WHERE incident_id = ? ORDER BY created_at").all(id).map(entryTo);
    const mission = r.remediationMissionId ? factory.view(r.remediationMissionId) : null;
    return { ...r, entries, signals: entries.filter((e) => e.kind === "signal"), hypotheses: entries.filter((e) => e.kind === "hypothesis"), actions: entries.filter((e) => e.kind === "action"),
      evidence: entries.filter((e) => e.kind === "evidence"), timeline: entries.filter((e) => e.kind === "timeline" || e.kind === "note"),
      remediation: mission ? { missionId: mission.mission.id, title: mission.mission.title, stage: mission.factory.stage } : null,
      impactState: r.impactConfirmed ? "CONFIRMED" : "UNCONFIRMED", allowedNext: TRANSITIONS[r.status] || [],
      neverAutomatic: ["rollback", "deploy", "acces la o bază de date reală", "mesaje către clienți", "oprirea altor misiuni"] };
  }

  /** A signal, hypothesis, action, piece of evidence or note. Model/tool content is a hypothesis or note, always UNCONFIRMED. */
  function addEntry(incidentId, { kind, text, sourceKind = "owner", sourceRef = "", status = null, actor }) {
    const r = need(incidentId);
    if (["RESOLVED", "DISMISSED"].includes(r.status) && kind !== "note") throw new HubError("conflict", "Incidentul e închis; redeschide-l (triaj) ca să adaugi");
    let finalStatus = status || "UNCONFIRMED";
    if (MODEL_SOURCES.has(sourceKind)) {
      if (!["hypothesis", "note"].includes(kind)) throw new HubError("policy", "Conținutul unui model sau tool intră doar ca ipoteză sau notă");
      finalStatus = "UNCONFIRMED";
    }
    if (finalStatus === "CONFIRMED" && (!CONFIRMING_SOURCES.has(sourceKind) || !String(sourceRef || "").trim())) throw new HubError("validation", "O confirmare cere sursa ta sau o verificare a Hub-ului, cu referință");
    const id = bus.transaction(() => {
      const eid = insertEntry(incidentId, { kind, text, sourceKind, sourceRef, status: finalStatus, actor });
      db.prepare("UPDATE incidents SET version = version + 1, updated_at = ? WHERE id = ?").run(iso(), incidentId);
      bus.append({ type: "incident.entry", scopeType: "incident", scopeId: incidentId, projectId: r.projectId, source: actor, payload: { kind, status: finalStatus } });
      return eid;
    });
    return { entryId: id, incident: view(incidentId) };
  }

  /** A hypothesis is confirmed only with evidence (a check, a log reference, a reproduction); refuting needs a reason. */
  function verifyEntry(entryId, { status, evidenceRef = "", reason = "", actor, sourceKind = "owner" }) {
    const e = db.prepare("SELECT * FROM incident_entries WHERE id = ?").get(entryId);
    if (!e) throw new HubError("not_found", "Intrare necunoscută");
    if (!["CONFIRMED", "REFUTED"].includes(status)) throw new HubError("validation", "Stare: CONFIRMED sau REFUTED");
    if (status === "CONFIRMED" && (!String(evidenceRef).trim() || !CONFIRMING_SOURCES.has(sourceKind))) throw new HubError("validation", "Confirmarea cere o dovadă (referință) de la tine sau de la o verificare a Hub-ului");
    if (status === "REFUTED" && !String(reason || evidenceRef).trim()) throw new HubError("validation", "Spune de ce o respingi");
    const r = need(e.incident_id);
    bus.transaction(() => {
      db.prepare("UPDATE incident_entries SET status = ?, source_ref = CASE WHEN ? <> '' THEN ? ELSE source_ref END, updated_at = ? WHERE id = ?").run(status, evidenceRef, evidenceRef, iso(), entryId);
      insertEntry(e.incident_id, { kind: "timeline", text: `${e.kind === "hypothesis" ? "Ipoteza" : "Semnalul"} „${e.text.slice(0, 80)}” → ${status}${reason ? ` (${reason})` : ""}`, sourceKind, sourceRef: evidenceRef, actor });
      db.prepare("UPDATE incidents SET version = version + 1, updated_at = ? WHERE id = ?").run(iso(), e.incident_id);
      bus.append({ type: "incident.verified", scopeType: "incident", scopeId: e.incident_id, projectId: r.projectId, source: actor, payload: { entryId, status } });
    });
    return view(e.incident_id);
  }

  /** The owner's statement of the real impact (separate from the recommended priority). */
  function confirmImpact(incidentId, { impact, actor }) {
    const r = need(incidentId);
    const clean = { who: redactText(String(impact?.who || "")).slice(0, 300), what: redactText(String(impact?.what || "")).slice(0, 500), since: String(impact?.since || "").slice(0, 40),
      severity: ["P1", "P2", "P3"].includes(impact?.severity) ? impact.severity : null };
    if (!clean.what) throw new HubError("validation", "Descrie impactul confirmat");
    bus.transaction(() => {
      db.prepare("UPDATE incidents SET impact_confirmed_json = ?, version = version + 1, updated_at = ? WHERE id = ?").run(json({ ...clean, confirmedBy: actor, at: iso() }), iso(), incidentId);
      insertEntry(incidentId, { kind: "timeline", text: `Impact confirmat de proprietar: ${clean.what}`, sourceKind: "owner", actor });
      bus.append({ type: "incident.impact_confirmed", scopeType: "incident", scopeId: incidentId, projectId: r.projectId, source: actor, payload: { severity: clean.severity } });
    });
    return view(incidentId);
  }

  function setComponents(incidentId, { components = [], actor, sourceKind = "owner" }) {
    const r = need(incidentId);
    const list = (Array.isArray(components) ? components : []).map((c) => ({ name: String(c?.name || c).slice(0, 80), kind: sourceKind === "owner" ? "DECLARED" : "HYPOTHESIS", source: sourceKind })).filter((c) => c.name).slice(0, 20);
    bus.transaction(() => {
      db.prepare("UPDATE incidents SET components_json = ?, version = version + 1, updated_at = ? WHERE id = ?").run(json(list), iso(), incidentId);
      insertEntry(incidentId, { kind: "timeline", text: `Componente: ${list.map((c) => `${c.name} (${c.kind})`).join(", ") || "—"}`, sourceKind, actor });
    });
    void r;
    return view(incidentId);
  }

  function transition(incidentId, { to, reason = "", actor }) {
    const r = need(incidentId);
    if (!INCIDENT_STATUSES.includes(to)) throw new HubError("validation", "Stare necunoscută");
    if (!(TRANSITIONS[r.status] || []).includes(to)) throw new HubError("conflict", `Din ${r.status} nu se poate trece în ${to}`);
    if (to === "RESOLVED" && !db.prepare("SELECT 1 FROM incident_entries WHERE incident_id = ? AND kind = 'evidence' AND status = 'CONFIRMED'").get(incidentId)) {
      throw new HubError("validation", "Rezolvarea cere o dovadă confirmată (de ex. testul de reproducere trece, verificarea ta)");
    }
    bus.transaction(() => {
      db.prepare("UPDATE incidents SET status = ?, version = version + 1, updated_at = ?, closed_at = CASE WHEN ? IN ('RESOLVED','DISMISSED') THEN ? ELSE NULL END WHERE id = ?").run(to, iso(), to, iso(), incidentId);
      insertEntry(incidentId, { kind: "timeline", text: `${r.status} → ${to}${reason ? `: ${reason}` : ""}`, sourceKind: "owner", actor });
      bus.append({ type: "incident.status", scopeType: "incident", scopeId: incidentId, projectId: r.projectId, source: actor, payload: { from: r.status, to, title: r.title } });
    });
    return view(incidentId);
  }

  /**
   * A remediation mission (BUGFIX) prepared as a DRAFT through the normal factory command: nothing starts. Its BASELINE is the
   * reproduction in a safe environment (the acceptance test must fail before the fix). The spec stays incomplete until the test
   * that reproduces the problem is named — an envelope cannot cover an incomplete spec.
   */
  async function proposeRemediation(incidentId, { testRef = "", verification = null, actor, channel = "ui", ownerSession = null }) {
    const r = need(incidentId);
    if (r.remediationMissionId) return { incident: view(incidentId), missionId: r.remediationMissionId, existing: true };
    const confirmed = db.prepare("SELECT text FROM incident_entries WHERE incident_id = ? AND kind IN ('hypothesis','signal','evidence') AND status = 'CONFIRMED' ORDER BY created_at").all(incidentId).map((e) => e.text);
    const spec = {
      inScope: ["remedierea problemei reproduse", "testul care o reproduce"], outOfScope: ["deploy", "rollback în producție", "acces la baza de date reală", "mesaje către clienți"],
      acceptance: [{ id: "AC-1", text: `Problema din incidentul „${r.title.slice(0, 80)}” nu se mai reproduce`, verify: "test", ...(testRef ? { testRef } : {}) }],
      constraints: ["Doar în mediul sigur al proiectului", "Fără date reale"],
      verification: verification || { checks: ["npm test"], acceptance: testRef ? [`node --test ${testRef}`] : [], preview: null },
      sources: { user: [r.reportedText], code: [], assumptions: confirmed.length ? confirmed.slice(0, 5) : ["Nicio ipoteză confirmată încă: reproducerea (baseline) o va verifica."] },
    };
    const result = await commands.dispatch({ type: "factory.prepare", channel, actor, ownerSession, payload: { projectId: r.projectId, workType: "BUGFIX", title: `Remediere: ${r.title.replace(/^Raport: /, "").slice(0, 120)}`,
      objective: `Reproduce în mediul sigur și remediază: ${r.reportedText.slice(0, 600)}`, spec } });
    const missionId = result.result?.mission?.id;
    bus.transaction(() => {
      db.prepare("UPDATE incidents SET remediation_mission_id = ?, version = version + 1, updated_at = ? WHERE id = ?").run(missionId, iso(), incidentId);
      insertEntry(incidentId, { kind: "action", text: `Misiune de remediere pregătită (ciornă, nu rulează): ${missionId}`, sourceKind: "hub", sourceRef: missionId, status: "CONFIRMED", actor });
      bus.append({ type: "incident.remediation_proposed", scopeType: "incident", scopeId: incidentId, projectId: r.projectId, source: actor, payload: { missionId } });
    });
    // M09: the draft carries no models (War Room never picks them): its scope stays incomplete until the owner fixes the writer and
    // reviewer models explicitly (Limite → modele); no account default is used in their place.
    const draftView = missionId && factory?.view ? factory.view(missionId) : null;
    const modelsNote = draftView && !draftView.scope && (draftView.scopeProblems || []).length ? " Alege explicit modelele writer-ului și reviewer-ului (fără modelul implicit al contului) înainte de plan." : "";
    return { incident: view(incidentId), missionId, note: (testRef ? "Ciorna e completă dacă specificația nu are alte probleme; pornește doar după planul confirmat de tine." : "Ciorna are nevoie de testul care reproduce problema (testRef) înainte să poată intra într-un plan.") + modelsNote };
  }

  /** Missions that could be paused to free attention — a PROPOSAL; War Room never pauses anything itself. */
  function suggestPause(incidentId) {
    const r = need(incidentId);
    const active = factory.list().filter((f) => !["DELIVERY_READY", "ACCEPTED", "REJECTED", "CANCELLED", "SPEC_DRAFT", "PAUSED", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(f.stage));
    return { incidentId, candidates: active.filter((f) => f.missionId !== r.remediationMissionId).map((f) => ({ missionId: f.missionId, stage: f.stage, projectId: f.projectId })),
      note: "Propunere: aceste misiuni pot fi puse pe pauză dacă vrei să eliberezi resursele. Nu le opresc eu; spune „Pauză” sau folosește butoanele." };
  }

  const list = ({ projectId = null, open = false } = {}) => db.prepare(`SELECT * FROM incidents WHERE 1 = 1 ${projectId ? "AND project_id = ?" : ""} ${open ? "AND status NOT IN ('RESOLVED','DISMISSED')" : ""} ORDER BY created_at DESC LIMIT 100`)
    .all(...(projectId ? [projectId] : [])).map(rowTo);

  return { propose, view, addEntry, verifyEntry, confirmImpact, setComponents, transition, proposeRemediation, suggestPause, list, needed: NEEDED };
}
