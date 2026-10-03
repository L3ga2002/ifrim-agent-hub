/**
 * Integrity checks on a writer's change set (M03 §16): success may not come from weakening the verification. Each check
 * becomes a finding with its evidence (the file and the added line), so the reviewer and the owner see it:
 *   critical — a protected acceptance test changed or deleted, an agent-control file (.codex/, .claude/, .mcp.json,
 *              AGENTS.md, CLAUDE.md, the test-project marker) created or changed;
 *   high     — a test file deleted, a skip/only/todo added, a secret-like file created or changed;
 *   medium   — an existing test file modified (allowed, but reviewed separately), an empty catch, a lint/type check disabled.
 * Heuristics on added lines only; nothing is executed.
 */
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|todo|only)\s*\(|\bx(?:it|describe)\s*\(|[{,]\s*(?:skip|todo)\s*:\s*(?:true|['"`])|\bt\.skip\s*\(/;
const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const DISABLE_RE = /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|istanbul ignore/;
// Standard-library names a Python test run imports (M08 review): a top-level module or package with one of these names shadows it.
const STDLIB_SHADOW = new Set(["unittest", "ast", "importlib", "io", "pathlib", "os", "re", "json", "types", "typing", "inspect", "traceback", "functools", "collections", "contextlib", "datetime", "zoneinfo", "time", "site", "sitecustomize", "usercustomize", "encodings", "codecs", "abc", "enum", "warnings", "argparse", "fnmatch", "difflib", "pprint", "signal", "weakref", "copy", "operator", "itertools", "keyword", "linecache", "tokenize", "token", "textwrap", "string", "stat", "posixpath", "genericpath", "ntpath", "locale", "struct", "math", "random"]);

export function integrityFindings({ changes, added = [], protectedRefs = [] }) {
  const findings = [];
  const add = (severity, code, file, observation, evidence) => findings.push({ severity, code, file, area: "integritate", observation, evidence,
    impact: severity === "critical" ? "Verificarea nu mai poate fi considerată independentă" : "Poate ascunde un defect sau o regresie" });
  const protectedSet = new Set(protectedRefs.map((p) => p.toLowerCase()));
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
    if (protectedSet.has(lower)) add("critical", "protected_test_changed", change.path, `Testul de acceptanță protejat a fost ${change.status === "deleted" ? "șters" : "modificat"} de writer`, `${change.status} ${change.path}`);
    else if (change.controlFile) add("critical", "control_file_changed", change.path, "Writer-ul a creat sau a modificat un fișier care controlează agenții sau Hub-ul", `${change.status} ${change.path}`);
    else if (change.secretLike) add("high", "secret_like_changed", change.path, "Un fișier cu nume de secret a fost creat sau modificat (conținutul nu e citit de Hub)", `${change.status} ${change.path}`);
    else if (change.testFile && change.status === "deleted") add("high", "test_deleted", change.path, "Un fișier de test a fost șters", `deleted ${change.path}`);
    else if (change.testFile && change.status === "modified") add("medium", "test_modified", change.path, "Un test existent a fost modificat; cere review separat", `modified ${change.path}`);
  }
  for (const { path, line } of added) {
    const text = line.trim().slice(0, 200);
    if (SKIP_RE.test(line)) add("high", "skip_added", path, "A fost adăugat un test sărit / exclusiv (skip, only, todo)", text);
    else if (EMPTY_CATCH_RE.test(line)) add("medium", "empty_catch", path, "A fost adăugat un catch gol (eroarea ar fi înghițită)", text);
    else if (DISABLE_RE.test(line)) add("medium", "check_disabled", path, "A fost dezactivată o regulă de lint sau de tipuri", text);
  }
  // One finding per (code, file): repeated lines in the same file add no information.
  const seen = new Set();
  return findings.filter((f) => { const key = `${f.code}:${f.file}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export const isBlockingIntegrity = (finding) => finding.severity === "critical";
