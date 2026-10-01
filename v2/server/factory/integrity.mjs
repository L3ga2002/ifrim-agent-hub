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

export function integrityFindings({ changes, added = [], protectedRefs = [] }) {
  const findings = [];
  const add = (severity, code, file, observation, evidence) => findings.push({ severity, code, file, area: "integritate", observation, evidence,
    impact: severity === "critical" ? "Verificarea nu mai poate fi considerată independentă" : "Poate ascunde un defect sau o regresie" });
  const protectedSet = new Set(protectedRefs.map((p) => p.toLowerCase()));
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
