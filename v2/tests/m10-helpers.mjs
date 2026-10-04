// M10 test helpers: a test Hub whose Desktop Operator is the deterministic fixture (tests/fixtures/fake-operator.mjs), with fake signed
// app binaries for discovery, a control file to inject events mid-run (user input, focus stolen, window replaced, secure desktop) and the
// fixture's operation log (op + authority; typed text only as a length).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, tempDir, enrolOwner } from "./helpers.mjs";

export const FAKE_OPERATOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-operator.mjs");

const SIGNERS = { notepad: "CN=Microsoft Corporation, O=Microsoft Corporation", explorer: "CN=Microsoft Windows, O=Microsoft Corporation", obs: "CN=OBS Project, LLC", capcut: "CN=Bytedance Pte. Ltd." };
const EXE = { notepad: "notepad.exe", explorer: "explorer.exe", obs: "obs64.exe", capcut: "CapCut.exe" };

/**
 * @param {object} o
 * @param {object} [o.scenario] extra fixture scenario (windows, secureDesktop, userInputAfterChars, exitOn, hangOps, …)
 * @param {object} [o.signers] per-app overrides of the discovered signature ({ capcut: { trusted: false } })
 * @param {object} [o.hub] extra makeTestHub options (configOverrides merged)
 */
export async function makeDesktopHub({ scenario = {}, signers = {}, hub = {} } = {}) {
  const dir = tempDir("m10-desk");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const discover = {};
  for (const [id, exe] of Object.entries(EXE)) {
    const p = path.join(bin, exe);
    fs.writeFileSync(p, `fake ${id} binary v1`);
    discover[id] = { path: p, source: id === "capcut" ? "versioned_dir" : id === "notepad" ? "app_paths" : "known_path", signed: true, trusted: true, signer: SIGNERS[id], fileVersion: "1.0.0", ...(signers[id] || {}) };
  }
  const scenarioFile = path.join(dir, "scenario.json");
  const controlFile = path.join(dir, "control.json");
  const logFile = path.join(dir, "operator.log");
  fs.writeFileSync(scenarioFile, JSON.stringify({ discover, ...scenario }));
  fs.writeFileSync(controlFile, "{}");
  const launcher = { executable: process.execPath, prefixArgs: [FAKE_OPERATOR, `--scenario=${scenarioFile}`, `--control=${controlFile}`, `--log=${logFile}`] };
  const t = await makeTestHub({ ...hub, configOverrides: { ...(hub.configOverrides || {}), desktop: { launcher } } });
  const control = (patch) => fs.writeFileSync(controlFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(controlFile, "utf8") || "{}"), ...patch }));
  const opLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const rebinary = (id, content) => fs.writeFileSync(discover[id].path, content);
  return { ...t, dir, bin, control, opLog, rebinary, discoverPaths: discover };
}

/** Owner session + discovery + authorization of the given apps (what the activation card does in the UI). */
export async function readyDesktop(t, apps = ["notepad", "explorer", "obs", "capcut"]) {
  const owner = await enrolOwner(t);
  await t.hub.desktop.discover("test");
  if (apps.length) t.hub.desktop.apps.authorize(apps, { sessionId: owner.session.id, via: "test" });
  return owner;
}

/** Dispatches on the owner channel with the session (exactly what the HTTP layer does with the cookie). */
export const asOwner = (t, owner, type, payload = {}, extra = {}) =>
  t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, ...extra }).then((r) => r.result);
export const asChannel = (t, channel, type, payload = {}) => t.hub.commands.dispatch({ type, payload, channel, actor: channel === "voice" ? "voice" : "user" }).then((r) => r.result);

/** Proposes and confirms a plan in one go (click modality); returns the final plan view once its run ends. */
export async function runPlan(t, owner, { kind = "test.plan", title = "Plan de test", steps, limits = {} }, { secrets = null } = {}) {
  const p = await asOwner(t, owner, "ops.plan.propose", { kind, title, steps, limits });
  await asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash, ...(secrets ? { secrets } : {}) });
  return t.hub.opsPlans.idle(p.id);
}
