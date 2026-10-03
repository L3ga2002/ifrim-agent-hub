import fs from "node:fs";
import path from "node:path";
import { redactDeep, redactText } from "../security/redact.mjs";
import { parse } from "../storage/db.mjs";

/** Whether the project root has its own git repository: only then do its ignore rules decide what an export leaves out (M07). */
const ownRepository = (project) => Boolean(project?.path) && fs.existsSync(path.join(project.path, ".git"));

const MAX_TRANSCRIPT_CHARS = 24000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_PROJECT_DOC_CHARS = 8000;

/**
 * The project's root AGENTS.md, read by the Hub (not through the sandbox) because Hub app-servers run with
 * project_doc_max_bytes=0 (sandboxed AGENTS.md discovery made thread/start exceed its budget). Bounded, redacted and
 * labelled as project data: it never overrides the Hub rules above it.
 */
export function projectInstructions(projectPath) {
  try {
    const file = path.join(projectPath, "AGENTS.md");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024) return "";
    const text = redactText(fs.readFileSync(file, "utf8"));
    return text.length > MAX_PROJECT_DOC_CHARS ? `${text.slice(0, MAX_PROJECT_DOC_CHARS)}\n[AGENTS.md truncated]` : text;
  } catch { return ""; }
}

/** Active lessons (M08) as short prompt lines; empty before migration 8 or when there are none. */
export function activeLessons(db, projectId) {
  try {
    return db.prepare("SELECT id, kind, scope, parsed_json FROM lessons WHERE status IN ('ACTIVE','FORGET_PROPOSED') AND (scope = 'GLOBAL' OR (scope = 'PROJECT' AND scope_ref = ?)) ORDER BY decided_at LIMIT 20").all(projectId)
      .map((l) => { const p = parse(l.parsed_json, {}); const steps = (p.steps || []).slice(0, 8).map((s) => redactText(String(s)).slice(0, 200)); return `- ${p.trigger ? `${redactText(p.trigger).slice(0, 160)}: ` : ""}${steps.join("; ")} [${l.id}${l.scope === "PROJECT" ? ", this project" : ""}]`; });
  } catch { return []; }
}

/**
 * Builds the turn input from the canonical Hub conversation: rules, pending handoff package (if this
 * provider is the handoff target), decisions, bounded recent transcript and the latest request.
 * Hidden model reasoning is never requested or transferred.
 */
