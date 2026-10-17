import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * AI Board Meeting (M08 §11): an executive meeting built from the Hub's own data — accepted results, work ready for review, blocks,
 * decisions and observed capacity. The aggregation is deterministic: no model is started to compute a status (an AI summary would
 * be optional, budgeted and cite its evidence; it is not enabled here). Fixed sections (Engineering, Sales, Operations, Risks,
 * Decisions); a department without data says so instead of producing a report.
 *
 * A meeting snapshots its agenda, shows one item at a time (voice: "următorul subiect", "amână"), and keeps versioned minutes:
 * presented → decided by the owner / deferred / rejected. A recommendation decided in a meeting is RECORDED — it never activates a
 * campaign, a grant or a mission by itself. Offer prices are not revenue, an unaccepted bundle is not a delivery, a qualified lead is
 * not a won client.
 */
export const BOARD_SECTIONS = Object.freeze(["engineering", "sales", "operations", "risks", "decisions"]);
const SECTION_RO = { engineering: "Engineering", sales: "Vânzări", operations: "Operațiuni", risks: "Riscuri", decisions: "Decizii" };
export const ITEM_STATUSES = Object.freeze(["PRESENTED", "PROPOSED", "DECIDED", "DEFERRED", "REJECTED"]);

export function createBoard({ db, bus, clock, settings, sales, factory, approvals, envelopes, warroom, autopilot, company, environments, packages = null }) {
  const iso = (d = clock()) => d.toISOString();
  const meetingRow = (r) => r && ({ id: r.id, title: r.title, periodFrom: r.period_from, periodTo: r.period_to, status: r.status, agenda: parse(r.agenda_json, {}), cursor: r.cursor,
    minutes: parse(r.minutes_json, []), openedBy: r.opened_by, createdAt: r.created_at, closedAt: r.closed_at, version: r.version });
  const itemRow = (r) => r && ({ id: r.id, meetingId: r.meeting_id, position: r.position, section: r.section, sectionLabel: SECTION_RO[r.section] || r.section, kind: r.kind, title: r.title,
    body: parse(r.body_json, {}), status: r.status, decidedBy: r.decided_by, decisionNote: r.decision_note, decidedAt: r.decided_at, carriedFrom: r.carried_from, version: r.version, createdAt: r.created_at });

  /** The agenda computed now from the data (pure read). `from`: start of the period (default: 7 days ago). */
  function agenda({ from = null } = {}) {
    const to = clock();
    const since = from ? new Date(from) : new Date(to.getTime() - 7 * 86400000);
    const s = iso(since);
    const items = [];
    const add = (section, kind, title, body = {}) => items.push({ section, kind, title: redactText(String(title)).slice(0, 200), body });
    // --- Engineering ---
    const missionsAll = factory.list();
    const titleOf = (id) => db.prepare("SELECT title FROM missions WHERE id = ?").get(id)?.title || id;
    const accepted = db.prepare("SELECT id, mission_id, decided_at FROM factory_bundles WHERE status = 'OWNER_ACCEPTED' AND decided_at > ?").all(s);
    const ready = db.prepare("SELECT id, mission_id, created_at FROM factory_bundles WHERE status = 'READY_FOR_OWNER_ACCEPTANCE' ORDER BY created_at").all();
    const active = missionsAll.filter((f) => !["DELIVERY_READY", "ACCEPTED", "REJECTED", "CANCELLED", "SPEC_DRAFT", "PAUSED", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(f.stage));
    const stuck = missionsAll.filter((f) => ["PAUSED", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(f.stage));
    add("engineering", "info", `Livrări acceptate de tine în perioadă: ${accepted.length}`, { items: accepted.map((b) => ({ bundleId: b.id, mission: titleOf(b.mission_id), at: b.decided_at })), source: "factory_bundles (OWNER_ACCEPTED)" });
    add("engineering", "info", `Pachete gata, care așteaptă acceptarea ta: ${ready.length}`, { items: ready.map((b) => ({ bundleId: b.id, missionId: b.mission_id, mission: titleOf(b.mission_id), at: b.created_at })),
      note: "Un pachet neacceptat nu e o livrare. Acceptarea se face în Fabrică, nu din ședință.", source: "factory_bundles (READY_FOR_OWNER_ACCEPTANCE)" });
    add("engineering", "info", `Misiuni în lucru: ${active.length} · oprite care cer atenție: ${stuck.length}`, { active: active.map((f) => ({ missionId: f.missionId, title: f.title, stage: f.stage })), stuck: stuck.map((f) => ({ missionId: f.missionId, title: f.title, stage: f.stage, reason: f.stageReason })) });
    const openIncidents = warroom.list({ open: true });
    if (openIncidents.length) add("engineering", "info", `Incidente deschise: ${openIncidents.length}`, { items: openIncidents.map((i) => ({ incidentId: i.id, title: i.title, status: i.status, priorityRecommended: i.priorityRecommended?.level || null, impactConfirmed: Boolean(i.impactConfirmed) })) });
    const objectives = autopilot.list().filter((o) => !["SUPERSEDED"].includes(o.status));
    if (objectives.length) add("engineering", "info", `Obiective Autopilot: ${objectives.length}`, { items: objectives.slice(0, 10).map((o) => ({ objectiveId: o.id, title: o.title, status: o.status, progress: o.progress })) });
    // --- Sales ---
    const ov = sales.overview();
    // M12 (T-S7): the line says when synthetic data is in it, and the real / synthetic split travels with it (additive; real figures
    // never include a synthetic row).
    const syntheticOrgs = ov.split?.synthetic?.orgs || 0;
    // M12 final review (F8): with synthetic data present, the item's figures are the REAL ones (the split's real side); the synthetic ones
    // travel apart (`syntheticFigures`) and the mixed totals only as `totals` — a synthetic row never inflates a real figure here.
    const realSide = ov.synthetic && ov.split ? { orgs: ov.split.real.orgs, opportunities: ov.split.real.opportunities, proposals: ov.split.real.proposals, followups: ov.split.detail?.real?.followups || {} } : null;
    add("sales", "info", `Pipeline de vânzări (activitate numărată din date)${ov.synthetic ? ` (sintetic: ${syntheticOrgs} ${syntheticOrgs === 1 ? "firmă sintetică" : "firme sintetice"}, ${ov.split?.real?.orgs ?? 0} reale)` : ""}`, { orgs: ov.counts.orgs, opportunities: ov.counts.opportunities, proposals: ov.counts.proposals, followups: ov.counts.followups,
      ...(realSide ? { ...realSide, totals: { orgs: ov.counts.orgs, opportunities: ov.counts.opportunities, proposals: ov.counts.proposals, followups: ov.counts.followups },
        syntheticFigures: { orgs: ov.split.synthetic.orgs, opportunities: ov.split.synthetic.opportunities, proposals: ov.split.synthetic.proposals, drafts: ov.split.synthetic.drafts, preparations: ov.split.synthetic.preparations } } : {}),
      synthetic: ov.synthetic, outreach: ov.outreach, note: `${ov.metricsNote} Un preț de ofertă nu e venit; un lead calificat nu e un client câștigat.${realSide ? " Cifrele de aici sunt doar cele reale; datele sintetice sunt numărate separat." : ""}`, source: "sales.overview()",
      split: ov.split ? { real: ov.split.real, synthetic: ov.split.synthetic } : null });
    // --- Operations ---
    const lastBackup = db.prepare("SELECT id, status, created_at FROM backups WHERE status = 'verified' ORDER BY created_at DESC LIMIT 1").get();
    const failedSchedules = db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE status = 'ACTIVE' AND last_result LIKE 'fail%'").get().n;
    const att = environments?.get?.("wsl-runner")?.attestationStatus?.(clock()) || null;
    const expiresAt = att?.latest?.finishedAt ? new Date(new Date(att.latest.finishedAt).getTime() + 14 * 86400000).toISOString() : null;
    add("operations", "info", "Starea operațională", { mode: settings.get("mode"), gate: settings.get("executionGate")?.status || null, lastVerifiedBackup: lastBackup ? { id: lastBackup.id, at: lastBackup.created_at } : null,
      failedSchedules, attestation: att ? { valid: att.valid, reason: att.reason, expiresAt } : null, retainedLeases: db.prepare("SELECT COUNT(*) AS n FROM leases WHERE status = 'retained'").get().n });
    // --- Risks (from data) ---
    const risks = [];
    if (expiresAt && new Date(expiresAt) - to < 3 * 86400000) risks.push({ risk: "Atestarea mediului izolat expiră în mai puțin de 3 zile", action: "Rulează pașii automați (re-atestare)" });
    if (att && !att.valid) risks.push({ risk: `Mediul izolat nu are o atestare validă (${att.reason})`, action: "Re-atestare" });
    if (!lastBackup || to - new Date(lastBackup.created_at) > 7 * 86400000) risks.push({ risk: "Niciun backup verificat în ultimele 7 zile", action: "Rulează un backup" });
    const pkgA = packages?.pending?.("A");
    if (pkgA) risks.push({ risk: "Datele Hub-ului sunt într-un folder sincronizat OneDrive și profilul vocal are acces moștenit larg", action: "Decide pachetul A (protecția datelor)" });
    if (failedSchedules) risks.push({ risk: `${failedSchedules} programări active au eșuat ultima dată`, action: "Vezi Programări" });
    add("risks", "info", risks.length ? `Riscuri din date: ${risks.length}` : "Niciun risc detectat în date", { items: risks, note: "Doar riscurile pe care Hub-ul le poate observa în propriile date." });
    // --- Decisions ---
    const pendingApprovals = approvals.list("pending");
    const pendingPlans = envelopes.pending();
    const drafts = db.prepare("SELECT id, title, decision, source_ref, created_at FROM decisions WHERE status = 'draft' ORDER BY created_at DESC LIMIT 20").all();
    if (pendingApprovals.length) add("decisions", "decision", `Aprobări în așteptare: ${pendingApprovals.length}`, { items: pendingApprovals.slice(0, 10).map((a) => ({ approvalId: a.id, actionKind: a.actionKind, target: a.target })), where: "Aprobări" });
    if (pendingPlans.length) add("decisions", "decision", `Planuri care așteaptă confirmarea: ${pendingPlans.length}`, { items: pendingPlans.map((e) => ({ envelopeId: e.id, headline: e.summary?.headline })), where: "Cockpit-ul proiectului" });
    for (const pkg of packages?.list?.().filter((p) => p.status === "PRESENTED") || []) add("decisions", "decision", `Pachet de decizie ${pkg.kind}: ${pkg.title}`, { packageId: pkg.id, where: "Decizii" });
    for (const d of drafts) add("decisions", "proposal", `Propunere: ${d.title}`, { decisionId: d.id, text: d.decision, source: d.source_ref });
    // --- Departments without data ---
    const missingDepts = (company?.departments?.() || []).filter((d) => d.status !== "active").map((d) => d.name);
    return { from: s, to: iso(to), sections: BOARD_SECTIONS.map((k) => ({ key: k, label: SECTION_RO[k] })), items,
      departmentsWithoutData: missingDepts.length ? { names: missingDepts, note: "Departamente neimplementate: nu există date, deci nu există raport." } : null,
      generatedBy: "agregare deterministă (niciun model pornit)", aiSummary: "neactivat (ar porni un model; cere buget și citează dovezile)" };
  }

  /** Opens a meeting: the agenda is snapshotted into items (plus the items deferred last time). */
  function open({ title = "", from = null, actor }) {
    const existing = db.prepare("SELECT id FROM board_meetings WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1").get();
    if (existing) return view(existing.id);
    const a = agenda({ from });
    const id = newId("brd");
    const t = iso();
    // A deferred item is carried once: into the next meeting. If it is deferred again there, that new copy is the one carried later;
    // once carried (and then decided or not), the original never comes back (review M08: items reappeared after being decided).
    const carried = db.prepare(`SELECT * FROM board_items bi WHERE bi.status = 'DEFERRED' AND bi.meeting_id IN (SELECT id FROM board_meetings WHERE status = 'CLOSED')
      AND NOT EXISTS (SELECT 1 FROM board_items later WHERE later.carried_from = bi.id) ORDER BY bi.created_at`).all();
    bus.transaction(() => {
      db.prepare("INSERT INTO board_meetings (id, title, period_from, period_to, status, agenda_json, cursor, opened_by, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, 0, ?, ?)")
        .run(id, redactText(String(title || `Ședința săptămânală ${clock().toLocaleDateString("ro-RO")}`)).slice(0, 160), a.from, a.to, json({ sections: a.sections, departmentsWithoutData: a.departmentsWithoutData, generatedBy: a.generatedBy, aiSummary: a.aiSummary }), String(actor).slice(0, 80), t);
      let pos = 0;
      const ins = db.prepare("INSERT INTO board_items (id, meeting_id, position, section, kind, title, body_json, status, carried_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const order = (k) => BOARD_SECTIONS.indexOf(k);
      for (const it of [...a.items].sort((x, y) => order(x.section) - order(y.section))) ins.run(newId("bri"), id, pos++, it.section, it.kind, it.title, json(it.body), it.kind === "info" ? "PRESENTED" : "PROPOSED", null, t);
      for (const c of carried) ins.run(newId("bri"), id, pos++, c.section, c.kind, c.title, c.body_json, "PROPOSED", c.id, t);
      bus.append({ type: "board.opened", scopeType: "board", scopeId: id, source: actor, payload: { items: pos } });
    });
    return view(id);
  }

  function view(id) {
    const m = meetingRow(db.prepare("SELECT * FROM board_meetings WHERE id = ?").get(id));
    if (!m) throw new HubError("not_found", "Ședință necunoscută");
    const items = db.prepare("SELECT * FROM board_items WHERE meeting_id = ? ORDER BY position").all(id).map(itemRow);
    return { ...m, items, current: items[m.cursor] || null, remaining: items.filter((i) => ["PRESENTED", "PROPOSED"].includes(i.status) && i.position >= m.cursor).length };
  }

  function move(id, delta, actor) {
    const m = view(id);
    if (m.status !== "OPEN") throw new HubError("conflict", "Ședința e închisă");
    const cursor = Math.max(0, Math.min(m.items.length - 1, m.cursor + delta));
    bus.transaction(() => db.prepare("UPDATE board_meetings SET cursor = ?, version = version + 1 WHERE id = ?").run(cursor, id));
    void actor;
    return view(id);
  }

  /** The owner's decision on an item (recorded only; nothing is activated). Deferring needs no special authority. */
  function decide(itemId, { decision, note = "", actor, ownerSession = null }) {
    const it = itemRow(db.prepare("SELECT * FROM board_items WHERE id = ?").get(itemId));
    if (!it) throw new HubError("not_found", "Subiect necunoscut");
    const m = view(it.meetingId);
    if (m.status !== "OPEN") throw new HubError("conflict", "Ședința e închisă");
    if (!["decide", "defer", "reject", "note"].includes(decision)) throw new HubError("validation", "Decizie: decide, defer, reject sau note");
    if (["decide", "reject"].includes(decision) && !ownerSession) throw new HubError("authentication", "O decizie se înregistrează în sesiunea ta de proprietar (Windows Hello)");
    if (it.kind === "info" && ["decide", "reject"].includes(decision)) throw new HubError("validation", "Un subiect informativ nu cere decizie; poți nota sau amâna");
    const status = { decide: "DECIDED", defer: "DEFERRED", reject: "REJECTED", note: it.status }[decision];
    bus.transaction(() => {
      db.prepare("UPDATE board_items SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?, version = version + 1 WHERE id = ?").run(status, String(actor).slice(0, 80), redactText(String(note)).slice(0, 1000), decision === "note" ? it.decidedAt : iso(), itemId);
      // A decided proposal becomes an active decision in the decision log (still: nothing is executed).
      if (decision === "decide" && it.body?.decisionId) db.prepare("UPDATE decisions SET status = 'active' WHERE id = ? AND status = 'draft'").run(it.body.decisionId);
      if (decision === "reject" && it.body?.decisionId) db.prepare("UPDATE decisions SET status = 'rejected' WHERE id = ? AND status = 'draft'").run(it.body.decisionId);
      bus.append({ type: "board.item_decided", scopeType: "board", scopeId: it.meetingId, source: actor, payload: { itemId, status, kind: it.kind } });
    });
    return view(it.meetingId);
  }

  /** Closes the meeting with versioned minutes (what was presented, decided, deferred, rejected). */
  function close(id, { actor }) {
    const m = view(id);
    if (m.status !== "OPEN") return m;
    const minutes = m.items.map((i) => ({ section: i.sectionLabel, title: i.title, kind: i.kind, status: i.status, note: i.decisionNote || null, decidedBy: i.decidedBy || null }));
    bus.transaction(() => {
      db.prepare("UPDATE board_meetings SET status = 'CLOSED', minutes_json = ?, closed_at = ?, version = version + 1 WHERE id = ?").run(json(minutes), iso(), id);
      bus.append({ type: "board.closed", scopeType: "board", scopeId: id, source: actor, payload: { decided: minutes.filter((x) => x.status === "DECIDED").length, deferred: minutes.filter((x) => x.status === "DEFERRED").length } });
    });
    return view(id);
  }

  const list = () => db.prepare("SELECT * FROM board_meetings ORDER BY created_at DESC LIMIT 20").all().map(meetingRow);
  const current = () => { const r = db.prepare("SELECT id FROM board_meetings WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1").get(); return r ? view(r.id) : null; };
  /**
   * "Ce avem azi?" (Zero-Menu): the same deterministic agenda, from the start of the local day, compacted to what waits for the
   * owner or went wrong, plus the plans that wait for a confirmation. No model.
   */
  function today() {
    const start = clock();
    start.setHours(0, 0, 0, 0);
    const a = agenda({ from: start.toISOString() });
    const important = a.items.filter((i) => i.kind !== "info" || i.body?.items?.length || i.body?.stuck?.length || i.body?.active?.length);
    return { generatedAt: iso(clock()), headline: important.slice(0, 8), all: a.items.length, startView: settings.get("startView") || "cockpit",
      pendingPlans: envelopes.pending().map((e) => ({ envelopeId: e.id, projectId: e.projectId, headline: e.summary?.headline })), generatedBy: a.generatedBy };
  }

  return { agenda, open, view, move, decide, close, list, current, today };
}
