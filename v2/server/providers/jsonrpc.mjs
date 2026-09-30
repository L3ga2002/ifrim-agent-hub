/**
 * JSON-RPC peer over newline-delimited JSON (Codex app-server stdio framing: `jsonrpc` field omitted).
 * Client requests are restricted to an allowlist so the Hub can never call a method that changes
 * accounts, consumes credits or edits global config, even through a bug elsewhere.
 */
export function createJsonRpcPeer({ write, allowedMethods, onNotification = () => {}, onServerRequest = async () => ({ error: { code: -32601, message: "Not supported by Ifrim Agent Hub" } }), onProtocolError = () => {} }) {
  let nextId = 1;
  let closed = null; // set by failAll(): the peer is gone, new requests fail at once instead of waiting for a timeout
  const pending = new Map();

  function request(method, params = {}, timeoutMs = 30000) {
    if (!allowedMethods.has(method)) return Promise.reject(Object.assign(new Error(`Method ${method} is not allowed by Hub policy`), { category: "policy" }));
    if (closed) return Promise.reject(Object.assign(new Error(`${method}: ${closed.message}`), { category: "transport", method }));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`${method} timed out after ${timeoutMs} ms`), { category: "transport", method, timeout: true }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      write(JSON.stringify({ id, method, params }));
    });
  }

  function notify(method, params = {}) {
    write(JSON.stringify({ method, params }));
  }

  async function handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { onProtocolError({ kind: "unparsable", length: line.length }); return; }
    if (message.id !== undefined && message.id !== null && !message.method) {
      const entry = pending.get(message.id);
      if (!entry) { onProtocolError({ kind: "unknown-response", id: message.id }); return; }
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message || "RPC error"), { rpcError: message.error, method: entry.method }));
      else entry.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined && message.id !== null) {
      let reply;
      try { reply = await onServerRequest(message.method, message.params || {}, message.id); }
      catch (error) { reply = { error: { code: -32000, message: error.message } }; }
      write(JSON.stringify(reply.error ? { id: message.id, error: reply.error } : { id: message.id, result: reply.result ?? {} }));
      return;
    }
    if (message.method) onNotification(message.method, message.params || {});
  }

  function failAll(error) {
    closed = error;
    for (const [id, entry] of pending) { clearTimeout(entry.timer); entry.reject(error); pending.delete(id); }
  }

  return { request, notify, handleLine, failAll, pendingCount: () => pending.size, isClosed: () => Boolean(closed) };
}
