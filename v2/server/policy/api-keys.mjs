import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

/**
 * 2.20 — the API-key vault of ONE Hub instance (the optional "pay with my own API key" route, off by default).
 *
 * Where: `<dataDir>/v2-api-keys/<provider>.json` (the data folder: outside the repository, never read by a Hub run — every Codex
 * and Claude run denies reads of the data folder; the "v2-" prefix makes it move with relocate-data). What: the key encrypted with
 * Windows DPAPI for the CURRENT Windows user (another account or another computer cannot decrypt it), plus non-secret facts: a
 * salted fingerprint (16 hex, the route's account identity), the last 4 characters and when it was set.
 *
 * The clear key exists only (a) in the body of the owner's one request that sets it, (b) in this process while a run or an
 * account check is being started (passed to the provider process: Claude through its environment, Codex through its stdin
 * JSON-RPC login with an in-memory credential store), never in the database, a log, an event, an HTTP answer or an argv.
 *
 * Test mode uses a reversible test protector (scheme "test-only"); a real Hub refuses to read a test-only file.
 */

export const API_KEY_PROVIDERS = Object.freeze(["codex", "claude"]);
export const API_KEY_DIR = "v2-api-keys";
const FILE_VERSION = 1;

/** The accepted key shapes (format only; the provider validates the key at the first account check). */
const KEY_SHAPE = Object.freeze({
  codex: /^sk-[A-Za-z0-9_-]{20,400}$/,
  claude: /^sk-ant-[A-Za-z0-9_-]{20,400}$/,
});

export function validateKeyShape(provider, key) {
  if (!API_KEY_PROVIDERS.includes(provider)) return "Provider necunoscut";
  const value = typeof key === "string" ? key.trim() : "";
  if (!value) return "Cheia lipsește";
  if (provider === "codex" && value.startsWith("sk-ant-")) return "Aceasta pare o cheie Anthropic; pentru Codex trebuie o cheie OpenAI (sk-…)";
  if (!KEY_SHAPE[provider].test(value)) return provider === "codex" ? "Cheia OpenAI trebuie să înceapă cu sk- și să nu conțină spații" : "Cheia Anthropic trebuie să înceapă cu sk-ant- și să nu conțină spații";
  return null;
}

/** The route's account identity: HMAC of the key under the instance salt (never reversible, 16 hex). */
export function keyFingerprint(salt, provider, key) {
  if (typeof salt !== "string" || salt.length < 16) throw new Error("Lipsește sarea identității (billing identity salt)");
  return crypto.createHmac("sha256", salt).update(`api-key:v1\n${provider}\n${String(key).trim()}`, "utf8").digest("hex").slice(0, 16);
}

export const API_IDENTITY_SCHEME = "api-key-hmac:v1";
export const apiKeyIdentity = (fingerprint) => (fingerprint && /^[0-9a-f]{16}$/.test(fingerprint)
  ? { scheme: API_IDENTITY_SCHEME, value: fingerprint, basis: "api_key", plan: "api" } : null);

// ---------- protectors ----------

