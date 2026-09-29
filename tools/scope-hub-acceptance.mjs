import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolationPaths, assertPhysicalIsolationBoundary, validateIsolatedPaths } from "../apps/api/src/subscription-isolation.mjs";
import { digest, verifyGatewayReceipt } from "../apps/api/src/subscription-auth.mjs";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";
import { validateSubscriptionGate } from "../apps/api/src/openclaw-subscription-gate.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";
import { hubAcceptanceScopes, exactHubAcceptanceScope, targetHubAcceptanceCertificate } from "../apps/api/src/hub-acceptance-scope.mjs";

const mode = process.argv[2];
if (!["--approved-hub-018-codex", "--approved-hub-018-claude", "--suspend-hub-018"].includes(mode)) throw new Error("Approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gateFile = path.join(root, ".ifrim", "private", "openclaw-subscription-gate.json");
await assertPhysicalIsolationBoundary(root, path.dirname(gateFile));
const release = await acquireSubscriptionMaintenanceLock(root);
try {
  if (!(await fs.lstat(gateFile)).isFile() || (await fs.lstat(gateFile)).isSymbolicLink()) throw new Error("Gate must be a regular file");
  const original = await fs.readFile(gateFile);
  const gate = JSON.parse(original);
  const scope = mode === "--suspend-hub-018" ? exactHubAcceptanceScope(gate)
    : hubAcceptanceScopes[mode === "--approved-hub-018-codex" ? "codex" : "claude"];
  if (!scope) throw new Error("Different acceptance scope; no change made");
  if (mode !== "--suspend-hub-018") {
    const db = await import("node:sqlite");
    const state = new db.DatabaseSync(path.join(root, ".ifrim/private/agent-hub.sqlite"), { readOnly: true });
    try {
      if (state.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n
        || state.prepare("SELECT COUNT(*) AS n FROM hub_provider_runs WHERE status='running'").get().n
        || state.prepare("SELECT COUNT(*) AS n FROM execution_attempts WHERE status='running'").get().n) throw new Error("Active execution prevents scope activation");
    } finally { state.close(); }
    const options = { cwd: root, conversationId: scope.acceptanceConversationId, provider: scope.acceptanceProvider, model: scope.acceptanceModel,
      reasoning: scope.acceptanceReasoning, accessMode: "read-only", agentId: "ifrim-backend" };
    const raw = await fs.readFile(isolationPaths(root).config);
    const config = JSON.parse(raw);
    validateIsolatedPaths(config, root);
    const evidencePath = path.join(root, ".ifrim", "private", `openclaw-${options.provider}-auth-evidence.json`);
    if (gate.providers?.[options.provider]?.evidencePath !== evidencePath) throw new Error("Unexpected certificate path");
    const evidenceRaw = await fs.readFile(evidencePath);
    if (digest(evidenceRaw) !== gate.providers[options.provider].evidenceSha256) throw new Error("Certificate changed");
    const evidence = JSON.parse(evidenceRaw);
    const targetGate = targetHubAcceptanceCertificate(gate, options.provider);
    validateSuspendedDiagnosticCertificate(targetGate, evidence, config, digest(raw), options);
    await verifyGatewayReceipt(evidence.receipt);
    Object.assign(gate, scope, { status: "approved", acceptanceActivatedAt: new Date().toISOString() });
    validateSubscriptionGate(gate, config, digest(raw), options);
  } else {
    gate.status = "suspended";
  }
  if (digest(await fs.readFile(gateFile)) !== digest(original)) throw new Error("Gate changed concurrently");
  const backup = `${gateFile}.checkpoint-${new Date().toISOString().replaceAll(":", "-")}`;
  await fs.copyFile(gateFile, backup, fs.constants.COPYFILE_EXCL);
  const temporary = `${backup}.next`;
  await fs.writeFile(temporary, JSON.stringify(gate, null, 2), { flag: "wx" });
  await fs.rename(temporary, gateFile);
  console.log(JSON.stringify({ status: gate.status, provider: scope.acceptanceProvider, model: scope.acceptanceModel,
    reasoning: scope.acceptanceReasoning, accessMode: scope.acceptanceAccessMode, conversationId: scope.acceptanceConversationId, checkpoint: backup, modelStarted: false }));
} finally { await release(); }
