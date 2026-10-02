import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";

/**
 * WebAuthn relying-party checks for the owner's trusted session (M06 §07). The browser and the OS run the ceremony
 * (Windows Hello, a security key); the Hub only verifies what came back: the challenge it issued, the origin, the RP ID
 * hash, the user-presence and user-verification flags and the signature with the public key registered earlier.
 * No flag sent by JavaScript counts as authentication. Attestation is requested as "none": the Hub does not claim to know
 * the authenticator's make or certification, only that the same key signs again.
 *
 * Supported keys: ES256 (-7), RS256 (-257), EdDSA (-8). Pure functions; no storage here.
 */
export const COSE_ALGS = Object.freeze({ ES256: -7, RS256: -257, EDDSA: -8 });
const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

export const b64url = {
  encode: (buf) => Buffer.from(buf).toString("base64url"),
  decode(text, label = "valoare") {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(text) || text.length > 65536) throw new HubError("validation", `${label}: base64url invalid`);
    return Buffer.from(text.replace(/=+$/, ""), "base64url");
  },
};

// ---------- CBOR (definite lengths only, as WebAuthn/CTAP2 requires) ----------
export function cborDecode(buffer, start = 0, depth = 0) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (depth > 16) throw new HubError("validation", "CBOR prea adânc");
  let offset = start;
  const need = (n) => { if (offset + n > buf.length) throw new HubError("validation", "CBOR trunchiat"); };
  need(1);
  const initial = buf[offset++];
  const major = initial >> 5;
  const info = initial & 0x1f;
  const readLength = () => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[offset++]; }
    if (info === 25) { need(2); const v = buf.readUInt16BE(offset); offset += 2; return v; }
    if (info === 26) { need(4); const v = buf.readUInt32BE(offset); offset += 4; return v; }
    if (info === 27) { need(8); const v = buf.readBigUInt64BE(offset); offset += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new HubError("validation", "CBOR: întreg prea mare"); return Number(v); }
    throw new HubError("validation", "CBOR: lungimi nedefinite nu sunt acceptate");
  };
  if (major === 0) return { value: readLength(), offset };
  if (major === 1) return { value: -1 - readLength(), offset };
  if (major === 2 || major === 3) {
    const len = readLength(); need(len);
    const bytes = buf.subarray(offset, offset + len); offset += len;
    return { value: major === 2 ? Buffer.from(bytes) : bytes.toString("utf8"), offset };
  }
  if (major === 4) {
    const len = readLength();
    if (len > 1024) throw new HubError("validation", "CBOR: listă prea mare");
    const out = [];
    for (let i = 0; i < len; i += 1) { const item = cborDecode(buf, offset, depth + 1); out.push(item.value); offset = item.offset; }
    return { value: out, offset };
  }
  if (major === 5) {
    const len = readLength();
    if (len > 256) throw new HubError("validation", "CBOR: dicționar prea mare");
    const out = new Map();
    for (let i = 0; i < len; i += 1) {
      const key = cborDecode(buf, offset, depth + 1); offset = key.offset;
      const value = cborDecode(buf, offset, depth + 1); offset = value.offset;
      if (out.has(key.value)) throw new HubError("validation", "CBOR: cheie duplicată");
      out.set(key.value, value.value);
    }
    return { value: out, offset };
  }
  if (major === 7) {
    if (info === 20) return { value: false, offset };
    if (info === 21) return { value: true, offset };
    if (info === 22) return { value: null, offset };
    if (info === 23) return { value: undefined, offset };
    if (info === 25) { need(2); const v = halfToFloat(buf.readUInt16BE(offset)); offset += 2; return { value: v, offset }; }
    if (info === 26) { need(4); const v = buf.readFloatBE(offset); offset += 4; return { value: v, offset }; }
    if (info === 27) { need(8); const v = buf.readDoubleBE(offset); offset += 8; return { value: v, offset }; }
  }
  throw new HubError("validation", `CBOR: tip nesuportat (${major}/${info})`);
}

