// New, bounded cleanup fixture. Existing fake-turn.mjs is deliberately untouched.
const life = Math.min(30000, Math.max(100, Number(process.argv.find((a) => a.startsWith("--life="))?.slice(7)) || 12000));
process.argv = process.argv.filter((a) => !a.startsWith("--life="));
if (!process.argv.includes("-p") && !process.argv.includes("--blocker")) await import("./fake-claude.mjs");
else {
  const out = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  process.stdin.resume();
  const timer = setInterval(() => {
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "." } } });
    process.stderr.write("bounded cleanup fixture\n");
  }, 50);
  setTimeout(() => { clearInterval(timer); process.exit(0); }, life);
  out({ type: "system", subtype: "init", model: "claude-sonnet-fake", apiKeySource: "none", tools: [], mcp_servers: [] });
}
