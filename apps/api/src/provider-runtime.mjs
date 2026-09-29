import path from "node:path";
import { spawn } from "node:child_process";
import { startOpenClawProvider } from "./openclaw-provider.mjs";

const home = process.env.USERPROFILE || "";
const codexBinary = process.env.HUB_CODEX_BINARY || path.join(home, "AppData", "Local", "OpenAI", "Codex", "bin", "faa963e871dd422c", "codex.exe");
const claudeBinary = process.env.HUB_CLAUDE_BINARY || path.join(home, "AppData", "Roaming", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");

export function classifyProviderError(value = "") {
  const text = String(value);
  if (/rate.?limit|usage.?limit|quota|too many requests|credit limit/i.test(text)) return "USAGE_LIMIT";
  if (/not authenticated|login required|unauthori[sz]ed|invalid api key|oauth.*expired|failed to authenticate|http\s*401|api error:\s*401/i.test(text)) return "AUTH_ERROR";
  if (/permission|approval required|access denied/i.test(text)) return "PERMISSION_DENIED";
  if (/timed? out|timeout/i.test(text)) return "TIMEOUT";
  if (/enoent|not found|unavailable|connection refused/i.test(text)) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

export function shouldFallback({ category, handoffCount = 0, cancelled = false, maxHandoffs = 2 }) {
  return !cancelled && handoffCount < maxHandoffs && ["USAGE_LIMIT", "PROVIDER_UNAVAILABLE"].includes(category);
}

function readLines(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) onLine(line);
    }
  });
  stream.on("end", () => { if (buffer.trim()) onLine(buffer.trim()); });
}

function startChild(binary, args, cwd) {
  const env = { ...process.env, CI: "1" };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  return spawn(binary, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}

function closeResult(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    child.once("error", (error) => finish({ code: -1, error: error.message }));
    child.once("close", (code) => finish({ code, error: "" }));
  });
}

export function startClaude({ cwd, prompt, sessionId = "", model = "sonnet", reasoning = "medium", onEvent = () => {} }) {
  const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
    "--permission-mode", "acceptEdits", "--tools", "Read,Edit,Write,Glob,Grep,Bash",
    "--allowedTools", "Bash(npm test)", "Bash(npm run build)", "Bash(git status --short --branch)",
    "--model", model, "--effort", reasoning];
  if (sessionId) args.push("--resume", sessionId);
  args.push(prompt);
  const child = startChild(claudeBinary, args, cwd);
  let output = "";
  let nativeSessionId = sessionId;
  let errorOutput = "";
  let reportedError = "";
  let usage = { status: "unknown" };
  readLines(child.stdout, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.session_id) nativeSessionId = event.session_id;
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && typeof block.name === "string") {
          onEvent({ type: "activity", label: `Claude tool: ${block.name.slice(0, 60)}` });
        }
      }
    }
    if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
      const text = event.event.delta.text || "";
      output += text;
      onEvent({ type: "delta", text });
    }
    if (event.type === "result") {
      if (!output && typeof event.result === "string") { output = event.result; onEvent({ type: "delta", text: output }); }
      if (event.usage) usage = { status: "reported", ...event.usage };
      if (event.is_error) reportedError = event.result || "Claude run failed";
    }
  });
  readLines(child.stderr, (line) => { errorOutput = `${errorOutput}\n${line}`.slice(-12000); });
  const done = closeResult(child).then(({ code, error }) => {
    const failure = reportedError || error || (code === 0 ? "" : errorOutput.trim() || `Claude exited ${code}`);
    return { status: failure ? "failed" : "completed", output, nativeSessionId, usage,
      error: failure, errorCategory: failure ? classifyProviderError(failure) : "" };
  });
  return { pid: child.pid || 0, done, stop: async () => { if (child.exitCode === null) child.kill(); await done; return child.exitCode !== null; } };
}

