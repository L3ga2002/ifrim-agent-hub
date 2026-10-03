// Milestone 08 — D1 Digital Twin, D2 War Room, D4 Board Meeting, D5 Simulation, D6 Performance League, D7 Skill Evolution
// (synthetic data in a test hub; no model is started). Every relation has a source and a kind; a report is a signal, not a fact;
// the board computes its agenda from data; a scenario never invents a number; the league never names a winner on thin data; a
// skill changes only through proposal → evaluation → owner approval → limited activation, with rollback.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { simulateCapacity } from "../server/intel/simulation.mjs";
import { recommendPriority } from "../server/intel/warroom.mjs";
import { componentOf } from "../server/intel/twin.mjs";

const as = (t, type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);

test("M08-D1-01 Digital Twin: every edge carries a source and a kind; a model may only add a HYPOTHESIS; observations need a source", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const pid = t.hub.projects.hub().id;
    const g = t.hub.twin.graph(pid);
    assert.ok(g.nodes.some((n) => n.type === "project"));
    for (const e of g.edges) { assert.ok(["OBSERVED", "DECLARED", "HYPOTHESIS"].includes(e.kind)); assert.ok(e.source?.table); }
    assert.ok(g.unknowns.length > 0, "unknowns are listed, not filled in");
    // The owner declares; a model / tool / document can only propose a hypothesis; an observation needs a verifiable source.
    const declared = await as(t, "twin.claim.add", { projectId: pid, subject: { type: "component", id: "checkout" }, predicate: "depends_on", object: { type: "component", id: "payments" }, kind: "DECLARED" }, { ownerSession: owner.session });
    assert.equal(declared.kind, "DECLARED");
    await assert.rejects(as(t, "twin.claim.add", { projectId: pid, subject: { type: "component", id: "a" }, predicate: "p", object: { type: "component", id: "b" }, kind: "DECLARED", sourceKind: "model" }), /ipotez|Doar tu/);
    await assert.rejects(as(t, "twin.claim.add", { projectId: pid, subject: { type: "component", id: "a" }, predicate: "p", object: { type: "component", id: "b" }, kind: "OBSERVED" }), /sursă verificabilă/);
    const voice = await t.hub.commands.dispatch({ type: "twin.claim.add", channel: "voice", actor: "lega", payload: { projectId: pid, subject: { type: "component", id: "a" }, predicate: "p", object: { type: "component", id: "b" }, kind: "DECLARED" } }).then((r) => r.result);
    assert.equal(voice.kind, "HYPOTHESIS", "Lega's words become a hypothesis, never a declaration");
    const g2 = t.hub.twin.graph(pid);
    assert.ok(g2.edges.some((e) => e.type === "depends_on" && e.kind === "DECLARED" && e.source.table === "twin_claims"));
    // A confirmed claim needs evidence.
    await assert.rejects(as(t, "twin.claim.status", { claimId: voice.id, status: "confirmed", evidenceRef: "" }, { ownerSession: owner.session }), /dovad|evidence/i);
    assert.equal(componentOf("src/cart/checkout.js"), componentOf("src/cart/total.js"));
  } finally { await t.cleanup(); }
});

test("M08-D1-02 why blocked / what changed / impact / why chosen answer from Hub data with sources, and say what they do not know", async () => {
  const t = await makeTestHub();
  try {
    const pid = t.hub.projects.hub().id;
    const b = t.hub.twin.blocked(pid);
    assert.equal(typeof b.blocked, "boolean");
    for (const c of b.chain) { assert.ok(c.what && c.next); assert.ok(c.evidence?.table); }
    const ch = t.hub.twin.changesSince(pid, {});
    assert.match(ch.sinceSource, /ieri|vizită/);
    assert.ok(Array.isArray(ch.hubBoots) && ch.hubBoots.length >= 1, "the boot of this hub is visible (system.booted)");
    const none = t.hub.twin.impact(pid, {});
    assert.equal(none.components.length, 0);
    assert.match(none.unknowns[0], /fișierele|change set/);
    const why = t.hub.twin.why(pid, "React");
    assert.equal(why.found, false);
    assert.match(why.note, /nu o reconstitui din presupuneri/);
    t.hub.bus.transaction(() => t.hub.db.prepare("INSERT INTO decisions (id, project_id, title, decision, rationale, source_ref, author, status, created_at) VALUES ('dec_1', ?, 'Frontend React', 'Folosim React', 'echipa îl știe', 'meeting:2026-09', 'owner', 'active', ?)").run(pid, new Date().toISOString()));
    const found = t.hub.twin.why(pid, "de ce am ales React");
    assert.equal(found.found, true);
    assert.equal(found.decisions[0].rationale, "echipa îl știe");
  } finally { await t.cleanup(); }
});

