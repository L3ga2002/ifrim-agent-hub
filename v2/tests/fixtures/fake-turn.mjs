// R-TURN: real fixture process, normal Claude adapter; existing fixtures remain byte-identical.
const arg = process.argv.find((s) => s.startsWith("--turn-scenario="));
const scenario = arg?.slice("--turn-scenario=".length) || "hang";
process.argv = process.argv.filter((s) => s !== arg);
if (!process.argv.includes("-p")) await import("./fake-claude.mjs");
else {
  const out = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  process.stdin.resume();
  process.stdin.on("end", () => {
    if (scenario === "admission") { setInterval(() => {}, 1000); return; }
    if (scenario === "authentication") {
      out({ type: "result", is_error: true, result: "Not logged in · Please run /login" });
      return;
    }
    out({ type: "system", subtype: "init", model: "claude-sonnet-fake", apiKeySource: "none", tools: [], mcp_servers: [] });
    if (scenario === "output_token_limit") {
      out({ type: "result", is_error: true, result: "API Error: Claude's response exceeded the 64000 output token maximum." });
      return;
    }
    let attempt = 0;
    const timer = setInterval(() => {
      attempt += 1;
      out({ type: "system", subtype: "api_retry", attempt, max_retries: 10, error: "Request timed out" });
      out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "." } } });
      if (scenario === "transport" && attempt === 3) {
        clearInterval(timer);
        out({ type: "result", is_error: true, result: "Request timed out" });
      }
    }, 160);
  });
}