export function startCodex({ cwd, prompt, sessionId = "", model = "gpt-6-sol", reasoning = "medium", onEvent = () => {} }) {
  const child = startChild(codexBinary, ["app-server", "--stdio"], cwd);
  let nextId = 1;
  let nativeSessionId = sessionId;
  let turnId = "";
  let output = "";
  let errorOutput = "";
  let usage = { status: "unknown" };
  let completed;
  const turnDone = new Promise((resolve) => { completed = resolve; });
  const pending = new Map();
  const request = (method, params, timeout = 30000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  readLines(child.stdout, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.id != null && pending.has(event.id)) {
      const item = pending.get(event.id);
      pending.delete(event.id);
      clearTimeout(item.timer);
      if (event.error) item.reject(new Error(event.error.message || "Codex RPC error"));
      else item.resolve(event.result);
      return;
    }
    if (event.id != null && event.method) {
      child.stdin.write(`${JSON.stringify({ id: event.id, error: { code: -32000, message: "Hub approval required" } })}\n`);
      onEvent({ type: "approval", method: event.method });
      return;
    }
    const params = event.params || {};
    if (event.method === "item/started" && typeof params.item?.type === "string") {
      const kind = params.item.type;
      if (["commandExecution", "fileChange", "mcpToolCall", "webSearch"].includes(kind)) {
        onEvent({ type: "activity", label: `Codex: ${kind}` });
      }
    }
    if (event.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      output += params.delta;
      onEvent({ type: "delta", text: params.delta });
    }
    if (event.method === "thread/tokenUsage/updated" && params.tokenUsage) usage = { status: "reported", ...params.tokenUsage };
    if (event.method === "turn/completed") {
      const status = params.turn?.status === "completed" ? "completed" : "failed";
      const error = status === "failed" ? JSON.stringify(params.turn?.error || params.turn?.status || "Turn failed") : "";
      completed({ status, output, nativeSessionId, usage, error, errorCategory: error ? classifyProviderError(error) : "" });
    }
  });
  readLines(child.stderr, (line) => { errorOutput = `${errorOutput}\n${line}`.slice(-12000); });
  const closed = closeResult(child);
  closed.then(({ code, error }) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(error || errorOutput.trim() || `Codex exited ${code}`));
    }
    pending.clear();
  });
  const done = (async () => {
    try {
      await request("initialize", { clientInfo: { name: "ifrim-agent-hub", title: "Ifrim Agent Hub", version: "0.2.0" }, capabilities: {} });
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      const thread = sessionId ? await request("thread/resume", { threadId: sessionId, cwd, sandbox: "workspace-write" }).catch(() => null) : null;
      const started = thread || await request("thread/start", { cwd, sandbox: "workspace-write", approvalPolicy: "on-request", model });
      nativeSessionId = started.thread?.id || nativeSessionId;
      if (!nativeSessionId) throw new Error("Codex did not return a thread ID");
      const turn = await request("turn/start", { threadId: nativeSessionId, input: [{ type: "text", text: prompt }], cwd,
        approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false,
          excludeTmpdirEnvVar: false, excludeSlashTmp: false }, model, effort: reasoning });
      turnId = turn.turn?.id || "";
      return await Promise.race([turnDone, closed.then(({ code, error }) => ({ status: "failed", output, nativeSessionId, usage,
        error: error || errorOutput.trim() || `Codex exited ${code}`, errorCategory: classifyProviderError(error || errorOutput) }))]);
    } catch (error) {
      return { status: "failed", output, nativeSessionId, usage, error: error.message, errorCategory: classifyProviderError(error.message) };
    } finally {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Codex session closed")); }
      pending.clear();
      if (child.exitCode === null) child.kill();
      await closed;
    }
  })();
  return { pid: child.pid || 0, done, stop: async () => {
    if (turnId && nativeSessionId) await request("turn/interrupt", { threadId: nativeSessionId, turnId }, 5000).catch(() => {});
    if (child.exitCode === null) child.kill();
    await closed;
    return child.exitCode !== null;
  } };
}

export function startProvider(provider, options) {
  if (["claude", "codex"].includes(provider)) return startOpenClawProvider({ ...options, provider });
  throw new Error(`Unsupported provider: ${provider}`);
}
