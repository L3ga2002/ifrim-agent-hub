const methods = new Set(["sessions.create", "agent"]);
const codexMethods = new Set(["initialize", "account/login/start", "account/read", "model/list"]);
const phases = new Set(["received", "handler", "response", "dispatch"]);
const outcomes = new Set(["returned", "threw", "ok", "error", "rejected", "unavailable", "cancelled", "delivery-failed", "delivery-error"]);

export function gatewayRpcRecord(event) {
  if (!event || event.type !== "gateway.rpc" || !methods.has(event.method) || !phases.has(event.phase)) return null;
  const record = { method: event.method, phase: event.phase };
  if (outcomes.has(event.outcome)) record.outcome = event.outcome;
  for (const key of ["durationMs", "admissionMs", "queueWaitMs", "ts", "seq"]) {
    if (Number.isFinite(event[key]) && event[key] >= 0) record[key] = event[key];
  }
  if (["none", "sent", "not-sent"].includes(event.response)) record.response = event.response;
  if (typeof event.trace?.traceId === "string" && /^[a-f0-9]{32}$/.test(event.trace.traceId)) record.traceId = event.trace.traceId;
  return record;
}

export function installGatewayRpcDiagnostics(subscribe, writeLine, { ceiling = 2000 } = {}) {
  let written = 0;
  let writable = true;
  return subscribe((event) => {
    if (!writable || written >= ceiling) return;
    try {
      const record = gatewayRpcRecord(event);
      if (!record) return;
      const line = JSON.stringify({ hubRpcTrace: record }) + "\n";
      if (line.length > 1024) return;
      written += 1;
      // A blocked or failed private sink must never slow or throw into native RPC handling.
      const result = writeLine(line);
      if (result === false || (Number.isFinite(result) && result < Buffer.byteLength(line))) writable = false;
    } catch { writable = false; }
  }, { include: ["gateway.rpc"] });
}

// Observe existing stream operations without starting or changing stdout consumption.
export function installCodexTransportDiagnostics(childProcess, executable, writeLine, { ceiling = 2000, frameLimit = 65536 } = {}) {
  const spawn = childProcess.spawn;
  let enabled = true;
  let written = 0;
  const emit = (record) => {
    if (!enabled || written >= ceiling) return;
    try {
      const line = JSON.stringify({ hubCodexTransport: record }) + "\n";
      written++;
      const result = writeLine(line);
      if (result === false || (Number.isFinite(result) && result < Buffer.byteLength(line))) enabled = false;
    } catch { enabled = false; }
  };
  const parser = (consume) => {
    let pending = Buffer.alloc(0);
    let dropping = false;
    const consumeBytes = (bytes) => {
        let offset = 0;
        while (offset < bytes.length) {
          const newline = bytes.indexOf(10, offset);
          const end = newline < 0 ? bytes.length : newline;
          const fragment = bytes.subarray(offset, end);
          if (!dropping && pending.length + fragment.length > frameLimit) {
            pending = Buffer.alloc(0);
            dropping = true;
          }
          if (!dropping) pending = Buffer.concat([pending, fragment]);
          if (newline < 0) break;
          if (!dropping && pending.length) {
            try { consume(JSON.parse(pending.toString("utf8"))); } catch {}
          }
          pending = Buffer.alloc(0);
          dropping = false;
          offset = newline + 1;
        }
    };
    return (chunk, encoding = "utf8") => {
      if (!enabled || written >= ceiling) return;
      try {
        if (typeof chunk === "string") {
          if (!["utf8", "utf-8"].includes(encoding.toLowerCase())) {
            pending = Buffer.alloc(0); dropping = true; return;
          }
          for (let offset = 0; offset < chunk.length;) {
            let end = Math.min(chunk.length, offset + 4096);
            const last = chunk.charCodeAt(end - 1);
            if (end < chunk.length && last >= 0xd800 && last <= 0xdbff) end--;
            consumeBytes(Buffer.from(chunk.slice(offset, end), "utf8"));
            offset = end;
          }
        } else if (Buffer.isBuffer(chunk)) consumeBytes(chunk);
        else if (chunk instanceof Uint8Array) consumeBytes(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } catch { pending = Buffer.alloc(0); dropping = true; }
    };
  };
  childProcess.spawn = function (...args) {
    const child = spawn.apply(this, args);
    if (args[0] !== executable || !Array.isArray(args[1]) || !args[1].includes("app-server")) return child;
    try {
      if (!Number.isSafeInteger(child.pid) || !child.stdin || !child.stdout) return child;
      const pid = child.pid;
      const started = Date.now();
      const requests = new Map();
      const record = (extra) => emit({ pid, elapsedMs: Math.max(0, Date.now() - started), ...extra });
      const sent = parser((message) => {
        if (!Number.isSafeInteger(message?.id) || message.id < 0 || !codexMethods.has(message.method)) return;
        if (requests.size >= 64 && !requests.has(message.id)) return;
        requests.set(message.id, { method: message.method, started: Date.now() });
        record({ phase: "queued", method: message.method, id: message.id });
      });
      const received = parser((message) => {
        if (!Number.isSafeInteger(message?.id) || Object.hasOwn(message, "method")) return;
        const request = requests.get(message.id);
        if (!request) return;
        requests.delete(message.id);
        const extra = { phase: "response", method: request.method, id: message.id, durationMs: Math.max(0, Date.now() - request.started), outcome: Object.hasOwn(message, "error") ? "error" : "ok" };
        if (Number.isSafeInteger(message.error?.code)) extra.errorCode = message.error.code;
        record(extra);
      });
      const write = child.stdin.write;
      child.stdin.write = function (...writeArgs) {
        const result = write.apply(this, writeArgs);
        sent(writeArgs[0], typeof writeArgs[1] === "string" ? writeArgs[1] : "utf8");
        return result;
      };
      const stdoutEmit = child.stdout.emit;
      child.stdout.emit = function (...eventArgs) {
        const result = stdoutEmit.apply(this, eventArgs);
        if (eventArgs[0] === "data") received(eventArgs[1]);
        return result;
      };
      child.once("exit", (code) => {
        for (const [id, request] of requests) record({ phase: "unresolved-at-exit", id, method: request.method });
        requests.clear();
        record({ phase: "exit", ...(Number.isSafeInteger(code) ? { exitCode: code } : {}) });
      });
      record({ phase: "spawn" });
    } catch { /* Diagnostics never change native spawn behavior. */ }
    return child;
  };
  return () => { childProcess.spawn = spawn; enabled = false; };
}