function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Minimal canonical CBOR encoder (used by the test authenticator; the Hub itself only decodes). */
export function cborEncode(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === "string") { const b = Buffer.from(value, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cborEncode)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value.entries()].flatMap(([k, v]) => [cborEncode(k), cborEncode(v)])]);
  if (value && typeof value === "object") return cborEncode(new Map(Object.entries(value)));
  if (value === true) return Buffer.from([0xf5]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  throw new Error(`cborEncode: unsupported ${typeof value}`);
}

// ---------- COSE keys ----------
/** COSE_Key → { jwk, alg } for the supported algorithms; anything else is refused. */
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new HubError("validation", "Cheia publică nu este un COSE_Key");
  const kty = cose.get(1); const alg = cose.get(3);
  if (kty === 2 && alg === COSE_ALGS.ES256) {
    const crv = cose.get(-1); const x = cose.get(-2); const y = cose.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new HubError("validation", "Cheie EC P-256 invalidă");
    return { alg, jwk: { kty: "EC", crv: "P-256", x: b64url.encode(x), y: b64url.encode(y) } };
  }
  if (kty === 3 && alg === COSE_ALGS.RS256) {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) throw new HubError("validation", "Cheie RSA invalidă (minimum 2048 de biți)");
    return { alg, jwk: { kty: "RSA", n: b64url.encode(n), e: b64url.encode(e) } };
  }
  if (kty === 1 && alg === COSE_ALGS.EDDSA) {
    const crv = cose.get(-1); const x = cose.get(-2);
    if (crv !== 6 || !Buffer.isBuffer(x) || x.length !== 32) throw new HubError("validation", "Cheie Ed25519 invalidă");
    return { alg, jwk: { kty: "OKP", crv: "Ed25519", x: b64url.encode(x) } };
  }
  throw new HubError("validation", `Algoritm de cheie nesuportat (kty ${kty}, alg ${alg})`);
}

export function verifySignature({ jwk, alg }, data, signature) {
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  if (alg === COSE_ALGS.ES256) return crypto.verify("sha256", data, { key, dsaEncoding: "der" }, signature);
  if (alg === COSE_ALGS.RS256) return crypto.verify("sha256", data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  if (alg === COSE_ALGS.EDDSA) return crypto.verify(null, data, key, signature);
  return false;
}

// ---------- authenticator data ----------
export function parseAuthData(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) throw new HubError("validation", "authenticatorData prea scurt");
  const flags = buf[32];
  const out = { rpIdHash: buf.subarray(0, 32), flags, signCount: buf.readUInt32BE(33),
    up: Boolean(flags & FLAG.UP), uv: Boolean(flags & FLAG.UV), be: Boolean(flags & FLAG.BE), bs: Boolean(flags & FLAG.BS), at: Boolean(flags & FLAG.AT), ed: Boolean(flags & FLAG.ED) };
  let offset = 37;
  if (out.at) {
    if (buf.length < offset + 18) throw new HubError("validation", "Date de credențial trunchiate");
    out.aaguid = buf.subarray(offset, offset + 16).toString("hex"); offset += 16;
    const len = buf.readUInt16BE(offset); offset += 2;
    if (len < 16 || len > 1023 || buf.length < offset + len) throw new HubError("validation", "ID de credențial invalid");
    out.credentialId = Buffer.from(buf.subarray(offset, offset + len)); offset += len;
    const key = cborDecode(buf, offset);
    out.credentialPublicKey = key.value; offset = key.offset;
  }
  if (out.ed) { const ext = cborDecode(buf, offset); offset = ext.offset; }
  if (offset !== buf.length) throw new HubError("validation", "authenticatorData are octeți în plus");
  return out;
}

function checkClientData(clientDataJSON, { type, challenge, origin }) {
  let data;
  try { data = JSON.parse(clientDataJSON.toString("utf8")); } catch { throw new HubError("validation", "clientDataJSON invalid"); }
  if (data.type !== type) throw new HubError("policy", `Tip de ceremonie greșit (${String(data.type).slice(0, 30)})`);
  if (data.challenge !== challenge) throw new HubError("policy", "Provocarea nu corespunde (veche, refolosită sau din altă sesiune)");
  if (data.origin !== origin) throw new HubError("policy", `Origin neașteptat: ${String(data.origin).slice(0, 80)}`);
  if (data.crossOrigin === true) throw new HubError("policy", "Ceremonie dintr-un cadru cross-origin");
  return data;
}

