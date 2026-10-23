// M15: the one design vocabulary (work states, meanings), „Ce te așteaptă”, the open activity's ONE primary action, the history by name and
// date, „Ce decizii am?” in words, the errors that say what was kept, and the rail organised around the owner's work. Pure logic + source.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATES, STATE_KEYS, MEANINGS, stateOf, meaningOf, attentionItems, attentionSummary, currentActivity, historyRows } from "../web/src/lib/stateVocab.js";
import { decisionsLine, intelLines } from "../web/src/lib/cockpitLogic.js";
import { DECISION_KIND } from "../web/src/lib/legaOneScreen.js";
import { NAV, NAV_GROUPS, navHref, navCurrent } from "../web/src/nav.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const SHA = "a".repeat(64);

test("M15-VOC-01 eight work states, each with its own word; the meanings of decisions are separate and never a work state", () => {
  assert.deepEqual(STATE_KEYS, ["ready", "run", "decide", "block", "error", "done", "stale", "expired", "closed"]);
  const labels = STATE_KEYS.map((k) => STATES[k].label);
  assert.equal(new Set(labels).size, labels.length, "one word per state");
  for (const k of STATE_KEYS) assert.ok(STATES[k].hint.length > 20, k);
  assert.deepEqual(Object.keys(MEANINGS), ["approved_internal", "client_accepted", "text_approved", "doc_generated", "doc_sent", "result_accepted"]);
  assert.match(MEANINGS.approved_internal.says, /clientul nu e contactat/);
  assert.match(MEANINGS.text_approved.says, /nu înseamnă trimis/);
  // Success, error, expiry and a waiting decision never share a state.
  assert.deepEqual(["READY", "FAILED", "EXPIRED", "WAITING_OWNER", "STALE"].map((s) => stateOf("desk", s)), ["done", "error", "expired", "decide", "stale"]);
  assert.equal(stateOf("delivery", "READY"), "done", "a delivery READY is a result, its decisions are inbox rows");
  assert.equal(stateOf("mission", "DELIVERY_READY"), "decide");
  assert.equal(stateOf("envelope", "PROPOSED"), "decide");
  assert.equal(stateOf("run", "RUNNING"), "run");
  assert.equal(stateOf("x", ""), "ready");
  assert.equal(stateOf("x", "SOMETHING_NEW"), "ready", "an unknown status is never shown as a result");
  assert.equal(meaningOf("proposal", "APPROVED_INTERNAL"), "approved_internal");
  assert.equal(meaningOf("opportunity", "WON"), "client_accepted");
  assert.equal(meaningOf("bundle", "OWNER_ACCEPTED"), "result_accepted");
  assert.equal(meaningOf("proposal", "DRAFT"), null);
});

