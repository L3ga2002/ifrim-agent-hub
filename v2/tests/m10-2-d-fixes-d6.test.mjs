// 2.12.3 (D6) — „Importă în Studio proiectul din C:\…\M09 - Un plan, o confirmare” (live 2026-10-06) got no answer: the folder parser
// refused „în Studio” before „din”, a sentence starting with „Importă” that names no readable folder fell through as a silent unknown
// (UNKNOWN_INTENTS = 1), and the deictic form refused „în Studio” too.
// PASS_SIMULATED: pure functions plus test Hubs (owner.intent typed on the owner channel, a provider transcript on the voice channel, the
// desktop operator fixture for the Explorer window); no model, no live Hub, no network.
//  - D6-01/02/03: the parser, the resolver's deictic rule and the „no folder” detector (pure);
//  - D6-04: every placement of „în Studio” (and a bare drive path) proposes the SAME import card as the reference sentence; nothing is
//    imported, no grant, no run; a folder outside the roots stays refused without the owner session;
//  - D6-05: „Importă …” with no folder gets ONE plain explanation from every source, counted as answered (a real unknown still counts);
//  - D6-06: „Importă în Studio din folderul acesta” reads the Explorer window like „Importă din folderul acesta”;
//  - D6-07: mutation checks of the parser and the resolver on temporary copies (the repository files are never touched).
// Hand mutation (repo convention: break → the named test fails → exact bytes restored → green), recorded here: deleting the intake line
// `else if (loneUnknown && importWithoutFolder(input.text)) …` or the executeStep branch `step.args?.importNoFolder` turns D6-05 red (no
// message; owner.intent_outcome shows unknownUnanswered 1).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, tempDir } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop } from "./m10-helpers.mjs";
import { parseImportFolder, importWithoutFolder, IMPORT_FOLDER_HELP } from "../server/ops/intent-actions.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { BUNDLE_FORMAT, BUNDLE_VERSION, BUNDLE_FILE } from "../server/media/project-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "server");
const B = String.fromCharCode(92); // a backslash (built, never typed: a heredoc or an editor may collapse it)
const LIVE_DIR = ["C:", "Users", "mihai", "Videos", "Ifrim Studio", "M09 - Un plan, o confirmare"].join(B);
const LIVE = `Importă în Studio proiectul din ${LIVE_DIR}`;
const NAME = "M09 - Un plan, o confirmare";
const REFERENCE = `Importă proiectul din folderul ${NAME}`;

const intent = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const onUi = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "ui", actor: "user" }).then((r) => r.result);
const onVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT id, seq, payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ id: e.id, seq: e.seq, payload: JSON.parse(e.payload_json || "{}") }));
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const writeBundle = (dir, title) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, BUNDLE_FILE), JSON.stringify({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, project: { title }, labels: [], documents: {}, claims: [], assets: [], edits: [], variants: [] })); };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const NO_IDS = /\b(opp|prj|env|mis)_/;