const rpHash = (rpId) => crypto.createHash("sha256").update(rpId).digest();

/**
 * Verifies a registration (navigator.credentials.create) against the issued challenge. User verification is required:
 * the credential must have been created after the OS checked the person (PIN, fingerprint, face), not only a touch.
 */
export function verifyRegistration(credential, { challenge, origin, rpId, requireUserVerification = true }) {
  if (!credential || credential.type !== "public-key") throw new HubError("validation", "Credențial lipsă");
  const rawId = b64url.decode(credential.rawId || credential.id, "rawId");
  const clientDataJSON = b64url.decode(credential.response?.clientDataJSON, "clientDataJSON");
  const attestationObject = b64url.decode(credential.response?.attestationObject, "attestationObject");
  checkClientData(clientDataJSON, { type: "webauthn.create", challenge, origin });
  const att = cborDecode(attestationObject);
  if (att.offset !== attestationObject.length || !(att.value instanceof Map)) throw new HubError("validation", "attestationObject invalid");
  const fmt = att.value.get("fmt"); const authDataBuf = att.value.get("authData"); const attStmt = att.value.get("attStmt");
  if (typeof fmt !== "string" || !Buffer.isBuffer(authDataBuf)) throw new HubError("validation", "attestationObject incomplet");
  const authData = parseAuthData(authDataBuf);
  if (!authData.rpIdHash.equals(rpHash(rpId))) throw new HubError("policy", "Credențialul este pentru alt RP ID");
  if (!authData.up) throw new HubError("policy", "Fără prezența utilizatorului (UP)");
  if (requireUserVerification && !authData.uv) throw new HubError("policy", "Autentificatorul nu a verificat persoana (UV): folosește Windows Hello / PIN / amprentă");
  if (!authData.at || !authData.credentialId) throw new HubError("validation", "Lipsesc datele credențialului");
  if (!authData.credentialId.equals(rawId)) throw new HubError("policy", "ID-ul credențialului nu corespunde");
  const key = coseToJwk(authData.credentialPublicKey);
  // "packed" self-attestation (no certificate) is checked with the credential key; other formats are recorded, not trusted.
  let attestation = { fmt, verified: fmt === "none" ? "none-requested" : "not-evaluated" };
  if (fmt === "packed" && attStmt instanceof Map && !attStmt.has("x5c")) {
    const sig = attStmt.get("sig");
    const data = Buffer.concat([authDataBuf, crypto.createHash("sha256").update(clientDataJSON).digest()]);
    if (!Buffer.isBuffer(sig) || attStmt.get("alg") !== key.alg || !verifySignature(key, data, sig)) throw new HubError("policy", "Auto-atestarea „packed” nu se verifică");
    attestation = { fmt, verified: "self" };
  }
  return { credentialId: b64url.encode(rawId), publicKey: key.jwk, alg: key.alg, signCount: authData.signCount, aaguid: authData.aaguid,
    userVerified: authData.uv, backupEligible: authData.be, backedUp: authData.bs, attestation,
    transports: Array.isArray(credential.response?.transports) ? credential.response.transports.filter((t) => typeof t === "string").slice(0, 6) : [] };
}

/**
 * Verifies an assertion (navigator.credentials.get) with the stored key. The signature covers authenticatorData and the
 * hash of clientDataJSON (which carries the challenge and origin): a replayed or rebuilt response fails here.
 */
