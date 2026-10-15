// Test shell without makeTestHub's git fixture or TEST_TMP. Never opens a listener.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, HUB_ROOT } from "../../server/config.mjs";
import { createHub } from "../../server/hub.mjs";
import { FIXTURES, freePort } from "../helpers.mjs";

export async function makeRehearsalHub({ parent, mode, scenario, providerOverrides = {} }) {
  const base = path.join(HUB_ROOT, ".ifrim", "tmp");
  fs.mkdirSync(base, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(base, "s25-parity-"));
  const homeDir = mode === "real" ? os.homedir() : path.join(dataDir, "fake-home");
  if (mode === "fake") fs.mkdirSync(homeDir, { recursive: true });
  const logs = Object.fromEntries(["codex", "claude"].map((p) => [p, path.join(dataDir, `${p}.log`)]));
  const queues = Object.fromEntries(["codex", "claude"].map((p) => [p, path.join(dataDir, `${p}.queue`)]));
  const hanging = scenario === "hang";
  const hubProject = mode === "real" ? HUB_ROOT : path.join(dataDir, "hub-project");
  if (mode === "fake") fs.mkdirSync(hubProject, { recursive: true });
  const config = loadConfig({ testMode: true, dataDir, hubRoot: hubProject, projectsRoot: parent,
    workDir: path.join(parent, "work"), skillsDir: path.join(dataDir, "empty-skills"),
    registryPath: path.join(dataDir, "no-registry.md"), roleRegistryPath: path.join(dataDir, "no-roles.json"),
    legacyDbPath: path.join(dataDir, "no-legacy.sqlite"), port: await freePort(), providerBinaries: {
      codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs"), `--log=${logs.codex}`, `--scenario-queue=${queues.codex}`] },
      claude: { executable: process.execPath, prefixArgs: hanging
        ? [path.join(FIXTURES, "fake-turn.mjs"), "--turn-scenario=hang"]
        : [path.join(FIXTURES, "fake-claude.mjs"), `--fake-log=${logs.claude}`, `--fake-scenario-queue=${queues.claude}`] },
    } });
  fs.mkdirSync(config.skillsDir, { recursive: true });
  fs.writeFileSync(`${logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true, efforts: ["medium"] }]));
  const hub = createHub(config, { homeDir, providerOverrides });
  try { await hub.boot(); hub.scheduler.stop(); } catch (error) { await hub.close(); throw error; }
  return { hub, config, homeDir, dataDir, logs,
    queue: (provider, ...lines) => fs.appendFileSync(queues[provider], lines.join("\n") + "\n") };
}