test("M15-ATT-01 „Ce te așteaptă”: decisions first (inbox), then blockers / errors / runs / outdated; one row per thing; project filter", () => {
  const inbox = [
    { kind: "software_bundle", id: "bnd_1", projectId: "p1", title: "Pachet", why: "Așteaptă", link: "/livrare/dlv_1", waitingSince: "2026-10-23T10:00:00Z" },
    { kind: "delivery", id: "dlv_1", projectId: "p1", title: "Livrare", link: "/livrare/dlv_1", waitingSince: "2026-10-23T10:00:00Z" },
    { kind: "sales_offer", id: "spr_1", opportunityId: "opp_1", title: "Oferta", target: { version: 2, proposalSha: SHA }, link: "/sales?tab=opp&id=opp_1" },
    { kind: "desk_finance_doc", id: "dar_1", recordId: "dsk_1", title: "DVZ-0001", target: { version: 1, sha: SHA }, link: "/lega" },
  ];
  const desk = [
    { id: "dsk_1", kind: "finance_doc", status: "WAITING_OWNER", internalNo: "DVZ-0001", title: "Deviz" },
    { id: "dsk_2", kind: "ops_start", status: "STALE", internalNo: "OPS-0001", title: "Dosar", statusReason: "Oferta s-a schimbat", nextAction: "Pregătește continuarea", updatedAt: "2026-10-23T09:00:00Z" },
    { id: "dsk_3", kind: "support_case", status: "FAILED", internalNo: "SUP-0001", title: "Caz", statusReason: "Sursa lipsește" },
  ];
  const deliveries = [{ id: "dlv_1", projectId: "p1", status: "READY" }, { id: "dlv_2", projectId: "p2", status: "STALE", title: "Veche", statusReason: "Codul s-a schimbat" }, { id: "dlv_3", projectId: "p1", status: "READY", title: "Gata" }];
  const runs = [{ runId: "run_1", provider: "codex", phase: "streaming", conversationId: "conv_1" }];
  const workRequests = [{ id: "wr_1", text: "fă formularul", blockedBy: { text: "Poarta e suspendată" } }];
  const items = attentionItems({ inbox, desk, deliveries, runs, workRequests });
  assert.deepEqual(items.map((x) => [x.key, x.state]), [
    ["software_bundle:bnd_1", "decide"], ["delivery:dlv_1", "decide"], ["sales_offer:spr_1", "decide"], ["desk_finance_doc:dar_1", "decide"],
    ["request:wr_1", "block"], ["desk:dsk_3", "error"], ["run:run_1", "run"], ["desk:dsk_2", "stale"], ["delivery:dlv_2", "stale"],
  ], "by state, then newest first (a row without a date last in its state)");
  assert.ok(!items.some((x) => x.key === "desk:dsk_1"), "the deviz waiting in the inbox is one row, not two");
  assert.ok(!items.some((x) => x.key === "delivery:dlv_3"), "a READY delivery with no pending decision is not an attention row");
  const offer = items.find((x) => x.kind === "sales_offer");
  assert.equal(offer.target.proposalSha, SHA, "the exact target travels with the row");
  assert.equal(offer.opportunityId, "opp_1");
  assert.equal(items.find((x) => x.key === "desk_finance_doc:dar_1").deskRecordId, "dsk_1", "a desk decision opens its record on the L3ga screen");
  assert.equal(items.find((x) => x.key === "desk:dsk_2").next, "Pregătește continuarea", "an outdated record says its next action");
  const only = attentionItems({ inbox, desk, deliveries, runs, workRequests, projectId: "p2" });
  assert.ok(only.some((x) => x.key === "delivery:dlv_2") && !only.some((x) => x.key === "software_bundle:bnd_1"), "the project filter keeps company rows and that project's");
  assert.equal(attentionSummary(items), "4 decizii · 1 blocaj · 1 eroare · 1 în lucru · 2 depășite");
  assert.equal(attentionSummary([]), "Nimic nu te așteaptă");
  assert.deepEqual(attentionItems({}), []);
});