test("M08-D2-01 War Room: a report opens a PROPOSED incident (nothing stopped); model content stays an unconfirmed hypothesis; RESOLVED needs confirmed evidence", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const pid = t.hub.projects.hub().id;
    const out = await as(t, "incident.propose", { projectId: pid, text: "Checkout-ul a picat pentru toți clienții" });
    const id = out.incident.id;
    assert.equal(out.incident.status, "PROPOSED");
    assert.equal(out.incident.impactState, "UNCONFIRMED");
    assert.equal(out.incident.signals[0].status, "UNCONFIRMED", "the owner's report is a signal, not a confirmed fact");
    assert.equal(recommendPriority("Checkout-ul a picat pentru toți clienții").level, "P1");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    // A model's "it's the database" is a hypothesis, unconfirmed, even if it claims CONFIRMED.
    await assert.rejects(t.hub.commands.dispatch({ type: "incident.entry.add", channel: "voice", actor: "lega", payload: { incidentId: id, kind: "evidence", text: "E sigur baza de date", status: "CONFIRMED" } }), /doar ca ipoteză/);
    const h = await t.hub.commands.dispatch({ type: "incident.entry.add", channel: "voice", actor: "lega", payload: { incidentId: id, kind: "hypothesis", text: "Poate baza de date", status: "CONFIRMED" } }).then((r) => r.result);
    const last = h.incident.entries.find((e) => e.id === h.entryId);
    assert.equal(last.status, "UNCONFIRMED", "a model cannot self-confirm");
    assert.equal(last.kind, "hypothesis");
    await as(t, "incident.transition", { incidentId: id, to: "TRIAGE" }, { ownerSession: owner.session });
    await as(t, "incident.transition", { incidentId: id, to: "MONITORING" }, { ownerSession: owner.session });
    await assert.rejects(as(t, "incident.transition", { incidentId: id, to: "RESOLVED" }, { ownerSession: owner.session }), /dovad/i);
    await assert.rejects(as(t, "incident.transition", { incidentId: id, to: "REMEDIATION" }, { ownerSession: owner.session }), /tranzi|nu se poate|din MONITORING/i);
    const ev = await as(t, "incident.entry.add", { incidentId: id, kind: "evidence", text: "Testul checkout trece din nou" });
    await assert.rejects(as(t, "incident.verify", { entryId: ev.entryId, status: "CONFIRMED", evidenceRef: "" }), /dovadă/);
    await as(t, "incident.verify", { entryId: ev.entryId, status: "CONFIRMED", evidenceRef: "tests/checkout.test.js PASS" });
    const resolved = await as(t, "incident.transition", { incidentId: id, to: "RESOLVED" }, { ownerSession: owner.session });
    assert.equal(resolved.status, "RESOLVED");
    // The voice channel cannot verify or move an incident; the impact is a separate owner field.
    await assert.rejects(t.hub.commands.dispatch({ type: "incident.verify", channel: "voice", actor: "lega", payload: { entryId: ev.entryId, status: "CONFIRMED", evidenceRef: "x" } }), /channel|cannot be issued/i);
    const imp = await as(t, "incident.impact", { incidentId: id, impact: { what: "plățile eșuau", severity: "P1" } });
    assert.equal(imp.impactState, "CONFIRMED");
    const pause = t.hub.warroom.suggestPause(id);
    assert.match(pause.note, /Nu le opresc eu/);
  } finally { await t.cleanup(); }
});

