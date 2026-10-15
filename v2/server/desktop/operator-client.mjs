// M10 Desktop Operator client: starts the helper through the supervisor (stdin/stdout are the only channel: no port, no pipe another
// process could open), sends a per-start HMAC key in the first line, signs every request (nonce + timestamp + the Hub's authority
// with its expiry) and verifies every answer. A production helper starts only when its binary matches the manifest written by
// `node v2/scripts/build-operator.mjs` AND that manifest names the current source: an outdated or replaced binary is refused.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const OPERATOR_SOURCE = path.resolve(here, "..", "..", "desktop", "operator", "IfrimOperator.cs");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** The helper binary and its manifest agree with the current source: { ok, problem, manifest }. */
export function verifyOperatorBinary(exe, { source = OPERATOR_SOURCE } = {}) {
  const manifestFile = path.join(path.dirname(exe), "IfrimOperator.manifest.json");
  if (!fs.existsSync(exe)) return { ok: false, problem: "Helperul Desktop Operator nu e construit (node v2/scripts/build-operator.mjs)." };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch { return { ok: false, problem: "Manifestul helperului lipsește sau e invalid; reconstruiește-l." }; }
  if (sha256(fs.readFileSync(exe)) !== manifest.sha256) return { ok: false, problem: "Binarul helperului nu corespunde manifestului (înlocuit sau corupt); nu îl pornesc." };
  if (fs.existsSync(source) && sha256(fs.readFileSync(source)) !== manifest.sourceSha256) return { ok: false, problem: "Helperul a fost construit dintr-o sursă mai veche; reconstruiește-l." };
  return { ok: true, manifest };
}

