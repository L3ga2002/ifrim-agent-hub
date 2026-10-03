// Owner session in the browser (M06 §07). The browser and the OS run the WebAuthn ceremony (Windows Hello, PIN, a security
// key); this code only carries the Hub's challenge to navigator.credentials and the answer back. Nothing here decides who
// you are: the Hub verifies the signature. The session itself lives in an HttpOnly cookie the page cannot read.
import { api } from "../api.js";

const toBuf = (b64url) => { const s = atob(String(b64url).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(b64url).length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer; };
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const webauthnAvailable = () => typeof window !== "undefined" && Boolean(window.PublicKeyCredential && navigator.credentials?.create);
/** WebAuthn needs a domain: on http://127.0.0.1 the owner must open http://localhost:<port> (the same Hub). */
export const localhostUrl = (port) => `http://localhost:${port}${window.location.pathname}${window.location.hash}`;
export const onLocalhost = () => window.location.hostname === "localhost";

function ceremonyError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError") return new Error("Ai anulat sau timpul a expirat în fereastra Windows Hello / a cheii; nimic nu s-a schimbat.");
  if (name === "InvalidStateError") return new Error("Acest autentificator este deja înregistrat.");
  if (name === "SecurityError") return new Error("Browserul refuză WebAuthn pe această adresă: deschide Hub-ul pe http://localhost.");
  return error;
}

/** Registers this computer's authenticator (bootstrap needs the exact setup text; later ones need a re-authenticated session). */
export async function registerAuthenticator({ setupText = "", label = "" } = {}) {
  const begin = await api("/api/owner/register/begin", { method: "POST", body: { setupText } });
  const pk = begin.publicKey;
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: { ...pk, challenge: toBuf(pk.challenge), user: { ...pk.user, id: toBuf(pk.user.id) },
      excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) } });
  } catch (error) { throw ceremonyError(error); }
  const credential = { id: cred.id, rawId: toB64(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: toB64(cred.response.clientDataJSON), attestationObject: toB64(cred.response.attestationObject), transports: cred.response.getTransports?.() || [] } };
  return api("/api/owner/register/finish", { method: "POST", body: { challengeId: begin.challengeId, credential, label } });
}

/** Opens (or re-authenticates) the owner session with a verified assertion. */
export async function unlockSession(purpose = "unlock") {
  const begin = await api("/api/owner/auth/begin", { method: "POST", body: { purpose } });
  const pk = begin.publicKey;
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: { ...pk, challenge: toBuf(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) } });
  } catch (error) { throw ceremonyError(error); }
  const credential = { id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64(cred.response.clientDataJSON), authenticatorData: toB64(cred.response.authenticatorData), signature: toB64(cred.response.signature), userHandle: cred.response.userHandle ? toB64(cred.response.userHandle) : null } };
  return api("/api/owner/auth/finish", { method: "POST", body: { challengeId: begin.challengeId, credential } });
}

export const lockSession = () => api("/api/owner/logout", { method: "POST", body: {} });

/** Runs `fn`; if the Hub asks for a fresh re-authentication, runs the ceremony once and retries. */
export async function withReauth(fn) {
  try { return await fn(); }
  catch (error) {
    // M08: the intel services phrase it "sesiunea ta de proprietar" / "în sesiunea ta (Windows Hello)": those ask for the unlock too.
    if (error?.category === "authentication" && (error.details?.reauth || error.details?.needSession || /confirmă din nou|sesiunea (ta )?de proprietar|sesiunea ta|Windows Hello/i.test(error.message))) {
      await unlockSession("reauth");
      return fn();
    }
    throw error;
  }
}