test("M15-ACT-01 the open activity: ONE primary action, from real data only, in a fixed order (plan → ops plan → error → blocked → run → decision → outdated → ready)", () => {
  const future = new Date(Date.now() + 600000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  const plan = { envelope: { id: "env_1", status: "PROPOSED", confirmBy: future }, summary: { headline: "Formular de contact" } };
  assert.deepEqual([currentActivity({ projectName: "Demo", plan }).state, currentActivity({ projectName: "Demo", plan }).primary.kind], ["decide", "focus-plan"]);
  const expired = currentActivity({ plan: { ...plan, envelope: { ...plan.envelope, confirmBy: past } } });
  assert.deepEqual([expired.state, expired.primary.kind], ["expired", "replan"]);
  assert.match(expired.sub, /nimic nu a pornit/);
  assert.equal(currentActivity({ opsPlan: { id: "op_1", status: "PROPOSED", title: "Captură" } }).primary.kind, "focus-ops");
  const err = currentActivity({ error: { message: "Proiect necunoscut" } });
  assert.equal(err.state, "error");
  assert.match(err.sub, /Ce era salvat a rămas neschimbat/);
  assert.equal(currentActivity({ busy: true }).primary, null, "while the Hub only reads, no button");
  assert.equal(currentActivity({ workRequests: [{ id: "w", reason: "Poarta" }] }).state, "block");
  const run = currentActivity({ runs: [{ provider: "codex", phase: "streaming", conversationId: "conv_1" }, { provider: "claude" }] });
  assert.deepEqual([run.state, run.primary.link, run.title], ["run", "/conversations/conv_1", "Codex lucrează (+1)"]);
  const dec = currentActivity({ attention: [{ state: "decide", title: "Oferta", sub: "Vânzări", link: "/sales?tab=opp&id=o" }] });
  assert.deepEqual([dec.state, dec.primary.label], ["decide", "Deschide locul deciziei"]);
  const stale = currentActivity({ deliveries: [{ id: "d1", status: "STALE", statusReason: "Codul s-a schimbat", updatedAt: "2026-10-23T10:00:00Z" }] });
  assert.deepEqual([stale.state, stale.sub, stale.primary.link], ["stale", "Codul s-a schimbat", "/livrare/d1"]);
  const ready = currentActivity({ projectName: "Demo" });
  assert.deepEqual([ready.state, ready.title, ready.primary.kind], ["ready", "Lucrezi la Demo", "composer"]);
  assert.equal(currentActivity({}).context, "Compania");
});

test("M15-HIST-01 history by name and date, newest first; words filter (no id needed); each row opens where it lives", () => {
  const rows = historyRows({
    deliveries: [{ id: "dlv_1", projectId: "p1", title: "Formular", status: "READY", updatedAt: "2026-10-20T10:00:00Z" }],
    desk: [{ id: "dsk_1", kind: "finance_doc", internalNo: "DVZ-0001", title: "Devizul în ciornă", status: "READY", artifact: { version: 2, status: "APPROVED_INTERNAL" }, updatedAt: "2026-10-22T10:00:00Z" },
      { id: "dsk_2", kind: "ops_start", internalNo: "OPS-0001", title: "Dosarul de pornire", status: "STALE", export: { status: "READY" }, updatedAt: "2026-10-21T10:00:00Z", statusReason: "Oferta s-a schimbat" }],
    opportunities: [{ id: "opp_1", title: "Site Brutăria", orgName: "Brutăria Sorin", status: "APPROVED_INTERNAL", updatedAt: "2026-10-23T10:00:00Z", synthetic: true }],
  });
  assert.deepEqual(rows.map((r) => r.key), ["opp:opp_1", "dsk:dsk_1", "dsk:dsk_2", "dlv:dlv_1"]);
  assert.deepEqual(rows.map((r) => r.kind), ["Ofertă", "Deviz", "Dosar de pornire", "Livrare"]);
  assert.equal(rows[0].meaning, "approved_internal");
  assert.equal(rows[0].link, "/sales?tab=opp&id=opp_1");
  assert.equal(rows[1].title, "DVZ-0001 Devizul în ciornă · v2");
  assert.equal(rows[1].meaning, "approved_internal");
  assert.equal(rows[2].state, "stale");
  assert.equal(rows[3].state, "done");
  assert.deepEqual(historyRows({ desk: [{ id: "x", kind: "ops_start", internalNo: "OPS-0001", title: "Dosar", status: "READY" }] }, { query: "ops-0001" }).length, 1);
  assert.deepEqual(historyRows({ opportunities: [{ id: "o", title: "Site Brutăria", status: "DRAFT" }] }, { query: "brutăria site" }).length, 1, "all the words, any order");
  assert.deepEqual(historyRows({ opportunities: [{ id: "o", title: "Site", status: "DRAFT" }] }, { query: "deviz" }).length, 0);
  assert.deepEqual(historyRows({ deliveries: [{ id: "a", projectId: "p1" }, { id: "b", projectId: "p2" }] }, { projectId: "p1" }).map((r) => r.key), ["dlv:a"]);
});

test("M15-DEC-01 „Ce decizii am?” names the results waiting for the owner (never „none” while the list is not empty); the inbox kinds all have words", () => {
  assert.equal(decisionsLine({ decisions: [], packages: [], inbox: [] }), "Nicio decizie în așteptare.");
  const line = decisionsLine({ decisions: [{ title: "Aprobări în așteptare: 1" }], packages: [], inbox: [{ kind: "desk_finance_doc", title: "DVZ-0001: Devizul" }, { kind: "sales_offer", title: "Oferta v2" }] });
  assert.match(line, /^Te așteaptă 2 decizii: Deviz de aprobat: „DVZ-0001: Devizul”; Ofertă de aprobat: „Oferta v2”\./);
  assert.match(line, /Pe lângă ele, o aprobare tehnică sau un plan \(în Decizii\)\./);
  assert.match(decisionsLine({ decisions: [], inbox: [{ kind: "delivery", title: "x" }] }), /^Te așteaptă o decizie: Livrare/);
  assert.match(decisionsLine({ decisions: [{}, {}], packages: [{}] }), /^Te așteaptă 3 aprobări tehnice, planuri sau pachete/);
  assert.match(decisionsLine({ inbox: Array.from({ length: 6 }, (_, i) => ({ kind: "delivery", title: `L${i}` })) }), /încă 2\./);
  assert.ok(intelLines({ decisions: [], inbox: [{ kind: "delivery", title: "x" }] }).some((l) => /Te așteaptă o decizie/.test(l)));
  for (const kind of ["software_bundle", "mission_decision", "delivery", "sales_offer", "desk_support_reply", "desk_finance_doc", "delivery_correction"]) assert.ok(DECISION_KIND[kind], kind);
  // The server answer carries the inbox (read-only, the same list as GET /api/decisions/inbox).
  const intake = source("server/owner/intake.mjs");
  assert.match(intake, /r\.inbox = decisionsInbox\(hub\)\.items\.map\(\(it\) => \(\{ kind: it\.kind, title: it\.title, link: it\.link \|\| null \}\)\);/);
});

test("M15-NAV-01 the rail: the owner's work, the departments, „Avansat” (folded); every old route keeps its address; Alt+1–9 unchanged", () => {
  assert.deepEqual(NAV_GROUPS.map(([g]) => g), ["main", "dept", "adv"]);
  assert.deepEqual(NAV.filter((n) => n.group === "main").map((n) => n.label), ["L3ga", "Decizii", "Lucrări", "Rezultate"]);
  assert.deepEqual(NAV.filter((n) => n.group === "dept").map((n) => n.id), ["sales", "studio", "company"]);
  for (const id of ["lega", "intel", "control", "conversations", "missions", "approvals", "agents", "projects", "memory", "tools", "integrations", "health", "sales", "studio", "desktop", "company", "ecosystem", "system", "settings"])
    assert.ok(NAV.some((n) => n.id === id), `the route ${id} is still in the navigation`);
  assert.ok(NAV.every((n) => ["main", "dept", "adv"].includes(n.group)));
  assert.deepEqual(NAV.filter((n) => n.key).map((n) => [n.key, n.id]).sort(), [["1", "control"], ["2", "conversations"], ["3", "missions"], ["4", "approvals"], ["5", "agents"], ["6", "projects"], ["7", "memory"], ["8", "tools"], ["9", "integrations"]]);
  assert.equal(navHref(NAV.find((n) => n.id === "decizii")), "#/livrare/decizii");
  assert.equal(navHref(NAV.find((n) => n.id === "sales")), "#/sales");
  assert.equal(navCurrent({ name: "livrare", id: "decizii" }), "decizii");
  assert.equal(navCurrent({ name: "livrare", id: "dlv_1" }), "rezultate");
  assert.equal(navCurrent({ name: "focus" }), "conversations");
  const main = source("web/src/main.jsx");
  assert.match(main, /rezultate: lazy\(\(\) => import\("\.\/screens\/Results\.jsx"\)\),/);
  const shell = source("web/src/shell/Shell.jsx");
  assert.match(shell, /const mobileNav = \["lega", "decizii", "rezultate"\];/);
  assert.match(shell, /\{route\.name !== "lega" && <ProjectSwitcher go=\{go\} \/>\}/, "one place says where you work on the L3ga screen");
  assert.match(shell, /run: \(\) => go\(n\.href \|\| `\/\$\{n\.id\}`\)/, "the palette opens the same addresses as the rail");
});

test("M15-UI-01 source: the L3ga screen keeps its contracts (one composer, the interruptions with Stop All first, the work under .cockpit-main) and adds the three zones", () => {
  const lega = source("web/src/screens/Lega.jsx");
  assert.match(lega, /<AttentionPanel inbox=\{inbox\}/);
  assert.match(lega, /<ActivityHeader activity=\{current\} onPrimary=\{onPrimary\} \/>/);
  assert.match(lega, /<HistoryList projectId=\{pid \|\| null\}/);
  assert.match(lega, /hidden=\{workTab === "history"\}/, "the work stays mounted behind the history (plans, rearm, desk keep their state)");
  const bar = lega.slice(lega.indexOf('aria-label="Întreruperi"'), lega.indexOf("</section>", lega.indexOf('aria-label="Întreruperi"')));
  assert.ok(bar.indexOf("<StopAllButton compact />") < bar.indexOf('interrupt("mute")'), "Stop All first");
  for (const k of ["mute", "pause", "stop_worker", "freeze", "takeover"]) assert.ok(bar.includes(`interrupt("${k}"`), k);
  assert.equal((lega.match(/aria-label="Mesaj pentru Lega"/g) || []).length, 1, "one composer");
  assert.match(lega, /if \(focusTarget \|\| deskFocus\?\.id\) setWorkTab\("now"\);/, "a plan or a record asked into focus is never hidden behind the history");
  // The decisions show the exact target in full before the click (envelope, ops plan, Factory bundle, Delivery Room rows, Sales content).
  assert.match(source("web/src/screens/lega/cards.jsx"), /<TargetDetails items=\{\[\{ label: "ID", value: env\.id \}, \{ label: "SHA", value: env\.envelopeHash \}\]\} \/>/);
  assert.match(source("web/src/screens/lega/OpsPlanCard.jsx"), /\{ label: "SHA", value: plan\.hash \}/);
  assert.match(source("web/src/screens/factory/FactoryPanel.jsx"), /\{ label: "SHA", value: latestBundle\.sha256 \}/);
  assert.match(source("web/src/screens/delivery/DecisionsPanel.jsx"), /<TargetDetails items=\{fullTargetOf\(row\)\} \/>/);
  assert.match(source("web/src/screens/sales/Opportunity.jsx"), /\{ label: "SHA", value: draft\.sha \}/);
  // Nothing new in these views decides or starts anything: no POST in the attention / history / results views.
  for (const rel of ["web/src/screens/lega/Attention.jsx", "web/src/screens/Results.jsx", "web/src/components/StatePill.jsx", "web/src/lib/stateVocab.js"])
    assert.doesNotMatch(source(rel), /method: "POST"|\/approve|\/confirm|\/accept|getUserMedia/, rel);
});

test("M15-ERR-01 an error says what was kept and how to continue, from the HTTP answer only", async () => {
  const ui = source("web/src/components/ui.jsx");
  const fn = ui.slice(ui.indexOf("export function errorContinuation"), ui.indexOf("export function ErrorNotice"));
  const errorContinuation = new Function(`${fn.replace("export function", "return function").replace(/^\/\*\*[\s\S]*?\*\/\s*/, "")}`)();
  assert.match(errorContinuation({ status: 409 }), /nu s-a schimbat nimic/);
  assert.match(errorContinuation({ status: 0 }), /Ce era salvat rămâne/);
  assert.match(errorContinuation({ status: 503 }), /Datele salvate rămân/);
  assert.equal(errorContinuation({}), "");
  assert.match(source("web/src/screens/Lega.jsx"), /errorContinuation\(e\) \|\| "Textul tău e mai sus; îl poți trimite din nou\."/);
});
