// M10 UI logic (pure, testable without a browser): the plan card, the permanent desktop activity bar and Lega's replies for the
// desktop / plan intents. Nothing here decides authority: the Hub checks the session, the plan and every operation.

/** The plan the page presents (only that one can be confirmed, by its id + nonce + hash). */
export function presentedPlan(plan) {
  if (!plan?.id || plan.status !== "PROPOSED" || !plan.nonce || !plan.hash) return null;
  return { planId: plan.id, nonce: plan.nonce, hash: plan.hash };
}

export const PLAN_STATUS_LABELS = Object.freeze({ PROPOSED: "așteaptă confirmarea ta", CONFIRMED: "confirmat", RUNNING: "rulează", PAUSED: "pe pauză", DONE: "gata (verificat)", FAILED: "eșuat",
  CANCELLED: "anulat", EXPIRED: "expirat", SUPERSEDED: "înlocuit de un plan mai nou", NEEDS_OWNER: "așteaptă decizia ta" });
export const STEP_STATUS_LABELS = Object.freeze({ PENDING: "urmează", RUNNING: "acum", DONE: "verificat", FAILED: "eșuat", SKIPPED: "sărit", UNCERTAIN: "incert — verific la „Continuă”", CANCELLED: "anulat", BLOCKED: "oprit — e nevoie de tine" });
export const planTone = (status) => ({ DONE: "ok", FAILED: "error", NEEDS_OWNER: "warn", PAUSED: "warn", RUNNING: "info", CONFIRMED: "info", PROPOSED: "attention" }[status] || "neutral");
export const stepTone = (status) => ({ DONE: "ok", FAILED: "error", UNCERTAIN: "warn", BLOCKED: "warn", RUNNING: "info" }[status] || "neutral");

/** Steps whose run needs a secret typed at confirmation (never stored): the OBS WebSocket password. */
export const planNeedsObsPassword = (plan) => (plan?.body?.steps || []).some((s) => s.kind === "capture.obs_record");
/** The plan's decisions widen access: confirming them asks Windows Hello again (step-up). */
export const planNeedsStepUp = (plan) => (plan?.body?.decisions || []).length > 0;

/** What the card can still do with a plan, from its status. */
export function planActions(plan) {
  const s = plan?.status;
  return { confirm: s === "PROPOSED", pause: s === "RUNNING" || s === "CONFIRMED", resume: s === "PAUSED" || s === "NEEDS_OWNER", cancel: ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"].includes(s) };
}

/** The permanent desktop bar: visible whenever the operator works, is paused, or a plan runs / waits. */
export function desktopBarState(status) {
  if (!status) return { visible: false };
  const session = status.session;
  const current = status.current;
  const waiting = (status.plans || []).filter((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status));
  const running = (status.plans || []).filter((p) => ["RUNNING", "CONFIRMED"].includes(p.status));
  if (!session && !current && !waiting.length && !running.length) return { visible: false };
  const app = current?.app?.name || (session?.appId ? session.appId : null);
  if (session?.status === "PAUSED") return { visible: true, tone: "warn", text: `Operatorul e oprit: ${session.endReason || "aștept"}`, canStop: false, canTakeover: true, canResume: true, app };
  if (current) return { visible: true, tone: "info", text: `Lucrez în ${app || "o aplicație"}: ${OP_LABELS[current.op] || current.op}`, canStop: true, canTakeover: true, canResume: false, app };
  if (running.length) return { visible: true, tone: "info", text: `Rulează: ${running[0].title}`, canStop: true, canTakeover: true, canResume: false, app };
  if (waiting.length) return { visible: true, tone: "warn", text: `Așteaptă decizia ta: ${waiting[0].title}${waiting[0].statusReason ? ` — ${waiting[0].statusReason}` : ""}`, canStop: false, canTakeover: false, canResume: true, app };
  return { visible: true, tone: "info", text: "Operatorul are o sesiune deschisă", canStop: true, canTakeover: true, canResume: false, app };
}
export const OP_LABELS = Object.freeze({ "app.launch": "deschid aplicația", "app.focus": "aduc fereastra în față", "desktop.observe": "citesc structura ferestrei", "ui.setText": "pregătesc textul", "ui.type": "scriu",
  "ui.keys": "apăs o scurtătură", "ui.invoke": "apăs un buton", "file.saveAs": "salvez", "file.open": "deschid fișierul", "window.move": "mut fereastra", "folder.show": "arăt folderul" });

/** Lega's reply lines for the M10 results (desktop, plan card, resume, takeover). */
export function opsReplyLines(r) {
  const lines = [];
  if (!r) return lines;
  if (r.desktop?.app && r.desktop.verified !== undefined) lines.push(r.desktop.note || (r.desktop.verified ? `${r.desktop.app.name} e în prim-plan.` : `${r.desktop.app.name}: nu am putut verifica prim-planul.`));
  if (r.desktop?.folder) lines.push(r.desktop.verified ? `Am deschis folderul ${r.desktop.folder}.` : `Am cerut Explorer să deschidă ${r.desktop.folder}, dar nu am putut verifica fereastra.`);
  if (r.desktop?.takenOver) lines.push(r.desktop.note);
  if (r.opsPlan && !r.studio) lines.push(`${r.note || "Plan afișat."} ${r.opsPlan.decisions?.length ? "Confirmarea cere Windows Hello (decizie inclusă)." : "O singură confirmare."}`);
  if (r.plansPaused?.length) lines.push(`Am pus pe pauză ${r.plansPaused.length === 1 ? "planul care rula" : `${r.plansPaused.length} planuri`}.`);
  if (r.plan?.status && String(r.plan.id || "").startsWith("opp_")) lines.push(`Planul „${r.plan.title}”: ${PLAN_STATUS_LABELS[r.plan.status] || r.plan.status}.`);
  if (r.blockedBy?.length && !r.message) lines.push(`Blocat de: ${r.blockedBy.join(", ")}.`);
  if (r.confirmed?.plan) lines.push(`Confirmat. ${r.confirmed.plan.status === "RUNNING" ? "Planul rulează; îl vezi în bara de sus și pe card." : `Stare: ${PLAN_STATUS_LABELS[r.confirmed.plan.status] || r.confirmed.plan.status}.`}`);
  return lines;
}

/** App rows on the operator page: status words without merging states. */
export const APP_STATE_LABELS = Object.freeze({ NOT_FOUND: "negăsită", INSTALLED: "găsită, identitate neverificată", DISCOVERED: "găsită și semnată (neautorizată)", AUTHORIZED_SCOPE: "autorizată pentru operator" });
export const LEVEL_LABELS = Object.freeze({ IMPLEMENTED: "implementat", IMPLEMENTED_API: "implementat prin API", VERIFIED_GUI: "verificat în interfață", VERIFIED_API: "verificat prin API", ASSISTED_ONLY: "doar asistat (tu apeși)",
  BLOCKED_BY_OS: "blocat de Windows", UNSUPPORTED: "nesuportat", UNVERIFIED: "neverificat încă" });