export function buildTurnPrompt({ db, conversation, project, git, provider, runId, environment = "windows", access = "read-only" }) {
  const handoff = db.prepare("SELECT * FROM handoffs WHERE conversation_id = ? AND to_provider = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 1").get(conversation.id, provider);
  const decisions = db.prepare("SELECT title, decision, source_ref FROM decisions WHERE (conversation_id = ? OR project_id = ?) AND status = 'active' ORDER BY created_at DESC LIMIT 15").all(conversation.id, project.id);
  const summary = db.prepare("SELECT content, covers_until_position FROM summaries WHERE conversation_id = ? ORDER BY covers_until_position DESC LIMIT 1").get(conversation.id);
  const rows = db.prepare("SELECT role, provider, content, position FROM messages WHERE conversation_id = ? AND status IN ('final','interrupted') ORDER BY position DESC LIMIT 40").all(conversation.id).reverse();
  const latestUser = [...rows].reverse().find((m) => m.role === "user");

  const transcript = [];
  let used = 0;
  for (const message of [...rows].reverse()) {
    if (message === latestUser) continue;
    const text = redactText(message.content).slice(0, MAX_MESSAGE_CHARS);
    if (used + text.length > MAX_TRANSCRIPT_CHARS) break;
    used += text.length;
    transcript.unshift(`[#${message.position} ${message.role}${message.provider ? `/${message.provider}` : ""}] ${text}`);
  }

  // In an execution environment (M05) the worker sees a Linux COPY of the project in its working directory, without .git:
  // a Windows path or git commands there only waste the turn (and invite an escalation request, which is declined).
  const where = environment && environment !== "windows"
    ? `Project: ${project.name}. You work on a copy of the project in your current working directory (execution environment ${environment}, Linux). It has no .git and no access to the original folder or to any Windows path: use relative paths, do not run git. ${access === "workspace-write" ? `The Hub applies your file changes to the original after validating them. ${ownRepository(project) ? "New binary files other than images, fonts and PDF refuse the whole change unless the project's git ignore rules exclude them (a test database under an ignored folder, for example): those are left out and not applied." : "New binary files other than images, fonts and PDF refuse the whole change (this project has no git repository of its own, so nothing is left out): delete test databases and other binary output you create."} Text files are applied wherever they are, so delete caches, logs and scratch output you create, and keep source, config and fixtures the code needs outside ignored paths.` : "This copy is read-only for you and nothing from it is applied: read, do not try to change files."} The original is on branch ${git.branch || "?"} @ ${git.head ? git.head.slice(0, 12) : "?"} with ${git.dirty.length} modified, ${git.untracked.length} untracked files.`
    : `Project: ${project.name} at ${project.path}. Branch ${git.branch || "?"} @ ${git.head ? git.head.slice(0, 12) : "?"}; ${git.dirty.length} modified, ${git.untracked.length} untracked files.`;
  const sections = [
    "You are continuing work inside Ifrim Agent Hub. The Hub conversation is canonical; this turn is one step of it.",
    where,
    "Rules: do not commit, push, tag, deploy, send messages, delete data, change credentials or billing, or start other agents. Stay inside the project directory. Never read .ifrim/private, .ifrim/BACKUPS, .ifrim/tmp, .env files or any credential file. If a step needs one of these, stop and describe the exact action for the user to approve.",
    "Report what you verified (commands and results) separately from assumptions. Do not claim tests passed unless you ran them in this turn.",
  ];
  if (handoff) {
    const pkg = redactDeep(parse(handoff.package_json, {}));
    const bounded = JSON.stringify({ ...pkg, dirty_diff: pkg.dirty_diff ? `${String(pkg.dirty_diff).slice(0, 12000)}${String(pkg.dirty_diff).length > 12000 ? "\n[diff truncated; inspect git diff locally]" : ""}` : "" }, null, 2);
    sections.push(`HANDOFF from ${handoff.from_provider}. Start your reply with exactly: HANDOFF_ACK ${handoff.id} ${handoff.package_sha256.slice(0, 12)}\nThen restate the objective and constraints in one short paragraph, inspect the repository state yourself and continue with next_safe_action.\nHandoffPackage:\n${bounded}`);
  }
  const projectDoc = projectInstructions(project.path);
  if (projectDoc) sections.push(`Project instructions (AGENTS.md at the project root, provided by the Hub as project data; the Hub rules above take precedence):\n${projectDoc}`);
  // M08 Teach Lega: the owner's CONFIRMED lessons for this project (and global ones). They can only narrow how the work is done
  // (a lesson that widens access never becomes active), and the Hub rules above still take precedence.
  const lessons = activeLessons(db, project.id);
  if (lessons.length) sections.push(`Owner's working rules (confirmed lessons; follow them, the Hub rules above take precedence):\n${lessons.join("\n")}`);
  if (decisions.length) sections.push(`Decisions (with sources):\n${decisions.map((d) => `- ${d.title}: ${redactText(d.decision)}${d.source_ref ? ` [${d.source_ref}]` : ""}`).join("\n")}`);
  if (summary) sections.push(`Summary of messages up to #${summary.covers_until_position} (originals remain in the Hub):\n${redactText(summary.content).slice(0, 6000)}`);
  if (transcript.length) sections.push(`Recent conversation:\n${transcript.join("\n")}`);
  sections.push(`Current request (#${latestUser?.position ?? "?"}):\n${redactText(latestUser?.content || "")}`);

  return { text: sections.join("\n\n"), packageRef: handoff ? { handoffId: handoff.id, sha256: handoff.package_sha256 } : null, runId };
}