/** PowerShell (Windows PowerShell 5.1 ships System.Security) protecting/unprotecting base64 from stdin, CurrentUser scope. */
const DPAPI_SCRIPT = (op) => [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$in=[Console]::In.ReadToEnd().Trim()",
  "$bytes=[Convert]::FromBase64String($in)",
  "$entropy=[Text.Encoding]::UTF8.GetBytes('IfrimAgentHub-v2-api-key')",
  `$out=[Security.Cryptography.ProtectedData]::${op}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
  "[Console]::Out.Write([Convert]::ToBase64String($out))",
].join(";");

function runPowerShell(script, inputB64, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    let child;
    try { child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { reject(error); return; }
    let out = ""; let err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error("DPAPI: PowerShell nu a răspuns la timp")); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // stderr is never echoed whole: it could quote the input on some failures.
      if (code !== 0) reject(new Error(`DPAPI: PowerShell a ieșit cu ${code}${err ? " (eroare de criptare)" : ""}`));
      else resolve(out.trim());
    });
    child.stdin.end(inputB64);
  });
}

export const dpapiProtector = Object.freeze({
  scheme: "dpapi-currentuser",
  async protect(plain) {
    if (process.platform !== "win32") throw new Error("Cheile API se păstrează criptat doar pe Windows (DPAPI)");
    return runPowerShell(DPAPI_SCRIPT("Protect"), Buffer.from(plain, "utf8").toString("base64"));
  },
  async unprotect(blob) {
    if (process.platform !== "win32") throw new Error("Cheile API se citesc doar pe Windows (DPAPI)");
    return Buffer.from(await runPowerShell(DPAPI_SCRIPT("Unprotect"), blob), "base64").toString("utf8");
  },
});

/** Tests only: reversible, marked, refused by a real Hub. */
export function testProtector() {
  const k = crypto.createHash("sha256").update("ifrim-hub-test-protector").digest();
  return Object.freeze({
    scheme: "test-only",
    async protect(plain) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", k, iv); const body = Buffer.concat([c.update(plain, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64"); },
    async unprotect(blob) { const b = Buffer.from(blob, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); },
  });
}

// ---------- the vault ----------

export function createApiKeyVault({ config, salt, protector = null }) {
  const dir = path.join(config.dataDir, API_KEY_DIR);
  const prot = protector || (config.testMode ? testProtector() : dpapiProtector);
  const fileOf = (provider) => {
    if (!API_KEY_PROVIDERS.includes(provider)) throw new Error("Provider necunoscut");
    return path.join(dir, `${provider}.json`);
  };
  const readMeta = (provider) => {
    try {
      const doc = JSON.parse(fs.readFileSync(fileOf(provider), "utf8"));
      if (doc?.version !== FILE_VERSION || typeof doc.blob !== "string" || !/^[0-9a-f]{16}$/.test(String(doc.fingerprint || ""))) return { present: true, valid: false };
      return { present: true, valid: true, doc };
    } catch (error) { return error.code === "ENOENT" ? { present: false, valid: false } : { present: true, valid: false }; }
  };

  return {
    dir,
    scheme: prot.scheme,
    /** Non-secret facts only. */
    status(provider) {
      const m = readMeta(provider);
      if (!m.present) return { present: false };
      if (!m.valid) return { present: true, valid: false, problem: "Fișierul cheii nu este valid; salvează cheia din nou" };
      const foreign = m.doc.scheme !== prot.scheme;
      return { present: true, valid: !foreign, fingerprint: m.doc.fingerprint, last4: m.doc.last4, setAt: m.doc.setAt, scheme: m.doc.scheme,
        ...(foreign ? { problem: `Cheia a fost salvată cu altă protecție (${m.doc.scheme}); salvează cheia din nou` } : {}) };
    },
    async set(provider, key, { now = new Date() } = {}) {
      const problem = validateKeyShape(provider, key);
      if (problem) throw Object.assign(new Error(problem), { category: "validation" });
      const value = key.trim();
      const blob = await prot.protect(value);
      // Round trip before anything is written: a key that cannot be read back is never stored.
      if ((await prot.unprotect(blob)) !== value) throw new Error("Verificarea criptării a eșuat; cheia nu a fost salvată");
      const doc = { version: FILE_VERSION, provider, scheme: prot.scheme, blob, fingerprint: keyFingerprint(salt(), provider, value), last4: value.slice(-4), setAt: now.toISOString() };
      fs.mkdirSync(dir, { recursive: true });
      const target = fileOf(provider);
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, target);
      return { fingerprint: doc.fingerprint, last4: doc.last4, setAt: doc.setAt };
    },
    remove(provider) {
      try { fs.unlinkSync(fileOf(provider)); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    },
    /** The clear key, for one process start. Checks the stored fingerprint against this instance's salt. */
    async reveal(provider) {
      const m = readMeta(provider);
      if (!m.present) throw Object.assign(new Error("Nu există o cheie API salvată"), { category: "authentication" });
      if (!m.valid || m.doc.scheme !== prot.scheme) throw Object.assign(new Error("Cheia API salvată nu poate fi folosită (salveaz-o din nou)"), { category: "authentication" });
      let value;
      try { value = await prot.unprotect(m.doc.blob); }
      catch { throw Object.assign(new Error("Cheia API nu poate fi decriptată de acest cont Windows; salveaz-o din nou"), { category: "authentication" }); }
      if (keyFingerprint(salt(), provider, value) !== m.doc.fingerprint) throw Object.assign(new Error("Amprenta cheii API nu corespunde; salveaz-o din nou"), { category: "authentication" });
      return { key: value, fingerprint: m.doc.fingerprint };
    },
  };
}
