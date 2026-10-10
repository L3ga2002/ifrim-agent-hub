import crypto from "node:crypto";
import { scanSource } from "./test-first.mjs";

/**
 * Integrity checks on a writer's change set (M03 §16): success may not come from weakening the verification. Each check
 * becomes a finding with its evidence (the file and the added line), so the reviewer and the owner see it:
 *   critical — a protected acceptance test changed or deleted, an agent-control file (.codex/, .claude/, .mcp.json,
 *              AGENTS.md, CLAUDE.md, the test-project marker, the Hub's .ifrim-hub/ work area) created or changed; (closure R-HIST) an
 *              earlier mission's Hub-written test still active changed, deleted or replaced, a retired test's kept copy changed or the
 *              retired test recreated (same path, or its bytes under another name);
 *   high     — a test file deleted, a skip/only/todo added, a secret-like file created or changed;
 *   medium   — an existing test file modified (allowed, but reviewed separately), an empty catch, a lint/type check disabled.
 * M11 L5 (§5.5) — product code that could pass the protected test without fixing anything (rules on the CODE part of an added line:
 * comments removed, strings kept, so "// AC-1: …" is never a finding and `/**\/ if (…)` always is):
 *   test_detection_added   names the protected test (path, file name, "x.test") or an acceptance case ("AC-1: …");
 *   test_switch_added      reads how it is run (NODE_ENV, node:test, NODE_TEST_CONTEXT, execArgv, process.argv, any computed process[…],
 *                          process.env.CI, require.main / mainModule, a string search on an error .stack) — the runner sets NODE_ENV=test
 *                          and CI=1;
 *   test_harness_tampered  imports node:assert, writes to a prototype, a built-in or a global (assert[k] = …, Math.random = …,
 *                          globalThis.x = …, Object.defineProperty(globalThis, …)), ends or watches the process (process.exit, exitCode,
 *                          process.on("exit")) — a built-in module is one shared instance, so product code can disarm the test's assert;
 *   product_imports_test   imports from a test folder, a test-named file or the Hub's work area (where such logic would be exempt);
 *   code_not_reviewable    a code file the Hub cannot read as text (binary-looking or too large: no line rule and no review diff).
 * Their severity depends on the mission: on a mission whose acceptance test the Hub wrote and protected (`hubTest`) detection is
 * critical and the other four are high (the factory sends such a change back to the writer before any check, isTestFirstBlocking) —
 * critical when the file is a module the protected test loads directly and it is an assert import/overwrite or unreadable; on an
 * ordinary mission all five are medium (shown to the reviewer and the owner, never blocking: no new stop for missions the owner
 * confirmed before L5). A match inside package.json (a script line) is medium everywhere.
 * Only top-level test folders (test/, tests/, __tests__/) and test-named files (*.test.*, *.spec.*) are exempt as tests.
 * Heuristics on added lines only; nothing is executed.
 */
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|todo|only)\s*\(|\bx(?:it|describe)\s*\(|[{,]\s*(?:skip|todo)\s*:\s*(?:true|['"`])|\bt\.skip\s*\(/;
const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const DISABLE_RE = /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|istanbul ignore/;
// M11 L5 (§5.5). Files whose content can steer a run: code, markup with scripts and data files code reads (docs and notes are not).
const CODE_FILE_RE = /\.(?:[cm]?[jt]sx?|py|json|html?|vue|svelte)$/i;
// Source files of the JavaScript family, where these rules mean "how am I being run" or "what can I change in the test's world".
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/i;
// Files whose comments the JavaScript lexer (test-first.mjs scanSource) can tell apart: the JavaScript family and JSON.
const JS_LEXED_RE = /\.(?:[cm]?[jt]sx?|json)$/i;
// An acceptance case name as the Hub-written tests (and the fixtures) spell it: "AC-1: …", "AC-1 control: …".
const AC_NAME_RE = /\bAC-\d{1,3}\b(?: control)?\s*:/i;
const MEMBER = String.raw`\s*(?:\?\.|\.)\s*`;
const TEST_SWITCH_RE = new RegExp([
  String.raw`\bNODE_ENV\b`, String.raw`node:test\b`, String.raw`\bNODE_TEST_CONTEXT\b`, String.raw`\bexecArgv\b`, String.raw`\bmainModule\b`, String.raw`\brequire\s*\.\s*main\b`,
  String.raw`\bprocess${MEMBER}argv\b`, String.raw`\bprocess\s*(?:\?\.)?\[`,
  String.raw`\bprocess${MEMBER}env${MEMBER}CI\b`, String.raw`\benv\s*(?:\?\.)?\[\s*["'\x60]CI["'\x60]\s*\]`,
  String.raw`\.stack${MEMBER}(?:includes|match|matchAll|search|indexOf|lastIndexOf|startsWith|endsWith|split)\b`,
].join("|"));
// The specifier of an import / require / dynamic import on a line (strings kept by the comment-free view).
const IMPORT_RE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`]([^"'`]+)["'`]/g;
const ASSERT_IMPORT_RE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`](?:node:)?assert(?:\/strict)?["'`]/;
const ASSERT_WRITE_RE = /\bassert\s*(?:\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)/;
const BUILTINS = "globalThis|global|process|console|Object|Array|String|Number|Boolean|Promise|Function|Error|JSON|Math|Reflect|Symbol|Date|RegExp|Map|Set|WeakMap|Buffer|assert";
const TAMPER_RE = new RegExp([
  ASSERT_IMPORT_RE.source, ASSERT_WRITE_RE.source,
  // A prototype member written (X.prototype.y = …, X.prototype[k] = …) or a built-in's own member replaced (Math.random = …).
  String.raw`\.prototype\s*(?:\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)`, String.raw`\b(?:${BUILTINS})\s*(?:\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)`,
  String.raw`\b(?:Object|Reflect)\s*\.\s*(?:defineProperty|defineProperties|setPrototypeOf|assign)\s*\(\s*(?:${BUILTINS})\b`, String.raw`\bReflect\s*\.\s*(?:set|deleteProperty)\s*\(`,
  String.raw`\b__proto__\b`,
  String.raw`\bprocess${MEMBER}(?:exit|exitCode|reallyExit|abort)\b`,
  String.raw`\bprocess${MEMBER}(?:on|once|addListener|prependListener|prependOnceListener)\s*\(\s*["'\x60](?:exit|beforeExit|uncaughtException|unhandledRejection)["'\x60]`,
].join("|"));
// A specifier that leads into the tests or the Hub's work area.
const TEST_SPECIFIER_RE = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)\.ifrim-hub(?:\/|$)/i;
/** The codes a test-first mission sends back to the writer before any check (high, M11 L5 §5.5: a review PASS cannot carry them). */
export const TEST_FIRST_BLOCKING_CODES = Object.freeze(new Set(["test_switch_added", "test_harness_tampered", "product_imports_test", "code_not_reviewable"]));
/** A finding as integrityFindings returns it ({ code }) or as the factory stores it (code "I-001", fingerprint "integrity:<code>:<file>"). */
export const isTestFirstBlocking = (finding) => {
  const code = /^integrity:([a-z_]+):/.exec(String(finding?.fingerprint || ""))?.[1] || finding?.code;
  return finding?.severity === "high" && TEST_FIRST_BLOCKING_CODES.has(code);
};
/** What names a protected test inside code: its path, its file name, or its file name without the last extension ("x.test"). */
const protectedNeedles = (refs) => [...new Set(refs.flatMap((ref) => {
  const base = ref.split("/").pop();
  return [ref, base, base.replace(/\.[^.]+$/, "")].filter((n) => n && n.includes("."));
}))];
/** Tests as the M11 L5 rules see them: only the top-level test folders and test-named files (a nested src/test/ is product code). */
const isExemptTest = (rel) => /^(?:test|tests|__tests__)\//i.test(rel) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(rel);

/**
 * The code part of each line of a file (comments blanked, strings kept), keyed by the line's exact text: Map<line, [code, …]>, one entry
 * per occurrence. The JavaScript family and JSON go through the Hub's own lexer (test-first.mjs scanSource: //, /* … *\/ across lines;
 * at a lexer problem it stops and the rest stays code — fail closed); HTML loses its <!-- … --> spans; Python its # comments outside
 * strings. An added line is looked up here by its text, so a docblock line ("* AC-1: …") is known to be inside a comment opened on an
 * earlier, unchanged line.
 */
function codeLinesOf(rel, text) {
  const raw = String(text).replace(/\r\n?/g, "\n");
  let view = raw;
  if (JS_LEXED_RE.test(rel)) {
    const chars = raw.split("");
    for (const c of scanSource(raw).comments) for (let k = c.start; k < c.end; k += 1) if (chars[k] !== "\n") chars[k] = " ";
    view = chars.join("");
  } else if (/\.(?:html?|vue|svelte)$/i.test(rel)) {
    view = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, " "));
  } else if (/\.py$/i.test(rel)) {
    view = raw.split("\n").map(pythonCode).join("\n");
  }
  const map = new Map();
  const lines = raw.split("\n");
  const codes = view.split("\n");
  lines.forEach((line, k) => { const list = map.get(line) || []; list.push(codes[k] ?? line); map.set(line, list); });
  return map;
}
/** A Python line without its # comment (a # inside a '…' or "…" string is kept). */
function pythonCode(line) {
  let quote = null;
  for (let k = 0; k < line.length; k += 1) {
    const ch = line[k];
    if (quote) { if (ch === "\\") k += 1; else if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "#") return line.slice(0, k);
  }
  return line;
}
/**
 * The code part of an added line. With the file's text (what the factory always passes): the most code-like occurrence of that exact line
 * in the file (an occurrence with code wins over one inside a comment — fail closed). Without it (a direct caller): the line alone through
 * the same lexer, so a trailing comment is removed but a lone "* …" line is checked as code.
 */