// ---------------------------------------------------------------- the pure checks (shared by the real module and the mutants)
/** D6-01: sentence → the folder reference the parser reads (null: no folder). */
const PARSED = [
  [LIVE, LIVE_DIR],
  [`Importă în Studio-ul proiectul din folderul ${NAME}`, NAME],
  [`Importă în Studioul proiectul din folderul ${NAME}.`, NAME],
  [`Importă proiectul în Studio din ${LIVE_DIR}`, LIVE_DIR],
  [`Importă din ${LIVE_DIR} în Studio-ul, te rog.`, LIVE_DIR],
  [`Importă în Studio, din ${LIVE_DIR}`, LIVE_DIR],
  [`Importă în Studio ${LIVE_DIR}`, LIVE_DIR],
  [`Importă ${LIVE_DIR}`, LIVE_DIR],
  [`Lega, importă în Studio proiectul din C:${B}x${B}y.`, `C:${B}x${B}y`],
  // D6 review: a leading acknowledgement (the same leads the resolver drops), alone or with the Lega prefix and „te rog”.
  [`Ok, importă în Studio proiectul din ${LIVE_DIR}`, LIVE_DIR], [`Hai, importă proiectul din folderul ${NAME}`, NAME], [`Ok importă în Studio ${LIVE_DIR}`, LIVE_DIR],
  [`Lega, ok, importă în Studio proiectul din ${LIVE_DIR}`, LIVE_DIR], [`Ok, Lega, te rog, importă din ${LIVE_DIR}`, LIVE_DIR], [`Haide, importă din ${LIVE_DIR}`, LIVE_DIR], [`Bine, importă din ${LIVE_DIR}`, LIVE_DIR],
  ["Importă clipul în Studio-ul din D:/Proiecte/Clip", "D:/Proiecte/Clip"],
  ["Importă din „Demo în Studio”", "Demo în Studio"],
  [REFERENCE, NAME],
  [`Importă proiectul din folderul ${NAME} în Studio`, NAME],
  // The four assertions of m10-2-content-planner (U10-CP-04), unchanged.
  ["Importă din folderul acesta", null],
  [`Te rog, importă materialele din C:${B}Users${B}x${B}Videos${B}Ifrim Studio.`, `C:${B}Users${B}x${B}Videos${B}Ifrim Studio`],
  ["Importa din „Ifrim Studio”", "Ifrim Studio"],
  ["Deschide Videos", null],
  ["Importă în Studio", null], ["Importă proiectul", null], ["Importatorul nu merge", null], ["Importă în Studio din folderul acesta", null],
];
function parserCase(parse) {
  for (const [sentence, ref] of PARSED) assert.deepEqual(parse(sentence), ref === null ? null : { folderRef: ref }, sentence);
}
/** D6-03: „Importă …” that names no readable folder. */
function withoutFolderCase(mod) {
  for (const s of ["Importă", "Importă în Studio", "Importă proiectul", "Lega, importă ceva", `Importă în Studio proiectul aflat în ${LIVE_DIR}`,
    "Ok, importă în Studio", "Hai, importă în Studio", "Ok importă", "Lega, ok, importă proiectul"]) assert.equal(mod.importWithoutFolder(s), true, s);
  for (const [s, ref] of PARSED) if (ref !== null) assert.equal(mod.importWithoutFolder(s), false, s);
  for (const s of ["Importantă e calitatea", "Importatorul nu merge", "Deschide Videos"]) assert.equal(mod.importWithoutFolder(s), false, s);
}
/** D6-02: the deictic forms are the resolver's studio_import_here; a named folder stays unknown (the intake fallback reads it). */
function deicticCase(resolve) {
  for (const s of ["Importă în Studio din folderul acesta", "Importă în Studio proiectul din folderul acesta", "Importă în Studio-ul de aici", "Importă din folderul acesta în Studio", "Importă din folderul acesta"]) {
    assert.deepEqual(resolve(s, {}).steps.map((x) => x.intent), ["studio_import_here"], s);
  }
  assert.deepEqual(resolve(LIVE, {}).steps.map((x) => x.intent), ["unknown"], "a named folder is never the Explorer path");
}

test("D6-01 the parser reads every placement of „în Studio”, a bare drive path, the Lega prefix and quoted names; the old assertions hold", () => {
  parserCase(parseImportFolder);
});

test("D6-02 the resolver: „Importă în Studio din folderul acesta” (and the other deictic forms) is studio_import_here; a named folder stays unknown", () => {
  deicticCase(resolveIntent);
});

test("D6-03 importWithoutFolder: true only for „Importă …” with no readable folder; never for „Importantă …” or a parseable sentence", () => {
  withoutFolderCase({ importWithoutFolder });
  assert.match(IMPORT_FOLDER_HELP, /din ce folder/);
  assert.match(IMPORT_FOLDER_HELP, /Importă din folderul acesta/);
  assert.doesNotMatch(IMPORT_FOLDER_HELP, NO_IDS);
});

test("D6-04 test Hub: every placement proposes the SAME import card as the reference sentence; nothing imported; outside the roots still needs the session", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const base = tempDir("d6");
    const videos = path.join(base, "Videos");
    const X = path.join(videos, "Ifrim Studio", NAME);
    writeBundle(X, "Un plan, o confirmare");
    writeBundle(path.join(base, "Downloads", "Primit"), "Primit");
    setPolicy(t, { importRoots: [videos] });
    const before = { grants: count(t, "SELECT COUNT(*) AS n FROM live_grants"), runs: count(t, "SELECT COUNT(*) AS n FROM agent_runs") };

    const ref = (await intent(t, owner, { text: REFERENCE })).results[0];
    assert.equal(ref.intent, "studio_import_folder", JSON.stringify(ref));
    assert.ok(ref.opsPlan, JSON.stringify(ref));
    assert.deepEqual(ref.opsPlan.decisions, []);
    assert.ok(same(ref.folder, X));
    const variants = [`Importă în Studio proiectul din ${X}`, `Importă în Studio-ul proiectul din folderul ${NAME}`, `Importă proiectul din folderul ${NAME} în Studio`,
      `Importă proiectul în Studio din ${X}`, `Importă în Studio ${X}`, `Ok, importă în Studio proiectul din ${X}`, `Hai, importă proiectul din folderul ${NAME}`];
    for (const text of variants) {
      const r = (await intent(t, owner, { text })).results[0];
      assert.equal(r.intent, "studio_import_folder", `${text}: ${JSON.stringify(r)}`);
      assert.ok(r.opsPlan, text);
      assert.ok(same(r.folder, X), text);
      assert.equal(r.opsPlan.hash, ref.opsPlan.hash, `${text}: the same card`);
      const step = t.hub.opsPlans.view(r.opsPlan.id).steps[0];
      assert.equal(step.kind, "media.project.import");
      assert.ok(same(step.params.folder, X), text);
    }
    const said = events(t, "owner.intent");
    assert.equal(said.length, 1 + variants.length);
    for (const e of said) assert.deepEqual(e.payload.steps, ["studio_import_folder"]);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM content_projects"), 0, "nothing imported by a sentence");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM live_grants"), before.grants);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), before.runs);
    // Outside the import roots, in the new shape, on the cookie-less ui channel: still refused (no new authority from the parser).
    const outside = (await onUi(t, { text: `Importă în Studio ${path.join(base, "Downloads", "Primit")}` })).results[0];
    assert.match(outside.refused || "", /sesiunea ta de proprietar/, JSON.stringify(outside));
    assert.equal(outside.opsPlan, undefined);
  } finally { await t.cleanup(); }
});

