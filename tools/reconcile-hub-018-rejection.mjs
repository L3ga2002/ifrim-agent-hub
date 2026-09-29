import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { createConversationStore } from "../apps/api/src/conversation-store.mjs";
import { assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";

export async function reconcileHubRejection(root, { openDatabase = (file) => new DatabaseSync(file), backupDatabase = backup,
  acquireLock = acquireSubscriptionMaintenanceLock } = {}) {
const id = "provider-run-c8c037fd-7143-4abf-96b6-ebc41fea9bb1";
const conversationId = "conversation-e6fbedfd-3b88-4bb5-8808-0b18cf4ccb29";
const database = path.join(root, ".ifrim/private/agent-hub.sqlite");
await assertPhysicalIsolationBoundary(root, path.dirname(database));
const source = await fs.lstat(database);
if (!source.isFile() || source.isSymbolicLink()) throw new Error("Database must be a regular file");
const release = await acquireLock(root);
let db;
try {
  db = openDatabase(database);
  const gate = JSON.parse(await fs.readFile(path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), "utf8"));
  if (gate.status !== "suspended") throw new Error("Suspend admission before reconciliation");
  const store = createConversationStore(db);
  const validate = () => {
    const run = store.getRun(id);
    const lease = store.listLeases(conversationId).find((item) => item.runId === id);
    const messages = store.listMessages(conversationId).filter((item) => item.runId === id);
    const metadata = run?.metadata;
    if (run?.status !== "blocked" || run.errorCategory !== "REMOTE_STATE_UNKNOWN" || run.taskId !== "HUB-018"
      || run.conversationId !== conversationId || run.provider !== "codex"
      || run.model !== "openai/gpt-6-luna" || run.reasoningLevel !== "max"
      || !lease || lease.workspace !== root || lease.resource !== "workspace-write"
      || metadata?.actual !== null || metadata.gatewayRunId || metadata.openclawGatewayRunId
      || metadata.rpcDiagnostics?.error?.code !== "INVALID_REQUEST"
      || metadata.rpcDiagnostics.requests?.at(-1)?.requestId !== "4:6c66c2bf-d483-452c-ab03-1bc4d9a2eb1c"
      || metadata.rpcDiagnostics.requests.at(-1).method !== "agent"
      || metadata.activity?.some((item) => item.label === "OpenClaw: run admitted")
      || !messages.some((item) => item.role === "assistant"
        && item.content === "Run failed: expectedExistingSessionId is reserved for backend callers.")) {
      throw new Error("Exact reviewed pre-admission evidence not confirmed");
    }
    return { run, lease, messages };
  };
  validate();
  const checkpoint = path.join(root, ".ifrim/BACKUPS", `hub-018-rejection-${Date.now()}.sqlite`);
  await assertPhysicalIsolationBoundary(root, path.dirname(checkpoint));
  const reservation = await fs.open(checkpoint, "wx");
  await reservation.close();
  await backupDatabase(db, checkpoint);
  const saved = new DatabaseSync(checkpoint, { readOnly: true });
  try { if (saved.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Checkpoint integrity failed"); }
  finally { saved.close(); }
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = validate();
    const at = new Date().toISOString();
    store.addCheckpoint(conversationId, id, { kind: "reviewed-pre-admission-reconciliation", at, checkpoint, ...previous });
    store.updateRun(id, { status: "failed", errorCategory: "PRE_ADMISSION_REJECTED", usage: { status: "not_started" },
      metadata: { ...previous.run.metadata, remoteStateUnknown: false,
        reconciliation: { at, checkpoint, priorStatus: "blocked", priorErrorCategory: "REMOTE_STATE_UNKNOWN",
          evidence: "Official preflight rejected reserved expectedExistingSessionId before startTurn; exact negative RPC response, no acceptance receipt", reviewer: "ifrim-reviewer" } } });
    if (!store.releaseLease("workspace-write", root, id)) throw new Error("Exact lease changed");
    if (store.listRuns(conversationId).some((run) => run.status === "running")) throw new Error("Concurrent active run");
    store.updateConversation(conversationId, { status: "failed" });
    db.exec("COMMIT");
    return { runId: id, status: "failed", errorCategory: "PRE_ADMISSION_REJECTED", checkpoint, modelStarted: false, exactLeaseReleased: true };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
} finally { try { db?.close(); } finally { await release(); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(await reconcileHubRejection(root)));
}