function codePartOf(rel, line, fileLines) {
  const text = String(line).replace(/\r$/, "");
  const found = fileLines?.get(text);
  if (found?.length) return found.find((c) => c.trim()) ?? "";
  return codeLinesOf(rel, text).get(text)?.[0] ?? text;
}
// Standard-library names a Python test run imports (M08 review): a top-level module or package with one of these names shadows it.
const STDLIB_SHADOW = new Set(["unittest", "ast", "importlib", "io", "pathlib", "os", "re", "json", "types", "typing", "inspect", "traceback", "functools", "collections", "contextlib", "datetime", "zoneinfo", "time", "site", "sitecustomize", "usercustomize", "encodings", "codecs", "abc", "enum", "warnings", "argparse", "fnmatch", "difflib", "pprint", "signal", "weakref", "copy", "operator", "itertools", "keyword", "linecache", "tokenize", "token", "textwrap", "string", "stat", "posixpath", "genericpath", "ntpath", "locale", "struct", "math", "random"]);

/**
 * `hubTest` (M11 L5): { refs: [the Hub-written protected test], loads: [project paths the protected test load()s] } on a test-first
 * mission whose test is protected, else null (ordinary severities, see above). `texts`: { [path]: text | null } — the after-text of each
 * changed code file (null = not readable as text); the comment-free view and code_not_reviewable read it. Without it neither applies
 * (a direct caller), and the line alone is lexed.
 */
