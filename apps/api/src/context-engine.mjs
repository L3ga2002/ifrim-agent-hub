import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sensitivePath = /(^|[\\/])(?:\.env(?:\.|$)|\.git[\\/]|private[\\/]|credentials?|secrets?|tokens?)(?:[\\/]|$)/i;
const sensitiveLine = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]/i;

export function sanitizeContext(value) {
  if (typeof value === "string") {
    return value.split("\n").map((line) => sensitiveLine.test(line) ? "[redacted sensitive line]" : line
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{12,})\b/g, "[redacted key]")
      .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")).join("\n");
  }
  if (Array.isArray(value)) return value.map(sanitizeContext);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveLine.test(`${key}:`))
    .map(([key, item]) => [key, sanitizeContext(item)]));
  return value;
}

async function git(cwd, args, maxBuffer = 250000) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true, timeout: 7000, maxBuffer });
    return stdout.trim();
  } catch { return ""; }
}

export async function repositoryState(workspace) {
  const [branch, head, status, diff] = await Promise.all([
    git(workspace, ["branch", "--show-current"]),
    git(workspace, ["rev-parse", "HEAD"]),
    git(workspace, ["status", "--short", "--untracked-files=normal"]),
    git(workspace, ["diff", "--no-ext-diff", "--", ".", ":(exclude)**/.env*", ":(exclude)**/private/**", ":(exclude)**/*secret*", ":(exclude)**/*token*"]),
  ]);
  const changedFiles = status.split("\n").filter(Boolean).map((line) => line.slice(3))
    .filter((name) => !sensitivePath.test(name));
  return { branch, head, gitStatus: sanitizeContext(status).slice(0, 12000),
    changedFiles, diff: sanitizeContext(diff).slice(0, 60000) };
}

export async function createContextEnvelope({ store, conversation, project, previousRun = null, recentMessageCount = 20 }) {
  const state = store.getTaskState(conversation.id);
  const messages = store.listMessages(conversation.id, 20000);
  const repo = await repositoryState(conversation.workspace);
  const recent = messages.slice(-Math.max(1, Math.min(100, recentMessageCount)));
  const older = messages.slice(0, -recent.length);
  const historicalHits = older.filter((item) => /decision|blocked|failed|approved|test|error/i.test(item.content)).slice(-8);
  const runs = store.listRuns(conversation.id);
  const envelope = {
    conversationId: conversation.id, taskId: conversation.activeTaskId,
    originalObjective: state?.objective || "", currentObjective: state?.objective || "",
    requirements: state?.requirements || [], acceptanceCriteria: state?.acceptanceCriteria || [],
    importantDecisions: store.listDecisions(conversation.id), currentPlan: state?.currentPlan || [],
    completedWork: state?.completedSteps || [], remainingWork: state?.remainingSteps || [],
    failedAttempts: runs.filter((item) => ["failed", "interrupted"].includes(item.status)).map((item) => ({ id: item.id, category: item.errorCategory })),
    blockers: state?.blockers || [], relevantMessages: [...historicalHits, ...recent].map((item) => ({ role: item.role, content: item.content, provider: item.provider, timestamp: item.timestamp })),
    rollingSummary: state?.summary || "", relevantFiles: state?.relevantFiles || [],
    project: { slug: project.slug, path: project.path },
    branch: repo.branch, worktree: conversation.workspace, HEAD: repo.head,
    gitStatus: repo.gitStatus, changedFiles: repo.changedFiles, diff: repo.diff,
    testsExecuted: state?.tests || [], testResults: runs.flatMap((item) => item.testsExecuted || []).slice(-30),
    processesStarted: [], localURLs: [project.frontend, project.backend].filter((url) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url || "")),
    artifacts: recent.flatMap((item) => item.attachments || []).filter((item) => item && !sensitivePath.test(item.location || item.path || "")),
    nextRecommendedAction: state?.remainingSteps?.[0] || "Inspect existing repository state and continue the task.",
    previousProvider: previousRun?.provider || "", previousModel: previousRun?.model || "", previousRun: previousRun?.id || "",
    nativeSessions: store.listProviderSessions(conversation.id).map((item) => ({ provider: item.provider, status: item.status })),
    activeLeases: store.listLeases(conversation.id),
    machine: { os: os.platform(), cwd: conversation.workspace }, timestamp: new Date().toISOString(),
  };
  return sanitizeContext(envelope);
}

export function renderHandoffPrompt(envelope, userMessage = "") {
  const transferable = sanitizeContext({
    ...envelope,
    diff: "Omitted from transmitted context; inspect git diff locally in the assigned workspace.",
    relevantMessages: envelope.relevantMessages?.slice(-12).map((item) => ({ ...item, content: String(item.content || "").slice(0, 1500) })),
    artifacts: envelope.artifacts?.map((item) => ({ filename: item.filename || item.name || "", mime: item.mime || item.mimeType || "" })),
    activeLeases: undefined,
  });
  return [
    "THIS IS A CONTINUATION OF AN EXISTING TASK. Do not restart from zero.",
    "Inspect the existing repository/worktree state. Continue from the current state.",
    "The Agent Hub transcript and operational state are canonical; do not infer private reasoning.",
    "Respect existing approvals and project safety rules. Do not commit, push, deploy, delete important data, or send external messages without explicit user approval.",
    `ContextEnvelope:\n${JSON.stringify(transferable, null, 2).slice(0, 17000)}`,
    userMessage ? `Latest user request:\n${userMessage}` : "Continue the next safe step. Verify before repeating any operation after an interruption.",
  ].join("\n\n");
}