export function verifyAssertion(credential, { challenge, origin, rpId, stored, requireUserVerification = true }) {
  if (!credential || credential.type !== "public-key") throw new HubError("validation", "Credențial lipsă");
  const rawId = b64url.decode(credential.rawId || credential.id, "rawId");
  if (b64url.encode(rawId) !== stored.id) throw new HubError("policy", "Credențial necunoscut");
  const clientDataJSON = b64url.decode(credential.response?.clientDataJSON, "clientDataJSON");
  const authDataBuf = b64url.decode(credential.response?.authenticatorData, "authenticatorData");
  const signature = b64url.decode(credential.response?.signature, "signature");
  checkClientData(clientDataJSON, { type: "webauthn.get", challenge, origin });
  const authData = parseAuthData(authDataBuf);
  if (!authData.rpIdHash.equals(rpHash(rpId))) throw new HubError("policy", "Aserțiune pentru alt RP ID");
  if (!authData.up) throw new HubError("policy", "Fără prezența utilizatorului (UP)");
  if (requireUserVerification && !authData.uv) throw new HubError("policy", "Autentificatorul nu a verificat persoana (UV)");
  const data = Buffer.concat([authDataBuf, crypto.createHash("sha256").update(clientDataJSON).digest()]);
  if (!verifySignature({ jwk: stored.publicKey, alg: stored.alg }, data, signature)) throw new HubError("policy", "Semnătura nu se verifică");
  // A counter that does not grow (when the authenticator keeps one) may mean a cloned key: refused, never ignored.
  if ((authData.signCount > 0 || stored.signCount > 0) && authData.signCount <= stored.signCount) throw new HubError("policy", "Contorul autentificatorului nu a crescut (posibilă clonare); credențialul trebuie verificat");
  return { signCount: authData.signCount, userVerified: authData.uv };
}

/**
 * A software authenticator for TESTS ONLY (PASS_SIMULATED): it produces real signatures with a key held in memory, so the
 * verifier code paths are exercised end to end. It is never used by the Hub and proves nothing about Windows Hello.
 */
export function createTestAuthenticator({ rpId = "localhost", origin = "http://localhost:8011", alg = COSE_ALGS.ES256, userVerified = true, signCountStart = 0 } = {}) {
  const { publicKey, privateKey } = alg === COSE_ALGS.RS256
    ? crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
    : alg === COSE_ALGS.EDDSA ? crypto.generateKeyPairSync("ed25519") : crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = crypto.randomBytes(32);
  let counter = signCountStart;
  const cose = alg === COSE_ALGS.RS256 ? new Map([[1, 3], [3, alg], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]])
    : alg === COSE_ALGS.EDDSA ? new Map([[1, 1], [3, alg], [-1, 6], [-2, Buffer.from(jwk.x, "base64url")]])
      : new Map([[1, 2], [3, alg], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  const flagsOf = (extra) => FLAG.UP | (userVerified ? FLAG.UV : 0) | extra;
  const counterBuf = () => { const b = Buffer.alloc(4); b.writeUInt32BE(counter >>> 0); return b; };
  const sign = (data) => (alg === COSE_ALGS.EDDSA ? crypto.sign(null, data, privateKey)
    : alg === COSE_ALGS.RS256 ? crypto.sign("sha256", data, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }) : crypto.sign("sha256", data, privateKey));
  return {
    credentialId: b64url.encode(credentialId),
    create({ challenge, originOverride, rpIdOverride, type = "webauthn.create" }) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin: originOverride || origin, crossOrigin: false }));
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([rpHash(rpIdOverride || rpId), Buffer.from([flagsOf(FLAG.AT)]), counterBuf(), Buffer.alloc(16), idLen, credentialId, cborEncode(cose)]);
      const attestationObject = cborEncode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: b64url.encode(credentialId), rawId: b64url.encode(credentialId), type: "public-key",
        response: { clientDataJSON: b64url.encode(clientDataJSON), attestationObject: b64url.encode(attestationObject), transports: ["internal"] } };
    },
    get({ challenge, originOverride, rpIdOverride, type = "webauthn.get", bumpCounter = true }) {
      if (bumpCounter && signCountStart > 0) counter += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin: originOverride || origin, crossOrigin: false }));
      const authData = Buffer.concat([rpHash(rpIdOverride || rpId), Buffer.from([flagsOf(0)]), counterBuf()]);
      const signature = sign(Buffer.concat([authData, crypto.createHash("sha256").update(clientDataJSON).digest()]));
      return { id: b64url.encode(credentialId), rawId: b64url.encode(credentialId), type: "public-key",
        response: { clientDataJSON: b64url.encode(clientDataJSON), authenticatorData: b64url.encode(authData), signature: b64url.encode(signature), userHandle: null } };
    },
  };
}
