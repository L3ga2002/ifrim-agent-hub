import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTONOMY_LEVELS, AUTONOMY_LABELS, DENIED_EFFECTS } from "./envelopes.mjs";
import { ACTION_CATALOG } from "../policy/approval-policy.mjs";
import { hubWords } from "../domain/company-graph.mjs";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = fileURLToPath(new URL("../../config/process-sheets.json", import.meta.url));
export const processSheetAliases = () => JSON.parse(fs.readFileSync(CONFIG, "utf8")).map(({ id, aliases }) => ({ id, aliases }));
const shortLabel = (level) => AUTONOMY_LABELS[level].split(":")[0];
export const EFFECT_LABELS = Object.freeze({ deploy: "Deploy", "git.commit": "Commit", "git.push": "Push", "message.send": "Trimiterea mesajelor", "connector.write": "Scrierea în conectori", publish: "Publicarea", billing: "Facturarea și plățile", "auth.change": "Schimbarea autentificării", "isolation.change": "Izolarea", "policy.change": "Politicile", install: "Instalarea", "data.delete": "Ștergerea datelor", "cloud_task.start": "Taskuri în cloud", other_projects: "Alte proiecte", "owner.accept": "Acceptarea" });
const OWNER_ACTIONS = ["sales.proposal_approve", "desk.support_reply_approve", "desk.finance_doc_approve"];
const section = (body, heading) => { const match = body.match(new RegExp(`^## ${heading}[^\\r\\n]*\\r?\\n`, "m")); return match ? body.slice(match.index + match[0].length).split(/^## /m)[0].trim() : ""; };
/** Editorial flow descriptions plus live registered skill facts; references are verified on every read. */
export function processSheets(hub, { projectId = null } = {}) {
  const skills = hub.skills.list(); const roles = hub.roleConfig.roles; const tools = hub.integrations.list();
  const root = hub.config.hubRoot || ROOT;
  const refOk = ({ kind, ref }) => kind === "skill" ? skills.some((s) => s.id === ref) : kind === "role" ? roles.some((r) => r.id === ref) : kind === "policy" ? DENIED_EFFECTS.includes(ref) || ACTION_CATALOG.some((a) => a.actionKind === ref) : ["code", "doc"].includes(kind) && !path.isAbsolute(ref) && !ref.split(/[\\/]/).includes("..") && fs.existsSync(path.join(root, ref.split("#")[0]));
  const project = projectId ? hub.projects.get(projectId) : null;
  const effective = project ? hub.envelopes.autonomyOf(project.id) : null;
  const autonomy = { levels: AUTONOMY_LEVELS.map((level) => ({ level, label: shortLabel(level) })), project: project ? { id: project.id, name: project.name, ...effective, label: shortLabel(effective.level), setAt: effective.setAt || null } : null, defaultRule: "Fără proiect selectat: proiectele de test pornesc la Asistat, cele reale la Observ; un plan nu depășește niciodată treapta proiectului și nu acordă autoritate." };
  const sheets = JSON.parse(fs.readFileSync(CONFIG, "utf8")).map((editorial) => {
    const skill = editorial.id.startsWith("skill:") ? skills.find((s) => s.id === editorial.id.slice(6)) : null;
    let body = "";
    if (skill) body = hub.db.prepare("SELECT body FROM skill_versions WHERE skill_id = ? AND version = ?").get(skill.id, skill.currentVersion)?.body || "";
    const who = skill ? hubWords(skill.metadata?.["hub-roles"]) : editorial.who;
    const refs = [...(editorial.refs || []), ...(skill ? [{ kind: "skill", ref: skill.id }] : []), ...(who || []).map((ref) => ({ kind: "role", ref }))];
    const maxLevel = AUTONOMY_LEVELS.at(-1);
    const stepHeading = section(body, "Steps") ? "Steps" : "Storyboard";
    return { ...editorial, kind: editorial.id.startsWith("skill:") ? "skill" : "flow", what: skill?.description || editorial.what || "Skill neînregistrat; faptele nu sunt disponibile.", who: (who || []).map((roleId) => ({ roleId, name: roles.find((r) => r.id === roleId)?.name || roleId })), steps: skill ? section(body, stepHeading).split(/\r?\n/).filter((s) => /^\d+\./.test(s)).map((s) => ({ title: s.replace(/^\d+\.\s*/, ""), ref: `v2/skills/${skill.id}/SKILL.md#${stepHeading.toLowerCase()}` })) : editorial.steps, tools: (skill ? hubWords(skill.metadata?.["hub-tools"]) : [...new Set((who || []).flatMap((id) => roles.find((r) => r.id === id)?.tools || []))]).map((id) => ({ id, status: tools.find((t) => t.id === id)?.status || "unregistered" })), autonomy: { max: { level: maxLevel, label: shortLabel(maxLevel), note: "Plafon delimitat de DENIED_EFFECTS; skill-ul nu acordă autoritate." }, effective: effective ? { level: effective.level, label: shortLabel(effective.level), source: effective.source } : null, note: skill ? `Permisiunea skill-ului: ${skill.metadata?.["hub-permission"] || "READ_ONLY"}; intersectată cu rolul și planul.` : "Planul rămâne în treapta proiectului și limitele confirmate." }, never: skill ? section(body, "Hub rules").split(/\r?\n/).filter((s) => /^- /.test(s)).map((s) => s.slice(2)) : editorial.never, alwaysOwner: editorial.alwaysOwner || ["Deciziile rezervate proprietarului rămân ale tale."], disabled: editorial.disabled || [], refs: refs.map((r) => ({ ...r, ok: Boolean(refOk(r)) })) };
  });
  return { readAt: hub.config.now().toISOString(), autonomy, alwaysOff: [...DENIED_EFFECTS.map((effect) => ({ effect, label: EFFECT_LABELS[effect], rule: effect === "owner.accept" ? "mereu tu" : "mereu oprit", source: "envelopes.mjs DENIED_EFFECTS" })), ...ACTION_CATALOG.filter((a) => OWNER_ACTIONS.includes(a.actionKind) && a.policy === "ALWAYS_ASK").map((a) => ({ effect: a.actionKind, label: a.label, rule: "mereu tu", source: "approval-policy ACTION_CATALOG" }))], sheets };
}
