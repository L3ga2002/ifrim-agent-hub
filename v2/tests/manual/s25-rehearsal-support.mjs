// Plain-node rehearsal support: no node:test import or cleanup hook. Software identity and billing fixtures only.
// Keep these four helpers aligned with tests/helpers.mjs; this module never constructs the ordinary test Hub.
import path from "node:path";
import net from "node:net";
import { HUB_ROOT } from "../../server/config.mjs";
import { ATTESTATION_TEXT } from "../../server/policy/billing.mjs";
import { buildDeclaration, applyDeclaration } from "../../server/policy/billing-evidence.mjs";
export { HUB_ROOT };
export const FIXTURES = path.join(HUB_ROOT, "v2", "tests", "fixtures");

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

export const waitFor = async (predicate, timeoutMs = 15000, stepMs = 50, { signal } = {}) => {
  const started = Date.now();
  let abort, deadlineTimer;
  const aborted = signal && new Promise((_, reject) => {
    abort = () => reject(signal.reason || new Error("waitFor aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  const deadline = signal && new Promise((_, reject) => { deadlineTimer = setTimeout(() => reject(new Error("waitFor timed out")), timeoutMs); });
  const race = (work) => aborted ? Promise.race([work, aborted, deadline]) : work;
  try {
  while (Date.now() - started < timeoutMs) {
    signal?.throwIfAborted();
    const value = await (signal ? race(Promise.resolve().then(predicate)) : predicate());
    if (value) return value;
    let timer;
    try { await race(new Promise((r) => { timer = setTimeout(r, stepMs); })); } finally { clearTimeout(timer); }
  }
  throw new Error("waitFor timed out");
  } finally { clearTimeout(deadlineTimer); if (abort) signal.removeEventListener("abort", abort); }
};

export async function enrolOwner(t, { activatePolicy = true } = {}) {
  const { createTestAuthenticator } = await import("../../server/owner/webauthn.mjs");
  const { OWNER_SETUP_TEXT, OWNER_POLICY_TEXT } = await import("../../server/owner/trust.mjs");
  const origin = `http://localhost:${t.config.port}`;
  const auth = createTestAuthenticator({ origin });
  const begin = t.hub.trust.beginRegistration({ origin, setupText: OWNER_SETUP_TEXT });
  t.hub.trust.finishRegistration({ origin, challengeId: begin.challengeId, credential: auth.create({ challenge: begin.publicKey.challenge }) });
  const a = t.hub.trust.beginAuthentication({ origin });
  const opened = t.hub.trust.finishAuthentication({ origin, challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }) });
  const session = t.hub.trust.resolveSession(opened.token, { origin });
  if (activatePolicy) await t.hub.commands.dispatch({ type: "owner.policy.activate", channel: "test", actor: "test", ownerSession: session, payload: { text: OWNER_POLICY_TEXT } });
  /** Re-authenticates the same session (fresh window) with the same authenticator. */
  const reauth = () => {
    const c = t.hub.trust.beginAuthentication({ origin, purpose: "reauth" });
    t.hub.trust.finishAuthentication({ origin, challengeId: c.challengeId, credential: auth.get({ challenge: c.publicKey.challenge }), currentToken: opened.token });
    return t.hub.trust.resolveSession(opened.token, { origin });
  };
  return { auth, session, token: opened.token, origin, reauth };
}

export function declareBillingFixture(hub, { providers = ["codex", "claude"], at = new Date() } = {}) {
  hub.bus.transaction(() => {
    let evidence = hub.settings.get("billingEvidence");
    for (const id of providers) {
      const identity = hub.providerState.get(id)?.auth?.accountIdentity || null;
      evidence = applyDeclaration(evidence, id, buildDeclaration({ id: `bde_fixture_${id}`, provider: id, text: ATTESTATION_TEXT[id], identity, now: at, source: "test:fixture",
        recordedBy: { channel: "test", actor: "test" } }));
    }
    hub.settings.set("billingEvidence", evidence, "test", "Fixture billing declarations");
  });
}

// Optional deterministic termination seam for single-process author fixtures. Never used by real mode.
export async function killSingleAuthorFixture(record) {
  if (record.label !== "claude -p" || record.child.spawnfile !== process.execPath ||
      !record.child.spawnargs.some((arg) => ["fake-turn.mjs", "fake-claude.mjs"].some((name) => arg === path.join(FIXTURES, name))))
    throw new Error("Only the known single-process author fixture may use fixture termination");
  if (!record.child.kill("SIGKILL")) throw new Error("Fixture handle termination refused");
  return { method: "fixture-owned-handle", simulatedTree: true };
}
