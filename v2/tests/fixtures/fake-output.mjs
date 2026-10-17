// R-OUTPUT: log the actual controlled child environment; delegate ordinary scenarios to the existing fake CLIs.
import fs from "node:fs";
const opt = (key) => process.argv.find((a) => a.startsWith(`--output-${key}=`))?.split("=").slice(1).join("=");
const provider = opt("provider") || "claude", log = opt("log"), signal = opt("signal");
process.argv = process.argv.filter((a) => !a.startsWith("--output-"));
if (log) fs.appendFileSync(log, JSON.stringify({ provider, pid: process.pid, cwd: process.cwd(), args: process.argv.slice(2), env: process.env }) + "\n");
const scenario = provider === "claude" && process.argv.includes("-p") && signal && fs.existsSync(signal) ? fs.readFileSync(signal, "utf8").trim() : "";
if (!scenario) await import(provider === "claude" ? "./fake-claude.mjs" : "./fake-codex.mjs");
else {
  const out = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  process.stdin.resume();
  process.stdin.on("end", () => {
    out({ type: "system", subtype: "init", model: "claude-sonnet-fake", apiKeySource: "none", tools: [], mcp_servers: [] });
    if (scenario === "hang") { setInterval(() => {}, 1000); return; }
    out({ type: "assistant", message: { content: [{ type: "thinking", thinking: "Never a test" }], stop_reason: scenario === "empty" ? "end_turn" : "max_tokens", usage: { output_tokens: 32000 } } });
    out({ type: "result", is_error: scenario !== "empty", result: scenario === "empty" ? "" : "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable." });
  });
}