export function integrityFindings({ changes, added = [], protectedRefs = [], hubTest = null, texts = null, historic = null }) {
  const findings = [];
  const add = (severity, code, file, observation, evidence) => findings.push({ severity, code, file, area: "integritate", observation, evidence,
    impact: severity === "critical" ? "Verificarea nu mai poate fi considerată independentă" : "Poate ascunde un defect sau o regresie" });
  const protectedSet = new Set(protectedRefs.map((p) => p.toLowerCase()));
  // Closure R-HIST: the earlier Hub-written tests of the project (`historic.refs`, still active) are protected from this writer like
  // its own acceptance test, and the tests a mission retired (`historic.retired`: { from, to, sha256 }) may be neither touched in their
  // retired place nor brought back (same path, or the same bytes under another name). The Hub's own retirement at the start happens
  // before the base snapshot, so it is never a change here (R-HIST-03).
  const historicSet = new Set((historic?.refs || []).map((p) => String(p).toLowerCase()));
  const retiredFrom = new Map((historic?.retired || []).map((r) => [String(r.from).toLowerCase(), r]));
  const retiredTo = new Map((historic?.retired || []).map((r) => [String(r.to).toLowerCase(), r]));
  const retiredSha = new Map((historic?.retired || []).map((r) => [String(r.sha256), r]));
  // Review #6: a git-backed snapshot names an entry by its git oid ("git:…"); the content sha comes from the file text the factory passes.
  const contentSha = (change) => { const v = change.after?.sha256 || null; return v && String(v).startsWith("git:") ? (typeof texts?.[change.path] === "string" ? crypto.createHash("sha256").update(Buffer.from(texts[change.path], "utf8")).digest("hex") : null) : v; };
  const historicHandled = new Set();
  for (const change of changes) {
    const lower = change.path.toLowerCase().replace(/\\/g, "/");
    if (protectedSet.has(lower)) continue;
    if (historicSet.has(lower)) add("critical", "historic_test_changed", change.path, `Un test de acceptanță scris de Hub pentru o misiune anterioară a fost ${change.status === "deleted" ? "șters" : change.status === "added" ? "înlocuit" : "modificat"} de writer`, `${change.status} ${change.path}`);
    else if (retiredTo.has(lower)) add("critical", "retired_test_changed", change.path, `Copia păstrată a unui test retras a fost ${change.status === "deleted" ? "ștearsă" : "modificată"} de writer`, `${change.status} ${change.path}`);
    else if (change.status !== "deleted" && retiredFrom.has(lower)) add("critical", "retired_test_recreated", change.path, "Un test retras de Hub a fost recreat de writer în suita activă", `${change.status} ${change.path}`);
    else if (change.status === "added" && retiredSha.has(contentSha(change))) add("critical", "retired_test_recreated", change.path, `Octeții testului retras ${retiredSha.get(contentSha(change)).from} au reapărut sub alt nume`, `${change.status} ${change.path}`);
    else continue;
    historicHandled.add(lower);
  }
  // Python resolves modules from the project root first: a writer-created top-level module named like a standard-library one the
  // test run uses (unittest, ast, importlib, …) or a sitecustomize would replace it and could fake the protected acceptance run
  // (review M08 round 2). Same for an __init__.py added on the protected test's package path.
  const protectedDirs = new Set([...protectedSet].flatMap((p) => p.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
  for (const change of changes) {
    const lower = change.path.toLowerCase().replace(/\\/g, "/");
    if (change.status === "deleted") continue;
    const top = lower.split("/")[0].replace(/\.py$/, "");
    if (lower.endsWith(".py") && STDLIB_SHADOW.has(top)) add("critical", "stdlib_shadowed", change.path, "Writer-ul a creat un modul cu numele unei biblioteci standard folosite de rularea testelor (ar înlocui-o)", `${change.status} ${change.path}`);
    else if (lower.endsWith("/__init__.py") && change.status === "added" && protectedDirs.has(lower.slice(0, -"/__init__.py".length))) add("high", "protected_package_changed", change.path, "Writer-ul a adăugat un __init__.py pe calea testului de acceptanță protejat", `${change.status} ${change.path}`);
  }
  for (const change of changes) {
    const lower = change.path.toLowerCase();
    if (historicHandled.has(lower.replace(/\\/g, "/"))) continue;
    if (protectedSet.has(lower)) add("critical", "protected_test_changed", change.path, `Testul de acceptanță protejat a fost ${change.status === "deleted" ? "șters" : "modificat"} de writer`, `${change.status} ${change.path}`);
    else if (change.controlFile) add("critical", "control_file_changed", change.path, "Writer-ul a creat sau a modificat un fișier care controlează agenții sau Hub-ul", `${change.status} ${change.path}`);
    else if (change.secretLike) add("high", "secret_like_changed", change.path, "Un fișier cu nume de secret a fost creat sau modificat (conținutul nu e citit de Hub)", `${change.status} ${change.path}`);
    else if (change.testFile && change.status === "deleted") add("high", "test_deleted", change.path, "Un fișier de test a fost șters", `deleted ${change.path}`);
    else if (change.testFile && change.status === "modified") add("medium", "test_modified", change.path, "Un test existent a fost modificat; cere review separat", `modified ${change.path}`);
  }
  // M11 L5: severities of the product-code rules (see the header): strict on a mission with a protected Hub-written test, medium otherwise.
  const strict = Boolean(hubTest);
  const loads = new Set((hubTest?.loads || []).map((p) => String(p).toLowerCase()));
  const loaded = (rel) => loads.has(rel.toLowerCase());
  const level = (severity) => (strict ? severity : "medium");
  const fileTexts = texts && typeof texts === "object" ? texts : null;
  const lineMaps = new Map();
  const linesOf = (rel, original) => {
    if (!fileTexts || typeof fileTexts[original] !== "string") return null;
    if (!lineMaps.has(rel)) lineMaps.set(rel, codeLinesOf(rel, fileTexts[original]));
    return lineMaps.get(rel);
  };
  if (fileTexts) {
    for (const change of changes) {
      const rel = change.path.replace(/\\/g, "/");
      if (change.status === "deleted" || change.secretLike || change.controlFile || !CODE_FILE_RE.test(rel) || !Object.hasOwn(fileTexts, change.path) || fileTexts[change.path] !== null) continue;
      add(strict && loaded(rel) ? "critical" : level("high"), "code_not_reviewable", change.path,
        "Un fișier de cod nu poate fi citit ca text (pare binar sau e prea mare): nicio regulă pe linii și niciun diff de review nu îl acoperă", `${change.status} ${change.path}`);
    }
  }
  const needles = protectedNeedles([...protectedSet]);
  for (const { path, line } of added) {
    const text = line.trim().slice(0, 200);
    const rel = String(path || "").replace(/\\/g, "/");
    // The code part of the line (comments removed, strings kept), outside the tests: a test may name its own cases.
    const productCode = !isExemptTest(rel) && CODE_FILE_RE.test(rel);
    const code = productCode ? codePartOf(rel, line, linesOf(rel, path)) : "";
    const lowerCode = code.toLowerCase().replace(/\\/g, "/");
    const inPackageJson = /(?:^|\/)package\.json$/i.test(rel);
    const source = productCode && SOURCE_FILE_RE.test(rel);
    const specifiers = source ? [...code.matchAll(IMPORT_RE)].map((m) => m[1]) : [];
    const detection = productCode && (AC_NAME_RE.test(code) || needles.some((n) => lowerCode.includes(n)));
    const detectionSeverity = inPackageJson ? "medium" : level("critical");
    const detected = () => add(detectionSeverity, "test_detection_added", path, "Codul din afara testelor numește testul de acceptanță protejat sau un caz de acceptanță (poate recunoaște testul în loc să repare)", text);
    // One finding per line, the most severe first (a medium detection never hides a skip).
    if (detection && detectionSeverity === "critical") detected();
    else if (SKIP_RE.test(line)) add("high", "skip_added", path, "A fost adăugat un test sărit / exclusiv (skip, only, todo)", text);
    else if (detection) detected();
    else if (source && TEST_SWITCH_RE.test(code)) add(level("high"), "test_switch_added", path, "Un fișier sursă a început să citească felul în care e rulat (NODE_ENV, node:test, process.argv, CI, …); poate trece testul fără să repare", text);
    else if (source && TAMPER_RE.test(code)) {
      const disarms = ASSERT_IMPORT_RE.test(code) || ASSERT_WRITE_RE.test(code);
      add(strict && loaded(rel) && disarms ? "critical" : level("high"), "test_harness_tampered", path,
        "Codul importă node:assert sau schimbă un built-in, un prototip, un obiect global ori ieșirea procesului: poate dezarma testul protejat fără să repare", text);
    } else if (specifiers.some((s) => TEST_SPECIFIER_RE.test(s))) add(level("high"), "product_imports_test", path, "Codul importă dintr-un folder de teste, dintr-un fișier de test sau din zona de lucru a Hub-ului", text);
    else if (EMPTY_CATCH_RE.test(line)) add("medium", "empty_catch", path, "A fost adăugat un catch gol (eroarea ar fi înghițită)", text);
    else if (DISABLE_RE.test(line)) add("medium", "check_disabled", path, "A fost dezactivată o regulă de lint sau de tipuri", text);
  }
  // One finding per (code, file): repeated lines in the same file add no information.
  const seen = new Set();
  return findings.filter((f) => { const key = `${f.code}:${f.file}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export const isBlockingIntegrity = (finding) => finding.severity === "critical";