export function createOperatorClient({ config, supervisor, clock = () => new Date(), onEvent = () => {}, requestTimeoutMs = 20000 }) {
  let record = null;
  let key = null;
  let ready = null;
  let helloInfo = null;
  let seq = 0;
  const pending = new Map();
  let lastError = null;

  function handleLine(line) {
    let env;
    try { env = JSON.parse(line); } catch { lastError = "helper: linie invalidă"; return; }
    if (typeof env.body !== "string" || typeof env.mac !== "string" || !key) return;
    const expected = crypto.createHmac("sha256", key).update(env.body, "utf8").digest("hex");
    if (expected.length !== env.mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(env.mac))) { lastError = "helper: răspuns cu semnătură invalidă (ignorat)"; onEvent({ type: "desktop.operator.bad_mac" }); return; }
    let body;
    try { body = JSON.parse(env.body); } catch { return; }
    if (body.op === "hello" && ready?.resolve) { helloInfo = body; ready.resolve(body); return; }
    const p = body.id ? pending.get(body.id) : null;
    if (!p) return;
    pending.delete(body.id);
    clearTimeout(p.timer);
    if (body.ok) p.resolve(body.result || {});
    else p.reject(new HubError(errorCategory(body.error?.code), body.error?.message || "Operația a eșuat", { code: body.error?.code || "FAILED" }));
  }

  /** Starts the helper (idempotent). Production: refuses a binary that does not match its manifest / the current source. */
  async function start({ session = "" } = {}) {
    if (record && !record.exited && helloInfo) return status();
    if (ready?.promise && record && !record.exited) return ready.promise.then(() => status());
    const launcher = config.desktop?.launcher;
    let executable, args = [];
    if (launcher) { executable = launcher.executable; args = launcher.prefixArgs || []; }
    else {
      if (process.platform !== "win32") throw new HubError("policy", "Desktop Operator funcționează doar pe Windows.", { code: "UNSUPPORTED_OS" });
      const check = verifyOperatorBinary(config.desktop.operatorExe);
      if (!check.ok) throw new HubError("policy", check.problem, { code: "OPERATOR_NOT_READY" });
      executable = config.desktop.operatorExe;
    }
    key = crypto.randomBytes(32);
    let resolveHello, rejectHello;
    const promise = new Promise((res, rej) => { resolveHello = res; rejectHello = rej; });
    ready = { promise, resolve: resolveHello, reject: rejectHello };
    record = supervisor.start({ key: "desktop-operator", executable, args, label: "desktop-operator", onStdoutLine: handleLine,
      onStderrLine: (l) => { lastError = l.slice(0, 300); } });
      const launched = record;
      launched.exit.then(({ code }) => {
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new HubError("tool", `Helperul s-a oprit (cod ${code}); operația nu are rezultat confirmat.`, { code: "OPERATOR_EXITED" })); pending.delete(id); }
      helloInfo = null;
      ready?.reject?.(new HubError("tool", `Helperul s-a oprit înainte de handshake (cod ${code}): ${lastError || ""}`, { code: "OPERATOR_EXITED" }));
        if (!launched.detached) onEvent({ type: "desktop.operator.exited", code });
    });
    record.child.stdin.write(`${JSON.stringify({ hello: { key: key.toString("hex"), session: String(session).slice(0, 80) } })}\n`);
    const timer = setTimeout(() => ready.reject(new HubError("tool", "Helperul nu a răspuns la handshake în 10 s.", { code: "OPERATOR_TIMEOUT" })), 10000);
    try { await promise; } finally { clearTimeout(timer); }
    onEvent({ type: "desktop.operator.started", pid: record.pid, version: helloInfo?.version });
    return status();
  }

  /**
   * One signed request. `auth`: { plan, step, apps: [processNames], exp } — the Hub's authority for THIS operation (the helper refuses
   * effectful operations without an unexpired one, and targets outside `apps`).
   */
  function request(op, args = {}, auth = null) {
    if (!record || record.exited || !helloInfo) return Promise.reject(new HubError("conflict", "Helperul Desktop Operator nu rulează.", { code: "OPERATOR_NOT_RUNNING" }));
    seq += 1;
    const id = `d${seq}_${crypto.randomBytes(3).toString("hex")}`;
    const body = JSON.stringify({ v: 1, id, op, args, auth, nonce: crypto.randomBytes(16).toString("hex"), ts: clock().toISOString() });
    const mac = crypto.createHmac("sha256", key).update(body, "utf8").digest("hex");
    return new Promise((resolve, reject) => {
      const timeout = Math.min(180000, (Number(args.timeoutMs) || 0) + requestTimeoutMs);
      const timer = setTimeout(() => { pending.delete(id); reject(new HubError("tool", `Operația ${op} nu a răspuns în ${Math.round(timeout / 1000)} s; rezultatul e incert.`, { code: "OPERATOR_TIMEOUT" })); }, timeout);
      pending.set(id, { resolve, reject, timer, op });
      try { record.child.stdin.write(`${JSON.stringify({ body, mac })}\n`); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(new HubError("tool", `Helperul nu poate primi comenzi: ${error.message}`, { code: "OPERATOR_PIPE" })); }
    });
  }

  /** Stop: answered by the helper ahead of queued work (input stops, keys released, paused until resume). */
  const stopInput = () => request("stop", {});
  const running = () => Boolean(record && !record.exited && helloInfo);
  function status() {
    return { running: running(), pid: running() ? record.pid : null, version: helloInfo?.version || null, startedAt: running() ? record.startedAt : null, lastError, pending: pending.size };
  }
  async function close() {
    if (!record || record.exited) return;
    try { await Promise.race([request("stop", {}), new Promise((r) => setTimeout(r, 1500))]); } catch { /* exiting anyway */ }
    await supervisor.stop("desktop-operator", { graceMs: 1500 });
  }
  return { start, request, stopInput, status, running, close };
}

function errorCategory(code) {
  if (["PROTECTED_TARGET", "SENSITIVE_CONTROL", "PROTECTED_FIELD", "OUT_OF_SCOPE", "NO_AUTHORITY", "AUTHORITY_EXPIRED"].includes(code)) return "policy";
  if (["BAD_MAC", "REPLAY", "STALE", "BAD_MESSAGE"].includes(code)) return "authentication";
  if (["WINDOW_GONE", "WINDOW_NOT_FOUND", "ELEMENT_NOT_FOUND", "NOT_FOUND", "STALE_REF"].includes(code)) return "not_found";
  if (["PAUSED", "USER_INPUT", "SECURE_DESKTOP", "NOT_FOREGROUND", "IDENTITY_CHANGED", "OCCLUDED", "STOPPED"].includes(code)) return "conflict";
  return "tool";
}
