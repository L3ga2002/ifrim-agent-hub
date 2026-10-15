import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexCliRegQuery } from "../server/providers/codex.mjs";

for (const type of ["REG_SZ", "REG_EXPAND_SZ"]) test(`Codex registry parser: ${type}, spaces and CRLF`, () => {
  const file = String.raw`C:\Program Files\Codex CLI\codex.exe`;
  assert.equal(parseCodexCliRegQuery(`\r\nHKEY_CURRENT_USER\\Environment\r\n    CODEX_CLI_PATH    ${type}    ${file}\r\n`), file);
});
test("Codex registry parser: absent, empty or unrelated value", () => {
  for (const stdout of ["", "ERROR: absent value", "    CODEX_CLI_PATH REG_SZ   \r\n", "    CODEX_CLI_PATH REG_SZ   \r\n    OTHER REG_SZ C:\\wrong.exe", "    OTHER_CODEX_CLI_PATH REG_SZ C:\\wrong.exe", "    CODEX_CLI_PATH REG_DWORD 42"])
    assert.equal(parseCodexCliRegQuery(stdout), null, stdout);
});