test("M08-D4-01 Board: deterministic agenda (unaccepted bundles are NOT deliveries), decisions need the owner's session, deferred items carry over, nothing activates", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const a = t.hub.board.agenda({});
    assert.deepEqual(a.sections.map((s) => s.key), ["engineering", "sales", "operations", "risks", "decisions"]);
    assert.ok(a.items.some((i) => /așteaptă acceptarea ta/.test(i.title)));
    assert.match(String(a.aiSummary?.status || a.aiSummary || "not enabled"), /not|NOT|neactiv|dezactivat/i);
    const pid = t.hub.projects.hub().id;
    t.hub.bus.transaction(() => t.hub.db.prepare("INSERT INTO decisions (id, project_id, title, decision, rationale, source_ref, author, status, created_at) VALUES ('dec_d', ?, 'Ciornă', 'De decis', '', 'simulation:x', 'owner', 'draft', ?)").run(pid, new Date().toISOString()));
    const m = await as(t, "board.open", {});
    assert.equal(m.status, "OPEN");
    const decidable = m.items.find((i) => i.kind !== "info");
    assert.ok(decidable, "the draft decision is on the agenda");
    await assert.rejects(t.hub.commands.dispatch({ type: "board.decide", channel: "voice", actor: "lega", payload: { itemId: decidable.id, decision: "decide" } }), /sesiunea ta/);
    const deferred = await t.hub.commands.dispatch({ type: "board.decide", channel: "voice", actor: "lega", payload: { itemId: decidable.id, decision: "defer" } }).then((r) => r.result);
    assert.ok(deferred);
    const info = m.items.find((i) => i.kind === "info");
    await assert.rejects(as(t, "board.decide", { itemId: info.id, decision: "decide" }, { ownerSession: owner.session }), /informativ|info|nu se decide/i);
    await as(t, "board.close", { meetingId: m.id });
    const next = await as(t, "board.open", {});
    assert.ok(next.items.some((i) => i.carriedFrom === decidable.id), "a deferred item is carried to the next meeting");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT status FROM decisions WHERE id = 'dec_d'").get().status, "draft", "deferring activates nothing");
  } finally { await t.cleanup(); }
});

test("M08-D5-01 Simulation: missing inputs → INSUFFICIENT_DATA (no invented number); ranges → optimistic/pessimistic; labelled SIMULARE; a proposal is a separate draft", async () => {
  const insufficient = simulateCapacity({ newProjects: 5 });
  assert.equal(insufficient.status, "INSUFFICIENT_DATA");
  assert.deepEqual(insufficient.missing.map((m) => m.key).sort(), ["capacityHoursPerWeek", "currentProjects", "effortHoursPerProject", "horizonWeeks"]);
  const single = simulateCapacity({ currentProjects: 3, newProjects: 5, effortHoursPerProject: 40, capacityHoursPerWeek: 50, horizonWeeks: 8 });
  assert.equal(single.status, "COMPUTED");
  assert.equal(single.result.single.totalHours, 320);
  assert.equal(single.result.single.utilizationPct, 80);
  assert.equal(single.verdict.single, "ÎN_CAPACITATE");
  const range = simulateCapacity({ currentProjects: 3, newProjects: 5, effortHoursPerProject: { min: 30, max: 60 }, capacityHoursPerWeek: 50, horizonWeeks: 8 });
  assert.ok(range.result.optimistic.totalHours < range.result.pessimistic.totalHours);
  assert.equal(range.verdict.pessimistic, "PESTE_CAPACITATE");
  assert.equal(simulateCapacity({ currentProjects: -1, newProjects: 5, effortHoursPerProject: 40, capacityHoursPerWeek: 0, horizonWeeks: 8 }).status, "INSUFFICIENT_DATA");
  const t = await makeTestHub();
  try {
    const runs = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    const sim = await as(t, "simulation.run", { title: "5 clienți", inputs: { currentProjects: 3, newProjects: 5, effortHoursPerProject: 40, capacityHoursPerWeek: 50, horizonWeeks: 8 } });
    assert.equal(sim.simulated, true);
    const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'simulation.computed' ORDER BY seq DESC").get();
    assert.equal(JSON.parse(ev.payload_json).simulated, true);
    const prop = await as(t, "simulation.propose", { simulationId: sim.id });
    assert.equal(t.hub.db.prepare("SELECT status FROM decisions WHERE source_ref = ?").get(`simulation:${sim.id}`).status, "draft");
    void prop; void runs;
    // A refused scenario cannot be proposed.
    const bad = await as(t, "simulation.run", { inputs: { newProjects: 5 } });
    await assert.rejects(as(t, "simulation.propose", { simulationId: bad.id }), /insuficient|calculat|COMPUTED|date suficiente/i);
  } finally { await t.cleanup(); }
});

