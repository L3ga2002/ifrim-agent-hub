import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { TZ, bucharestDayStart, hhmm, dayMonth, dateTimeRo, roCount, roList } from "../server/owner/ro-text.mjs";
import { createRecap, provenanceOf, recapSentences } from "../server/owner/recap.mjs";
import { funnelOf, funnelThreshold, salesFunnel } from "../server/sales/funnel.mjs";
import { traceOf } from "../server/factory/trace.mjs";
import { systemMap } from "../server/domain/system-map.mjs";
import { companyGraph } from "../server/domain/company-graph.mjs";
import { DEPARTMENT_SEED } from "../server/domain/company.mjs";
import { processSheets } from "../server/owner/process-sheets.mjs";
import { DENIED_EFFECTS } from "../server/owner/envelopes.mjs";
import { parseFrontmatter } from "../server/domain/skills.mjs";

const NOW = "2026-10-25T12:00:00.000Z";
function insert(db, table, values) {
  const required = Object.fromEntries(db.prepare(`PRAGMA table_info(${table})`).all().filter((c) => c.notnull && c.dflt_value === null && !Object.hasOwn(values, c.name)).map((c) => [c.name, c.type === "INTEGER" ? 0 : c.name.endsWith("_json") ? "{}" : c.name.endsWith("_at") ? NOW : ""]));
  const row = { ...required, ...values }; const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
}
/** Hand-made services over an in-memory schema, no Hub, filesystem writes, git or provider process. */
function stub(c) {
  const db = new DatabaseSync(":memory:"); for (const m of MIGRATIONS) m.up(db);
  db.exec("CREATE TABLE schema_migrations (version INTEGER)"); db.prepare("INSERT INTO schema_migrations VALUES (?)").run(15);
  c.after(() => db.close());
  let time = new Date(NOW);
  const roleConfig = JSON.parse(fs.readFileSync(new URL("../config/roles.json", import.meta.url), "utf8"));
  const skills = fs.readdirSync(new URL("../skills/", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const text = fs.readFileSync(new URL(`../skills/${d.name}/SKILL.md`, import.meta.url), "utf8");
    const front = parseFrontmatter(text); const data = front.data;
    return { id: d.name, description: data.description, metadata: data.metadata, currentVersion: 1, body: front.body };
  });
  // The registry's versioned body is read separately from the list, as in production.
  const nativePrepare = db.prepare.bind(db);
  const wrapped = { prepare(sql) { if (sql.startsWith("SELECT body FROM skill_versions")) return { get: (id) => ({ body: skills.find((s) => s.id === id)?.body }) }; return nativePrepare(sql); } };
  const hub = { db: wrapped, config: { now: () => new Date(time), hubRoot: new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), bootId: "boot-test" }, bus: { lastSeq: () => 42 }, factory: { list: () => [] }, deliveries: { list: () => [] }, approvals: { list: () => [] }, projects: { get: () => null, hub: () => null, list: () => [] }, settings: { get: (key) => key === "mode" ? "BUILD_SAFE" : key === "executionGate" ? { status: "open" } : null }, sales: { overview: () => ({ outreach: "DISABLED" }) }, runs: { activeRuns: () => [] }, schedules: { list: () => [] }, environments: { ids: () => [], routeFor: () => "windows" }, providerState: { get: () => null }, voice: { status: () => ({ engine: { engine: "stopped" }, localTranscription: { available: false } }) }, lega: { state: () => null }, roleConfig, skills: { list: () => skills }, integrations: { list: () => [] }, company: { company: () => ({ name: "Test" }), departments: () => DEPARTMENT_SEED }, cockpit: { companyMap: () => ({}) }, envelopes: { autonomyOf: () => ({ level: "OBSERVE", source: "default" }) } };
  // URL decoding matters on Windows paths containing spaces.
  hub.config.hubRoot = decodeURIComponent(hub.config.hubRoot);
  return { hub, db, time: (t) => { time = new Date(t); } };
}
test("M16 ro-text: both DST days, including each side of the repeated/missing hour", () => {
  assert.equal(TZ, "Europe/Bucharest");
  for (const iso of ["2026-10-24T21:00:00Z", "2026-10-24T23:59:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T21:59:00Z"]) { assert.equal(bucharestDayStart(new Date(iso)).toISOString(), "2026-10-24T21:00:00.000Z"); assert.equal(bucharestDayStart(new Date(iso), 1).toISOString(), "2026-10-25T22:00:00.000Z"); }
  for (const iso of ["2026-03-28T22:00:00Z", "2026-03-29T00:59:00Z", "2026-03-29T01:30:00Z", "2026-03-29T20:59:00Z"]) { assert.equal(bucharestDayStart(new Date(iso)).toISOString(), "2026-03-28T22:00:00.000Z"); assert.equal(bucharestDayStart(new Date(iso), 1).toISOString(), "2026-03-29T21:00:00.000Z"); }
  assert.equal(hhmm(NOW), "14:00"); assert.equal(dayMonth(NOW), "25 oct."); assert.equal(dateTimeRo(NOW), "25 oct., 14:00");
});
test("M16 Romanian count and list agreement", () => {
  const forms = { one: "decizie", many: "decizii" };
  for (const [n, expected] of [[0, "0 decizii"], [1, "1 decizie"], [2, "2 decizii"], [19, "19 decizii"], [20, "20 de decizii"], [100, "100 de decizii"], [101, "101 decizii"], [102, "102 decizii"], [120, "120 de decizii"], [1000, "1.000 de decizii"]]) assert.equal(roCount(n, forms), expected);
  assert.equal(roCount(0, { ...forms, none: "nicio decizie" }), "nicio decizie"); assert.equal(roCount(1, { ...forms, article: true }), "o decizie");
  for (const n of [1, 2, 20]) assert.equal(roCount(n, { one: "deviz pregătit", many: "devize pregătite", gender: "n" }), n === 1 ? "1 deviz pregătit" : `${n}${n === 20 ? " de" : ""} devize pregătite`);
  assert.equal(roList(["a"]), "a"); assert.equal(roList(["a", "b"]), "a și b"); assert.equal(roList(["a", "b", "c"]), "a, b și c");
});
test("M16 recap: exact ordered indicators, states, period, frozen bounded store and TTL", (c) => {
  const t = stub(c); const recap = createRecap(t.hub); const snap = recap.build({ projectId: "echo" });
  assert.ok(!Object.hasOwn(snap, "projectId")); assert.equal(snap.lastSeq, 42); assert.equal(snap.period.label, "Azi, de la 00:00 la 14:00");
  const ids = [["decisions", "plans", "blocked", "approvals"], ["active", "paused", "ready", "runs"], ["bundles_ready", "accepted", "deliveries", "qa_warn"], ["open", "prepared", "approved", "sent"], ["ops", "sup", "dvz", "active"], ["mode", "gate", "backup", "failures"]];
  for (const [i, chapter] of snap.chapters.entries()) { assert.deepEqual(chapter.indicators.map((x) => x.id), ids[i].map((n) => `${chapter.key}.${n}`)); assert.ok(chapter.indicators.length <= 4); assert.ok(Object.isFrozen(chapter.indicators)); assert.ok(chapter.sources.every((s) => s.ok), JSON.stringify(chapter.sources)); assert.ok(chapter.sentences.length >= 1 && chapter.sentences.length <= 2); assert.match(chapter.speech, new RegExp(`Capitolul ${i + 1} din 6`)); assert.match(chapter.speech, i === 5 ? /ultimul capitol\.$/ : /Spune „următorul”/); }
  assert.match(snap.chapters[0].speech, /^Rezumatul de azi, de la miezul nopții până la 14:00\./); assert.equal(snap.chapters[0].state, "nothing_new"); assert.equal(snap.chapters[3].indicators[3].state, "disabled"); assert.equal(snap.chapters[3].indicators[3].value, null); assert.equal(snap.chapters[5].indicators[2].state, "unknown"); assert.equal(snap.chapters[0].indicators[0].display, "0");
  assert.throws(() => { snap.chapters[0].title = "mutated"; }, TypeError);
  const since = recap.build({ period: "since_visit" }); assert.equal(since.period.fallback, "no_visit"); assert.equal(since.period.firstVisit, true);
  const now = recap.build({ period: "now" }); assert.equal(now.chapters.length, 6); assert.equal(now.period.from, null); assert.ok(now.chapters.flatMap((c) => c.indicators).every((i) => i.applies === "now"));
  for (let i = 0; i < 51; i++) recap.build(); assert.equal(recap.get(snap.id), null);
  const last = recap.build(); t.time("2026-10-25T18:00:00Z"); assert.equal(recap.get(last.id), null);
  assert.throws(() => recap.build({ period: "week" }), /Perioadă/);
});
test("M16 recap: a failed source is isolated, provenance stays explicit", (c) => {
  const { hub } = stub(c); hub.approvals.list = () => { throw new Error("secret / stack"); };
  const snap = createRecap(hub).build(); const waiting = snap.chapters[0]; assert.equal(waiting.state, "partial"); assert.equal(waiting.indicators[3].state, "unavailable"); assert.equal(waiting.indicators[3].value, null); assert.doesNotMatch(waiting.indicators[3].note, /secret|stack/); assert.equal(snap.chapters[1].state, "nothing_new");
  assert.deepEqual(provenanceOf([{ synthetic: true }, { real: false }, {}]), { provenance: "mixed", split: { real: 1, synthetic: 2 } });
});
test("M16 recap: positive indicators use the interval, expiry, project and synthetic rules", (c) => {
  const { hub, db } = stub(c); const future = "2026-10-26T12:00:00Z"; const old = "2026-10-20T12:00:00Z";
  hub.projects.get = (id) => id ? { id, source: id === "synthetic" ? "hub-test" : "registry" } : null; hub.projects.hub = () => ({ id: "real" });
  const missions = [{ missionId: "m1", projectId: "real", stage: "IMPLEMENTING" }, { missionId: "m2", projectId: "synthetic", stage: "BLOCKED" }, { missionId: "m3", stage: "PAUSED" }, { missionId: "m4", stage: "CANCEL_REQUESTED" }]; hub.factory.list = () => missions;
  hub.approvals.list = () => [{}, {}];
  for (const id of ["real", "synthetic"]) insert(db, "projects", { id, slug: id, name: id, path: id });
  insert(db, "missions", { id: "m1", title: "Real", project_id: "real", status: "ACTIVE" });
  insert(db, "missions", { id: "m2", title: "Synthetic", project_id: "synthetic", status: "BLOCKED" });
  for (const [id, confirm_by] of [["env1", future], ["env2", old]]) insert(db, "mission_envelopes", { id, nonce: id, status: "PROPOSED", confirm_by });
  for (const [id, kind] of [["op1", "test"], ["op2", "delivery.correct"]]) insert(db, "ops_plans", { id, kind, nonce: id, status: "PROPOSED", confirm_by: future });
  for (const [id, status, expires_at] of [["wr1", "OPEN", future], ["wr2", "BLOCKED", future], ["wr3", "OPEN", old], ["wr4", "PLANNED", future]]) insert(db, "work_requests", { id, status, expires_at });
  for (const [id, mid, at] of [["e1", "m1", NOW], ["e2", "m1", NOW], ["e3", "m2", old]]) insert(db, "events", { id, type: "factory.stage", scope_type: "mission", scope_id: mid, payload_json: '{"stage":"DELIVERY_READY"}', created_at: at });
  for (const [id, mid, status] of [["b1", "m1", "READY_FOR_OWNER_ACCEPTANCE"], ["b2", "m2", "READY_FOR_OWNER_ACCEPTANCE"], ["b3", "m1", "OWNER_ACCEPTED"]]) insert(db, "factory_bundles", { id, mission_id: mid, status, decided_at: NOW });
  for (const [id, status, error_category] of [["r1", "failed", null], ["r2", "blocked", "gate"], ["r3", "blocked", "provider"], ["r4", "interrupted_unknown", null]]) insert(db, "agent_runs", { id, provider: "codex", status, error_category });
  for (const [id, synthetic] of [["g1", 0], ["g2", 1]]) insert(db, "sales_orgs", { id, synthetic });
  for (const [id, org_id, synthetic] of [["o1", "g1", 0], ["o2", "g2", 0], ["o3", "g1", 1]]) insert(db, "sales_opportunities", { id, org_id, synthetic, title: id, status: "IDENTIFIED" });
  for (const [id, opportunity_id] of [["p1", "o1"], ["p2", "o2"]]) insert(db, "sales_proposals", { id, opportunity_id, version: 1, status: "APPROVED_INTERNAL", approved_at: NOW });
  for (const [id, kind, department] of [["d1", "ops_start", "operations"], ["d2", "support_case", "customer-success"], ["d3", "support_case", "customer-success"], ["d4", "finance_doc", "finance-admin"]]) insert(db, "desk_records", { id, kind, department, internal_no: id, root_plan_id: id, status: "PREPARING", synthetic: 1 });
  insert(db, "backups", { id: "backup", project_id: "real", status: "verified", restore_verified_at: "2026-10-25T11:30:00Z" });
  const snapshot = createRecap(hub).build(); const indicators = snapshot.chapters.flatMap((c) => c.indicators); const value = (id) => indicators.find((i) => i.id === id);
  for (const [id, n] of [["waiting.plans", 3], ["waiting.blocked", 3], ["waiting.approvals", 2], ["work.active", 1], ["work.paused", 2], ["work.ready", 1], ["work.runs", 4], ["results.bundles_ready", 2], ["results.accepted", 1], ["sales.open", 3], ["sales.prepared", 2], ["sales.approved", 2], ["desk.ops", 1], ["desk.sup", 2], ["desk.dvz", 1], ["desk.active", 4], ["system.backup", 30], ["system.failures", 3]]) assert.equal(value(id).value, n, `${id}: ${JSON.stringify(value(id))}`);
  assert.deepEqual(value("sales.open").split, { real: 1, synthetic: 2 }); assert.deepEqual(value("results.bundles_ready").split, { real: 1, synthetic: 1 }); assert.equal(snapshot.chapters[3].badge, "REAL + SINTETIC"); assert.equal(snapshot.chapters[4].badge, "SINTETIC");
  assert.equal(value("sales.open").display, "1 real + 2 sintetice");
  assert.equal(value("desk.sup").display, "2"); assert.equal(value("desk.sup").provenance, "synthetic");
  assert.match(snapshot.chapters[4].sentences[0], /^Date sintetice:/);
  for (const id of ["waiting.plans", "waiting.blocked", "work.active", "work.paused", "work.ready", "work.runs", "results.bundles_ready", "results.accepted"]) assert.ok(value(id).split, id);
  for (const chapter of snapshot.chapters) if (chapter.indicators.some((i) => i.split?.synthetic)) {
    assert.match(chapter.sentences.join(" "), /date de test|Date sintetice|proveniență necunoscută/);
  } assert.match(snapshot.chapters[4].sentences[0], /1 dosar de pornire, 2 cazuri de suport și 1 deviz/);
  for (const chapter of snapshot.chapters) { const numbers = new Set(chapter.indicators.flatMap((i) => [i.value, i.split?.real, i.split?.synthetic, ...(i.id === "system.backup" ? [...i.display.matchAll(/\b\d+\b/g)].map(m => Number(m[0])) : [])]).filter((n) => typeof n === "number")); for (const sentence of chapter.sentences) for (const match of sentence.matchAll(/\b\d+\b/g)) assert.ok(numbers.has(Number(match[0])), `${chapter.key}: ${sentence}`); }
  assert.equal(salesFunnel(hub).stages[0].count, 3);
});
test("M16 recap: visit markers are read without being advanced; entirely failed chapter stays unavailable", (c) => {
  const { hub, db } = stub(c); insert(db, "owner_visits", { project_id: "__company__", last_seen_at: "2026-10-25T08:00:00Z", last_seq: 7 });
  const recap = createRecap(hub); assert.equal(recap.build({ period: "since_visit" }).period.from, "2026-10-25T08:00:00Z"); assert.equal(db.prepare("SELECT last_seq FROM owner_visits").get().last_seq, 7);
  const prepare = hub.db.prepare.bind(hub.db); hub.db.prepare = (sql) => { if (sql.includes("desk_records")) throw new Error("bad source"); return prepare(sql); };
  const chapter = recap.build().chapters[4]; assert.equal(chapter.state, "unavailable"); assert.ok(chapter.indicators.every((i) => i.state === "unavailable"));
  hub.db.prepare = (sql) => { if (sql.includes("owner_visits")) throw new Error("bad visit source"); return prepare(sql); };
  const failedPeriod = recap.build({ period: "since_visit" }); assert.equal(failedPeriod.period.firstVisit, false); assert.equal(failedPeriod.period.fallback, null); assert.equal(failedPeriod.period.from, null); assert.ok(failedPeriod.chapters.flatMap((c) => c.indicators).filter((i) => i.applies === "interval").every((i) => i.state === "unavailable"));
});
test("M16 funnel: exact 24h boundary, all rows, threshold validation, real transition cohorts", () => {
  const now = new Date(NOW); const ago = (ms) => new Date(now - ms).toISOString();
  const opportunities = Array.from({ length: 60 }, (_, i) => ({ id: `o${i}`, title: "Test", status: "IDENTIFIED", synthetic: false, updated_at: ago(i === 0 ? (20 * 24 + 23) * 3600000 : 21 * 86400000) }));
  let f = funnelOf({ opportunities, now }); assert.equal(f.stages[0].count, 60); assert.equal(f.opportunities[0].list, null); assert.equal(f.opportunities[1].list, "cooling"); assert.equal(f.conversions[0].state, "insufficient");
  for (const n of [1, 365]) assert.equal(funnelThreshold(n), n); for (const n of [0, 366, "x", 1.5]) assert.throws(() => funnelThreshold(n), /Pragul/);
  const transitions = opportunities.slice(0, 5).flatMap((o) => [{ subject_type: "opportunity", subject_id: o.id, to_status: "IDENTIFIED", created_at: ago(10 * 86400000) }, { subject_type: "opportunity", subject_id: o.id, to_status: "CONTACTED", created_at: ago(9 * 86400000) }]);
  f = funnelOf({ opportunities, transitions, now }); assert.equal(f.conversions[0].rate, 1); assert.equal(f.conversions[0].cohort.n, 5);
  f = funnelOf({ opportunities: opportunities.map((o) => ({ ...o, synthetic: true })), transitions, now }); assert.equal(f.conversions[0].rate, null); assert.match(f.conversions[0].reason, /sintetice/);
});
test("M16 trace: recorded windows, repair loop, pause/resume, retry and unknown stage", () => {
  const stages = ["IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "CHECKING", "PAUSED", "CHECKING", "ALIEN"];
  const events = stages.map((stage, i) => ({ seq: i + 1, type: "factory.stage", created_at: new Date(Date.parse(NOW) + i * 1000).toISOString(), source: "test", payload: { stage, reason: stage === "REPAIRING" ? "Ciclul 1/2" : "" } }));
  events.push({ seq: 9, type: "factory.turn_retry", created_at: events[6].created_at, payload: { stage: "CHECKING" } });
  const trace = traceOf({ mission: { missionId: "m", stage: "ALIEN", limits: {} }, events });
  for (const kind of ["repair_loop", "pause", "resume", "retry"]) assert.ok(trace.edges.some((e) => e.kind === kind), kind);
  assert.equal(trace.steps.at(-1).stage, "ALIEN"); assert.equal(trace.steps.at(-1).durationMs, null); assert.equal(trace.steps[0].durationMs, 1000); assert.deepEqual(trace.steps[3].cycle, { n: 1, max: 2 });
});
test("M16 process sheets: every skill folder, every reference, policy imports, no authority", (c) => {
  const { hub } = stub(c); const result = processSheets(hub);
  assert.equal(result.sheets.length, 23); assert.equal(result.sheets.filter((s) => s.kind === "flow").length, 6);
  for (const s of result.sheets) { assert.ok(s.refs.every((r) => r.ok), JSON.stringify(s.refs)); assert.equal(s.autonomy.effective, null); if (s.kind === "skill") assert.ok(s.steps.length, s.id); }
  assert.deepEqual(result.alwaysOff.filter((r) => r.source === "envelopes.mjs DENIED_EFFECTS").map((r) => r.effect), DENIED_EFFECTS);
});
test("M16 graph and system map use only registered observations, never inspect/probe", (c) => {
  const { hub } = stub(c); const forbidden = () => { throw new Error("M16 probed"); }; hub.inspect = forbidden; hub.probe = forbidden;
  const graph = companyGraph(hub); assert.deepEqual(graph.departments.map((d) => d.key), DEPARTMENT_SEED.map((d) => d.key)); assert.ok(graph.edges.every((e) => e.provenance.source && e.provenance.ref));
  const map = systemMap(hub); assert.deepEqual(map.nodes.map((n) => n.id), ["pc", "hub", "db", "backups", "schedules", "runner", "codex", "claude", "voice"]); assert.ok(map.nodes.every((n) => Object.hasOwn(n, "checkedAt") && n.source)); assert.doesNotMatch(JSON.stringify(map), /hostname|username|C:\\\\Users/);
  assert.equal(salesFunnel(hub).opportunities.length, 0);
});
test("M16 graph: active runtime runId joins the recorded role; unassigned work stays unassigned", (c) => {
  const { hub, db } = stub(c);
  insert(db, "projects", { id: "p", slug: "p", name: "p", path: "p" });
  insert(db, "missions", { id: "m", title: "Unassigned", project_id: "p", status: "ACTIVE" });
  insert(db, "agent_roles", { id: "backend", name: "Backend" });
  insert(db, "tasks", { id: "t", mission_id: "m", project_id: "p", role_id: "backend", status: "RUNNING" });
  insert(db, "agent_runs", { id: "r", task_id: "t", role_id: "backend", provider: "codex", status: "running" });
  hub.runs.activeRuns = () => [{ runId: "r", taskId: "t", provider: "codex" }];
  const graph = companyGraph(hub); assert.equal(graph.roles.find((r) => r.id === "backend").runningNow, 1); assert.equal(graph.works[0].department, null); assert.equal(graph.works[0].runningNow, 1); assert.ok(graph.edges.some((e) => e.kind === "work_role" && e.to === "role:backend"));
  assert.equal(graph.departments.find((d) => d.key === "engineering").counts.runningNow, 1);
});


test("M16 R3 polling and held eviction", (c) => {
 const t = stub(c); let held; t.hub.lega.isHeld = (id) => id === held;
 const recap = createRecap(t.hub); const first = recap.build(); held = first.id;
 for (let i=0;i<60;i++) { const poll=recap.build({period:"now"}); assert.match(poll.id,/^rcpn_/); assert.equal(recap.get(poll.id),null); }
 for(let i=0;i<49;i++) recap.build(); assert.equal(recap.get(first.id),first);
 for(let i=0;i<11;i++) recap.build(); assert.equal(recap.get(first.id),first);
 t.time("2026-10-25T19:00:00Z"); assert.equal(recap.get(first.id),first); held=null; assert.equal(recap.get(first.id),null);
});
test("M16 R3 project provenance and unknown QA", (c) => {
 const {hub,db}=stub(c); hub.projects.get=(id)=>["r","s"].includes(id)?{id,source:id==="s"?"hub-test":"registry"}:null;
 for(const id of ["r","s"]) insert(db,"projects",{id,slug:id,name:id,path:id});
 hub.factory.list=()=>["r","s",null].flatMap((projectId,n)=>["IMPLEMENTING","BLOCKED","PAUSED"].map(stage=>({missionId:`${n}-${stage}`,projectId,stage})));
 for(const [n,project_id] of ["r","s",null].entries()) {
 insert(db,"mission_envelopes",{id:`e${n}`,project_id:project_id||"missing",nonce:`e${n}`,status:"PROPOSED",confirm_by:"2026-10-26T12:00:00Z"});
 insert(db,"media_qa_reports",{id:`q${n}`,kind:"technical",status:"WARN"}); }
 const snap=createRecap(hub).build({projectId:"missing"}); assert.ok(!Object.hasOwn(snap,"projectId"));
 const byId=Object.fromEntries(snap.chapters.flatMap(c=>c.indicators).map(i=>[i.id,i]));
 for(const id of ["waiting.plans","work.active","work.paused"]) { assert.deepEqual(byId[id].split,{real:1,synthetic:1,unknown:1}); assert.equal(byId[id].provenance,"mixed"); assert.match(byId[id].display,/necunoscut/); }
 assert.equal(byId["waiting.approvals"].provenance,"none"); assert.equal(byId["results.qa_warn"].split.unknown,3);
 for(const chapter of snap.chapters) for(const i of chapter.indicators) if(["synthetic","mixed"].includes(i.provenance)) assert.match(chapter.sentences.join(" "),/date de test|Date sintetice/,i.id);
 assert.equal(createRecap(hub).build({projectId:"r"}).projectId,"r");
});
test("M16 R3 correction counted unless exact inbox id", (c) => {
 const {hub,db}=stub(c); insert(db,"ops_plans",{id:"correct",nonce:"correct",kind:"delivery.correct",status:"PROPOSED",confirm_by:"2026-10-26T12:00:00Z"});
 const recap=createRecap(hub); const plans=()=>recap.build().chapters[0].indicators.find(i=>i.id==="waiting.plans").value; assert.equal(plans(),1);
 hub.deliveries.list=()=>[{id:"d",status:"READY"}]; hub.deliveries.view=()=>({delivery:{},correction:{plan:{id:"correct",status:"PROPOSED"},defects:[]},revisions:[{planId:"correct",source:"hub"}],decisions:{creativeMaster:"APPROVED",creativeVertical:"APPROVED",summaryReady:"READY",software:"ACCEPTED"}}); assert.equal(plans(),0);
});
test("M16 R3 labels and imported max", async () => {
 const {EFFECT_LABELS}=await import("../server/owner/process-sheets.mjs"); assert.deepEqual(Object.keys(EFFECT_LABELS||{}).sort(),[...DENIED_EFFECTS].sort()); assert.ok(Object.values(EFFECT_LABELS).every(x=>typeof x==="string"&&x.length));
 assert.match(fs.readFileSync(new URL("../server/owner/process-sheets.mjs",import.meta.url),"utf8"),/maxLevel = AUTONOMY_LEVELS.at\(-1\)/);
});

test("M16 R3 invalid project omitted, existing project echoed company-wide", (c) => {
  const { hub } = stub(c); hub.projects.get = (id) => id === "p" ? { id } : null;
  const recap = createRecap(hub);
  for (const projectId of ["", "missing"]) assert.ok(!Object.hasOwn(recap.build({ projectId }), "projectId"));
  const snap = recap.build({ projectId: "p" }); assert.equal(snap.projectId, "p"); assert.equal(snap.scope, "company");
});
test("M16 R3 QA with no project has unknown provenance", (c) => {
  const { hub, db } = stub(c); insert(db, "media_qa_reports", { id: "qa", kind: "technical", status: "WARN" });
  const chapter = createRecap(hub).build().chapters[2]; const qa = chapter.indicators.find((i) => i.id === "results.qa_warn");
  assert.deepEqual(qa.split, { real: 0, synthetic: 0, unknown: 1 }); assert.equal(qa.value, 1);
  assert.match(qa.display, /necunoscut/); assert.match(chapter.speech, /proveniență necunoscută/);
});
test("M16 R3 synthetic and mixed displays and every counted sentence labeled", (c) => {
  const { hub } = stub(c); hub.projects.get = (id) => ({ id, source: id === "s" ? "hub-test" : "registry" });
  let missions = [{ missionId: "s", projectId: "s", stage: "BLOCKED" }]; hub.factory.list = () => missions;
  const recap = createRecap(hub); let chapter = recap.build().chapters[0];
  let blocked = chapter.indicators.find((i) => i.id === "waiting.blocked"); assert.equal(blocked.provenance, "synthetic"); assert.equal(blocked.display, "1"); assert.match(chapter.sentences[0], /^Date de test:/);
  missions = [...missions, { missionId: "s2", projectId: "s", stage: "BLOCKED" }, { missionId: "r", projectId: "r", stage: "BLOCKED" }];
  chapter = recap.build().chapters[0]; blocked = chapter.indicators.find((i) => i.id === "waiting.blocked");
  assert.equal(blocked.value, 3); assert.equal(blocked.display, "1 real + 2 sintetice"); assert.match(chapter.sentences.at(-1), /din care 2 din date de test/);

});

// Renderer fixtures carry exactly the same indicator shape as the builder; no source reads.
const chapterKeys = { waiting: ["decisions", "plans", "blocked", "approvals"], work: ["active", "paused", "ready", "runs"], results: ["bundles_ready", "accepted", "deliveries", "qa_warn"], sales: ["open", "prepared", "approved", "sent"], desk: ["ops", "sup", "dvz", "active"], system: ["mode", "gate", "backup", "failures"] };
function textChapter(key, n, changes = {}) {
  return { key, state: "ok", badge: null, indicators: chapterKeys[key].map(name => ({ id: `${key}.${name}`, label: name, value: n, display: String(n), state: n === 0 ? "zero" : "value", provenance: "real", applies: ["decisions", "plans", "blocked", "approvals", "active", "paused", "bundles_ready", "deliveries", "open", "mode", "gate", "backup"].includes(name) ? "now" : "interval", ...changes[name] })) };
}
test("M16 R4 natural Romanian: exact templates and agreement for every chapter at 0/1/2/20/101", () => {
  const exact = {
    waiting: ["Te așteaptă 1 decizie, 1 plan de confirmat și 1 aprobare tehnică.", "1 blocaj așteaptă deblocarea."],
    work: ["1 lucrare e în lucru acum, iar 1 e în pauză sau se oprește.", "Azi: 1 lucrare a ajuns gata de livrare, 1 rulare de model."],
    results: ["1 pachet așteaptă acceptarea ta; 1 livrare pregătită.", "Azi: 1 pachet acceptat de tine, 1 avertisment QA la clipuri."],
    sales: ["1 oportunitate deschisă.", "Azi: 1 ofertă pregătită, 1 aprobată intern; 1 trimisă prin transportul de test."],
    desk: ["Azi: s-au pregătit 1 dosar de pornire, 1 caz de suport și 1 deviz.", "1 dosar e în lucru acum."],
    system: ["Hub-ul e în BUILD_SAFE, modul sigur, cu poarta de execuție deschisă.", "Ultimul backup verificat: necunoscut; Azi: 1 execuție eșuată."],
  };
  for (const key of Object.keys(chapterKeys)) for (const n of [0, 1, 2, 20, 101]) {
    const chapter = textChapter(key, n, key === "system" ? { mode: { value: "BUILD_SAFE", display: "BUILD_SAFE" }, gate: { value: "open", display: "deschisă" }, backup: { value: null, state: "unknown", display: "necunoscut" } } : {});
    const sentences = recapSentences(chapter, "today");
    assert.ok(sentences.length >= 1 && sentences.length <= 2);
    if (n === 1) assert.deepEqual(sentences, exact[key]);
    for (const number of sentences.join(" ").matchAll(/\b\d+\b/g)) assert.equal(Number(number[0]), n, sentences.join(" "));
    if (n > 0) assert.match(sentences.join(" "), new RegExp(`\\b${n}\\b`));
    if (n === 20 && key !== "system") assert.match(sentences.join(" "), /20 de (decizii|lucrări|pachete|oportunități|dosare)/);
    if ([2, 20, 101].includes(n)) {
      const number = `${n}${n === 20 ? " de" : ""}`;
      const plural = { waiting: `${number} decizii`, work: `${number} lucrări sunt în lucru acum`, results: `${number} pachete așteaptă acceptarea ta`, sales: `${number} oportunități deschise`, desk: `${number} dosare de pornire`, system: `${number} execuții eșuate` };
      assert.ok(sentences.join(" ").includes(plural[key]), sentences.join(" "));
    }
    if (n === 101) assert.doesNotMatch(sentences.join(" "), /101 de /);
    if (n === 0) assert.doesNotMatch(sentences.join(" "), /\b0\b/);
  }
  assert.deepEqual(recapSentences(textChapter("work", 0), "today"), ["Nicio lucrare nu e în lucru acum.", "Azi: nicio lucrare nu a ajuns gata de livrare, niciun model nu a rulat."]);
  assert.deepEqual(recapSentences(textChapter("results", 0), "today"), ["Niciun pachet nu așteaptă acceptarea ta; nicio livrare pregătită.", "Azi: niciun pachet acceptat de tine, niciun avertisment QA la clipuri."]);
  assert.deepEqual(recapSentences(textChapter("sales", 0), "today"), ["Nicio oportunitate deschisă.", "Azi: nicio ofertă pregătită, nicio ofertă aprobată intern; nicio ofertă trimisă prin transportul de test."]);
  assert.deepEqual(recapSentences(textChapter("waiting", 0), "today"), ["Nimic nu te așteaptă acum."]);
  assert.deepEqual(recapSentences(textChapter("waiting", 0, { blocked: { value: 2, state: "value" } }), "today"), ["Nicio decizie nu te așteaptă; 2 blocaje așteaptă deblocarea."]);
  assert.deepEqual(recapSentences(textChapter("desk", 0), "today"), ["Azi nu s-a pregătit nimic în Biroul intern."]);
});

test("M16 R4 provenance is once per all-test chapter, adjacent to mixed numbers, absent for real", () => {
  for (const key of Object.keys(chapterKeys).filter(key => key !== "system")) {
    const chapter = textChapter(key, 2);
    for (const i of chapter.indicators) Object.assign(i, { provenance: "synthetic", split: { real: 0, synthetic: 2 } });
    let text = recapSentences(chapter, "today").join(" ");
    assert.match(text, /^Date de test: /); assert.equal((text.match(/date de test/gi) || []).length, 1);
    chapter.badge = ["sales", "desk"].includes(key) ? "SINTETIC" : null;
    if (chapter.badge) assert.match(recapSentences(chapter, "today")[0], /^Date sintetice: /);
    chapter.badge = null;
    for (const i of chapter.indicators) Object.assign(i, { provenance: "mixed", split: { real: 1, synthetic: 1 } });
    text = recapSentences(chapter, "today").join(" "); assert.doesNotMatch(text, /^Date/); assert.match(text, /2 \(din care 1 din date de test\)/);
    for (const i of chapter.indicators) { i.provenance = "real"; delete i.split; }
    assert.doesNotMatch(recapSentences(chapter, "today").join(" "), /sintetice|date de test/i);
  }
});

test("M16 R4 unavailable and unknown counts never become zero; disabled sending stays explicit", () => {
  for (const key of Object.keys(chapterKeys)) for (const state of ["unknown", "unavailable"]) {
    const chapter = textChapter(key, 2);
    for (const i of chapter.indicators) Object.assign(i, { state, value: null, display: state === "unknown" ? "necunoscut" : "indisponibil" });
    const text = recapSentences(chapter, "today").join(" ");
    assert.match(text, state === "unknown" ? /necunoscut/ : /sursa nu a răspuns/);
    assert.doesNotMatch(text, /\b0\b|nicio |niciun |Nimic/);
  }
  const chapter = textChapter("sales", 0, { sent: { value: null, state: "disabled", display: "dezactivată" } });
  assert.match(recapSentences(chapter, "today").join(" "), /trimiterea din Hub e dezactivată/i);
  assert.doesNotMatch(recapSentences(chapter, "today").join(" "), /nimic nu s-a trimis/);
});

test("M16 R4 now omits intervals; nothing-new wording and since-visit wording", (c) => {
  const { hub } = stub(c); const recap = createRecap(hub);
  const now = recap.build({ period: "now" });
  for (const chapter of now.chapters) {
    assert.ok(chapter.indicators.every(i => i.applies === "now"));
    assert.doesNotMatch(chapter.sentences.join(" "), /Azi|De la ultima vizită|această perioadă/);
    if (chapter.state === "nothing_new" && chapter.key !== "waiting") assert.deepEqual(chapter.sentences, ["Nimic în lucru acum."]);
  }
  assert.deepEqual(recap.build().chapters[1].sentences, ["Nimic nou în această perioadă."]);
  for (const key of ["work", "results", "sales", "desk", "system"]) assert.match(recapSentences(textChapter(key, 2), "since_visit").join(" "), /De la ultima vizită/);
});

test("M16 R4 labels and spoken opening use Bucharest time without a company suffix", (c) => {
  const { hub, db } = stub(c); const recap = createRecap(hub);
  const today = recap.build();
  assert.equal(today.period.label, "Azi, de la 00:00 la 14:00");
  assert.ok(today.chapters[0].speech.startsWith("Rezumatul de azi, de la miezul nopții până la 14:00. Capitolul 1 din 6, Ce te așteaptă."));
  const first = recap.build({ period: "since_visit" });
  assert.equal(first.period.label, "Prima vizită înregistrată: azi, de la 00:00 la 14:00");
  assert.ok(first.chapters[0].speech.startsWith("Rezumatul de azi, de la miezul nopții până la 14:00; nu am o vizită anterioară."));
  insert(db, "owner_visits", { project_id: "__company__", last_seen_at: "2026-10-24T18:10:00Z", last_seq: 1 });
  const since = recap.build({ period: "since_visit" });
  assert.equal(since.period.label, "De la ultima vizită (24 oct., 21:10) la 14:00");
  assert.ok(since.chapters[0].speech.startsWith("Rezumatul de la ultima vizită, din 24 octombrie, 21:10, până la 14:00."));
  const now = recap.build({ period: "now" }); assert.equal(now.period.label, "Acum (14:00)");
  assert.ok(now.chapters[0].speech.startsWith("Rezumatul de acum, la 14:00."));
  for (const snap of [today, first, since, now]) assert.doesNotMatch(snap.period.label, /compania|—/);
});

test("M16 R4 system map includes exactly the applicable status fields per node", (c) => {
  const { hub } = stub(c);
  const fields = ["installed", "configured", "available", "running"];
  const expected = { pc: ["running"], hub: ["running"], db: ["available"], backups: [], schedules: [], runner: fields, codex: fields, claude: fields, voice: ["installed", "available", "running"] };
  for (const node of systemMap(hub).nodes) assert.deepEqual(fields.filter(key => Object.hasOwn(node, key)), expected[node.id], node.id);
  const voice = systemMap(hub).nodes.find(n => n.id === "voice"); assert.equal(voice.installed, null); assert.equal(voice.available.ok, false);
  hub.voice.status = () => ({ engine: { installed: true }, localTranscription: { available: true } });
  const installed = systemMap(hub).nodes.find(n => n.id === "voice"); assert.equal(installed.installed, true); assert.equal(installed.available.ok, true);
});

test("M16 R4 one failed source keeps healthy facts and stored indicator metadata intact", (c) => {
  const { hub } = stub(c);
  hub.approvals.list = () => { throw new Error("stack secret"); };
  hub.factory.list = () => [{ projectId: "r", stage: "BLOCKED" }];
  hub.projects.get = () => ({ source: "registry" });
  const chapter = createRecap(hub).build().chapters[0];
  const before = JSON.stringify(chapter.indicators);
  const sentences = recapSentences(chapter, "today");
  assert.match(sentences.join(" "), /1 blocaj așteaptă deblocarea/);
  assert.match(sentences.join(" "), /nu știu câte aprobări tehnice te așteaptă: sursa nu a răspuns/);
  assert.doesNotMatch(sentences.join(" "), /0 aprobări|stack|secret|Te așteaptă nu știu/);
  assert.equal(JSON.stringify(chapter.indicators), before);
});