test("D6-05 test Hub: „Importă …” with no folder → ONE plain explanation (typed and spoken), counted as answered; a real unknown still counts", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const plans = count(t, "SELECT COUNT(*) AS n FROM ops_plans");
    const runs = [];
    for (const text of ["Importă în Studio", "Importă proiectul", "Importă", "Ok, importă în Studio"]) runs.push([text, await intent(t, owner, { text })]);
    runs.push(["Importă în Studio (voce)", await onVoice(t, { text: "Importă în Studio" })]);
    runs.push(["Hai, importă în Studio (voce)", await onVoice(t, { text: "Hai, importă în Studio" })]);
    for (const [text, out] of runs) {
      const r = out.results[0];
      assert.equal(out.results.length, 1, text);
      assert.equal(r.intent, "unknown", text);
      assert.match(r.message || "", /din ce folder/, text);
      assert.match(r.message || "", /Importă din folderul acesta/, text);
      assert.equal(r.opsPlan, undefined, text);
      assert.doesNotMatch(JSON.stringify(r.message), NO_IDS, text);
    }
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans, "nothing proposed");
    const outcomes = events(t, "owner.intent_outcome");
    assert.equal(outcomes.length, 6);
    for (const o of outcomes) assert.deepEqual([o.payload.unknown, o.payload.unknownUnanswered], [1, 0]);
    // Control: a sentence the Hub does not understand is still counted as unanswered.
    const control = (await intent(t, owner, { text: "zbrrt flonk qwyx" })).results[0];
    assert.equal(control.intent, "unknown");
    assert.equal(control.message, undefined);
    assert.equal(events(t, "owner.intent_outcome").at(-1).payload.unknownUnanswered, 1);
  } finally { await t.cleanup(); }
});