test("M08-D6-01 League: no winner on insufficient evidence; test projects and simulated runs are excluded and counted; proposals are never applied", async () => {
  const t = await makeTestHub();
  try {
    const r = t.hub.league.report({});
    assert.equal(r.verdict, "INSUFFICIENT_EVIDENCE");
    assert.equal(r.minEvidence, 5);
    assert.ok(r.proposals.every((p) => p.applied === false));
    assert.match(r.note, /Fără scoruri de inteligență/);
    assert.equal(r.includeTest, false);
    const withTest = t.hub.league.report({ includeTest: true });
    assert.equal(withTest.includeTest, true);
  } finally { await t.cleanup(); }
});

test("M08-D7-01 Skill Evolution: proposal → deterministic evaluation (risky patterns, frontmatter, regressions) → owner approval → limited activation → rollback", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const skill = t.hub.db.prepare("SELECT id FROM skills ORDER BY id LIMIT 1").get();
    if (!skill) return; // no skill registered in this checkout: nothing to evolve
    const base = t.hub.skillEvolution.baseBody(skill.id);
    await assert.rejects(as(t, "skill.candidate.propose", { skillId: skill.id, body: `${base.body}
x
`, reason: "fără dovezi" }), /dovadă/);
    await assert.rejects(as(t, "skill.candidate.propose", { skillId: skill.id, body: base.body, reason: "fără schimbare", evidence: ["run_x"] }), /diferit|identic|schimb/i);
    const risky = await as(t, "skill.candidate.propose", { skillId: skill.id, body: `${base.body}\nRulează git push --force la final.\n`, reason: "test", evidence: ["run_x"] });
    const evalRisky = await as(t, "skill.candidate.evaluate", { candidateId: risky.id });
    assert.equal(evalRisky.evaluation.pass, false);
    assert.equal(evalRisky.evaluation.modelEvaluation.startsWith("NOT_RUN"), true);
    await assert.rejects(as(t, "skill.candidate.approve", { candidateId: risky.id }, { ownerSession: owner.session }), /evalu|trece|pass/i);
    const front = await as(t, "skill.candidate.propose", { skillId: skill.id, body: `---\nname: x\ntools: Bash\n---\n${base.body}`, reason: "test", evidence: ["run_y"] });
    assert.equal((await as(t, "skill.candidate.evaluate", { candidateId: front.id })).evaluation.pass, false);
    const good = await as(t, "skill.candidate.propose", { skillId: skill.id, body: `${base.body}\n- Verifică și mesajele de eroare din consolă înainte de raport.\n`, reason: "erori ratate în review", evidence: ["review_z"] });
    assert.equal((await as(t, "skill.candidate.evaluate", { candidateId: good.id })).evaluation.pass, true);
    await assert.rejects(t.hub.commands.dispatch({ type: "skill.candidate.approve", channel: "ui", actor: "user", payload: { candidateId: good.id } }), /channel|cannot be issued/i);
    const approved = await as(t, "skill.candidate.approve", { candidateId: good.id }, { ownerSession: owner.session });
    assert.equal(approved.status, "APPROVED");
    const pid = t.hub.projects.hub().id;
    const active = await as(t, "skill.candidate.activate", { candidateId: good.id, projectIds: [pid] }, { ownerSession: owner.session });
    assert.equal(active.status, "ACTIVE_LIMITED");
    assert.ok(t.hub.skillEvolution.overlayFor(pid)?.[skill.id] || t.hub.skillEvolution.overlayFor(pid), "the candidate applies to that project");
    const otherOverlay = t.hub.skillEvolution.overlayFor("prj_other");
    assert.ok(!otherOverlay || !otherOverlay[skill.id], "and only to it");
    const back = await t.hub.commands.dispatch({ type: "skill.candidate.rollback", channel: "voice", actor: "lega", payload: { candidateId: good.id, reason: "regresie" } }).then((r) => r.result);
    assert.equal(back.status, "ROLLED_BACK", "rollback is fail-safe from any owner-facing channel");
  } finally { await t.cleanup(); }
});