test("D6-06 desktop fixture: „Importă în Studio din folderul acesta” reads the Explorer window like „Importă din folderul acesta” (the same card)", async () => {
  const base = tempDir("d6-here");
  const videos = path.join(base, "Videos");
  const X = path.join(videos, "Ifrim Studio", NAME);
  writeBundle(X, "Un plan, o confirmare");
  const t = await makeDesktopHub({ scenario: { windows: [{ kind: "explorer", processName: "explorer", title: NAME, className: "CabinetWClass", path: X }] } });
  try {
    const owner = await readyDesktop(t);
    setPolicy(t, { importRoots: [videos] });
    const plain = (await intent(t, owner, { text: "Importă din folderul acesta" })).results[0];
    assert.equal(plain.intent, "studio_import_here");
    assert.ok(plain.opsPlan, JSON.stringify(plain));
    const r = (await intent(t, owner, { text: "Importă în Studio din folderul acesta" })).results[0];
    assert.equal(r.intent, "studio_import_here", JSON.stringify(r));
    assert.ok(r.opsPlan, JSON.stringify(r));
    assert.ok(same(r.folder, X));
    assert.equal(r.opsPlan.hash, plain.opsPlan.hash);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM content_projects"), 0);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- D6-07 mutation checks (temp copies; the repository files are never touched)
let mutationN = 0;
async function mutated(file, mutate, imports) {
  const src = fs.readFileSync(file, "utf8");
  const changed = mutate(src);
  assert.notEqual(changed, src, "the mutation must apply");
  let out = changed;
  for (const [from, to] of imports) out = out.replace(`from "${from}"`, `from ${JSON.stringify(pathToFileURL(to).href)}`);
  const tmp = path.join(os.tmpdir(), `ifrim-d6-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(tmp, out);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const ACTIONS = path.join(SERVER, "ops", "intent-actions.mjs");
const ACTION_IMPORTS = [["../core/errors.mjs", path.join(SERVER, "core", "errors.mjs")], ["../owner/blockers.mjs", path.join(SERVER, "owner", "blockers.mjs")], ["./plans.mjs", path.join(SERVER, "ops", "plans.mjs")]];
const INTENTS = path.join(SERVER, "owner", "intents.mjs");
const INTENT_IMPORTS = [["../policy/effect-class.mjs", path.join(SERVER, "policy", "effect-class.mjs")]];
const fails = (fn) => { try { fn(); return false; } catch { return true; } };

test("D6-07 mutation checks: each piece of the parser and the resolver rule is what keeps D6-01…03 green", async () => {
  // The unmutated copies pass (the harness itself is sound).
  const real = await mutated(ACTIONS, (s) => `${s}\n// copy\n`, ACTION_IMPORTS);
  parserCase(real.parseImportFolder);
  withoutFolderCase(real);
  // M1: no „în Studio” right after the verb — the live sentence parses to nothing.
  const m1 = await mutated(ACTIONS, (s) => s.replace("^${IMPORT_VERB}\\s+(?:${IN_STUDIO}[\\s,]+)?", "^${IMPORT_VERB}\\s+"), ACTION_IMPORTS);
  assert.equal(m1.parseImportFolder(LIVE), null);
  assert.ok(fails(() => parserCase(m1.parseImportFolder)));
  // M2: no „în Studio” after the object.
  const m2 = await mutated(ACTIONS, (s) => s.replace("(?:${IMPORT_OBJECT}[\\s,]+)?(?:${IN_STUDIO}[\\s,]+)?", "(?:${IMPORT_OBJECT}[\\s,]+)?"), ACTION_IMPORTS);
  assert.equal(m2.parseImportFolder(`Importă proiectul în Studio din ${LIVE_DIR}`), null);
  assert.ok(fails(() => parserCase(m2.parseImportFolder)));
  // M3: a trailing „în Studio” is no longer cut — it stays in the folder name („Nu găsesc folderul”).
  const m3 = await mutated(ACTIONS, (s) => s.replace("(?:\\s+frumos)?|${IN_STUDIO})", "(?:\\s+frumos)?)"), ACTION_IMPORTS);
  assert.deepEqual(m3.parseImportFolder(`Importă proiectul din folderul ${NAME} în Studio`), { folderRef: `${NAME} în Studio` });
  assert.ok(fails(() => parserCase(m3.parseImportFolder)));
  // M4: no bare drive path.
  const m4 = await mutated(ACTIONS, (s) => s.replace("|(?<drive>[a-z]:[\\\\/].*)", ""), ACTION_IMPORTS);
  assert.equal(m4.parseImportFolder(`Importă în Studio ${LIVE_DIR}`), null);
  assert.ok(fails(() => parserCase(m4.parseImportFolder)));
  // M5: the verb's end not checked — „Importantă e calitatea” would get the import explanation.
  const m5 = await mutated(ACTIONS, (s) => s.replace("(?=$|[\\s,.!?:;])", "(?=)"), ACTION_IMPORTS);
  assert.equal(m5.importWithoutFolder("Importantă e calitatea"), true);
  assert.ok(fails(() => withoutFolderCase(m5)));
  // M7 (D6 review): no acknowledgement in the spoken leads — „Ok, importă în Studio proiectul din <cale>” is a silent unknown again.
  const m7 = await mutated(ACTIONS, (s) => s.replace("|(?:ok|okay|hai|haide|bine)[\\s,!.:;-]+", ""), ACTION_IMPORTS);
  assert.equal(m7.parseImportFolder(`Ok, importă în Studio proiectul din ${LIVE_DIR}`), null);
  assert.equal(m7.importWithoutFolder("Ok, importă în Studio"), false);
  assert.ok(fails(() => parserCase(m7.parseImportFolder)));
  assert.ok(fails(() => withoutFolderCase(m7)));
  // M6: the resolver's deictic rule without „în Studio” — the live deictic form is unknown again.
  const m6 = await mutated(INTENTS, (s) => s.split("( in studio(-?ul)?,?)?").join(""), INTENT_IMPORTS);
  assert.deepEqual(m6.resolveIntent("Importă în Studio din folderul acesta", {}).steps.map((x) => x.intent), ["unknown"]);
  assert.ok(fails(() => deicticCase(m6.resolveIntent)));
});
