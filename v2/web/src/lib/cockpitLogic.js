// Cockpit logic (M06 §06, §12, §13, §19): pure functions shared by the Lega screen and its tests. Every sentence Lega shows
// here is built from data the Hub returned; nothing is invented (no progress percentage, no test count that was not measured).

export const STATE_TONE = Object.freeze({ NO_CONTEXT: "neutral", CONTEXT_AVAILABLE: "neutral", PLAN_READY: "info", PLAN_BLOCKED: "warn", BLOCKED_BY_ISOLATION: "warn",
  AUTHORIZED: "ok", RUNNING: "info", WAITING_OWNER: "approval", READY_FOR_REVIEW: "ok" });

/** Local face commands never go to the Hub as effects: they change only the view. */
export function faceCommand(steps = []) {
  for (const s of steps) {
    if (s.intent === "face_show") return { shape: "FACE", hidden: false };
    if (s.intent === "face_core") return { shape: "CORE", hidden: false };
    if (s.intent === "face_discreet") return { discreet: true };
    if (s.intent === "face_hide") return { hidden: true };
    if (s.intent === "show_company" || s.intent === "zoom") return { shape: "GRAPH", hidden: false };
  }
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A short spoken/written summary of a project cockpit, from its data only. */
export function cockpitSummary(c) {
  if (!c) return "";
  const parts = [`${c.project.name}: ${c.state.label.toLowerCase()}.`];
  if (c.running.missions.length) parts.push(`Rulează ${c.running.missions.map((m) => `„${m.title}” (${m.stage})`).join(", ")}.`);
  if (c.readyForReview.length) parts.push(`${plural(c.readyForReview.length, "livrare așteaptă", "livrări așteaptă")} verificarea ta.`);
  if (c.blocked.length) parts.push(`${plural(c.blocked.length, "misiune așteaptă", "misiuni așteaptă")} o decizie.`);
  if (c.done.length) parts.push(`Terminat cu dovezi: ${c.done.slice(0, 2).map((d) => `„${d.title}”`).join(", ")}${c.done.length > 2 ? ` și încă ${c.done.length - 2}` : ""}.`);
  if (c.next?.recommended) parts.push(`Următorul pas: ${c.next.recommended.text}.`);
  if (c.isolation.blockers.length && c.project.kind === "real") parts.push("Execuția pe acest proiect rămâne blocată de izolare.");
  if (c.missing.length && !c.done.length && !c.open.length) parts.push(`Lipsește: ${c.missing[0].toLowerCase()}.`);
  return parts.join(" ");
}

/** Lega's reply to one sentence, built from the results of its steps. */
/** M08: one or two spoken-style lines for each company-intelligence answer (the card shows the rest). */
export function intelLines(r) {
  const out = [];
  if (r.incident?.incident) out.push(`Am deschis un incident PROPUS: „${r.incident.incident.title.replace(/^Raport: /, "")}”. Nu am oprit și nu am schimbat nimic. Spune-mi ce vezi exact și de când.`);
  if (r.changes) out.push(r.changes.items.length ? `De la ${r.changes.sinceSource}: ${r.changes.items.length} schimbări (${[...new Set(r.changes.items.map((i) => i.kind))].join(", ")}).` : r.changes.note);
  if (r.impact) out.push(r.impact.components.length ? `Componente: ${r.impact.components.join(", ")}; ${r.impact.known.history.length} schimbări anterioare, ${r.impact.known.incidents.length} incidente legate de ele.` : r.impact.unknowns[0]);
  if (r.why) out.push(r.why.found ? `Am găsit ${r.why.decisions.length + r.why.board.length} decizii înregistrate.` : r.why.note);
  if (r.blocked?.blocked) out.push(`Lanțul blocajului: ${r.blocked.chain.filter((c) => c.kind !== "attention").slice(0, 2).map((c) => c.what).join(" → ")}.`);
  else if (r.blocked?.chain?.length) out.push(`Nimic nu blochează proiectul; de urmărit: ${r.blocked.chain.slice(0, 2).map((c) => c.what).join(" · ")}.`);
  if (r.board) { const m = r.board.meeting || r.board; out.push(m.current ? `Ședința: ${m.current.title} (${m.remaining} rămase).` : "Ședința e deschisă."); }
  if (r.simulation) { const res = r.simulation.result; out.push(res.status === "COMPUTED" ? `SIMULARE: ${res.result.single ? `utilizare ${res.result.single.utilizationPct}%, ${res.result.single.weeksNeeded} săptămâni necesare` : "intervalul optimist–pesimist e pe card"}.` : `Ca să calculez scenariul îmi lipsesc: ${res.missing.map((m) => m.label).join(", ")}.`); }
  if (r.league) out.push(r.league.verdict === "INSUFFICIENT_EVIDENCE" ? "Nu am destule date pentru un clasament; nu declar un câștigător." : `Liga: ${r.league.groups.length} grupe comparabile.`);
  if (r.lesson) out.push(r.lesson.refused ? r.lesson.reason : `Am înțeles: ${r.lesson.lesson.parsed.trigger ? `${r.lesson.lesson.parsed.trigger}: ` : ""}${r.lesson.lesson.parsed.steps.join(", ")}. Devine regulă după ce o confirmi.`);
  if (r.forget) out.push(r.forget.effect || r.forget.question || r.forget.note);
  if (r.today) out.push(r.today.headline.length ? `Azi: ${r.today.headline.slice(0, 3).map((h) => h.title).join(" · ")}.` : "Azi nu e nimic care să ceară atenția ta.");
  if (r.decisions) out.push(r.decisions.length || r.packages?.length ? `Te așteaptă ${r.decisions.length + (r.packages?.length || 0)} decizii.` : "Nicio decizie în așteptare.");
  if (r.objectives) out.push(r.objectives.length ? `${r.objectives.length} obiective pe proiect.` : "Niciun obiectiv pe acest proiect.");
  if (r.view === "stage") out.push("Ecran complet.");
  if (r.view === "cockpit") out.push("Înapoi la cockpit.");
  if (r.startView) out.push(r.startView === "stage" ? "La pornire deschid ecranul complet." : "La pornire deschid cockpit-ul.");
  if (r.armed?.armed) out.push("Fereastra vocală e deschisă: spune „Da, execută planul”.");
  return out.filter(Boolean);
}

export function replyFor(response) {
  if (!response) return "";
  const { resolved, results = [] } = response;
  const lines = [];
  if (resolved?.clarification) lines.push(resolved.clarification.question);
  for (const refused of resolved?.refused || []) lines.push(`Nu: ${refused.reason}.`);
  for (const r of results) {
    if (r.error) { lines.push(`Nu am putut: ${r.error.message}`); continue; }
    if (r.refused) { lines.push(r.refused); continue; }
    if (r.message) { lines.push(r.message); continue; }
    if (r.cockpit) lines.push(cockpitSummary(r.cockpit));
    if (r.plan) {
      if (r.plan.error) lines.push(`Nu pot pregăti planul: ${r.plan.error}`);
      else if (r.plan.summary) lines.push(`Planul: ${r.plan.summary.headline}. ${r.plan.summary.state === "PLAN_READY" ? "Îl vezi în dreapta; nimic nu a pornit." : `Execuția e blocată: ${(r.plan.summary.blockers || []).slice(0, 2).join(" · ")}`}`);
      if (r.note) lines.push(r.note);
    }
    if (r.confirmed?.envelope) lines.push(`Confirmat. ${r.confirmed.envelope.status === "ACTIVE" ? "Misiunea a pornit; urmărește graful." : `Stare: ${r.confirmed.envelope.status}.`}`);
    if (r.explain) {
      if (r.explain.runs) lines.push(r.explain.idle ? "Acum nu rulează nimic." : r.explain.runs.map((x) => `${x.provider} (${x.stage || "—"}, ${x.environment}): ${x.phase}${x.stale ? `; fără activitate de ${x.quietS} s` : ""}`).concat(r.explain.missions.map((m) => `„${m.title}”: ${m.stage}${m.reason ? ` — ${m.reason}` : ""}`)).join(" · "));
      else if (r.explain.items) lines.push(r.explain.items.length ? r.explain.items.map((i) => `${i.what}: ${i.rule} → ${i.action}`).slice(0, 3).join(" · ") : "Nimic nu e blocat.");
      else if (r.explain.reason) lines.push(r.explain.reason);
    }
    if (r.replay) lines.push(r.replay.firstFailure ? `Prima eroare: ${r.replay.firstFailure.title} — ${r.replay.firstFailure.detail}` : "Reluarea nu arată nicio eroare.");
    if (r.delta) lines.push(r.delta.firstVisit ? "E prima vizită înregistrată; îți arăt starea de acum." : `De la ultima vizită: ${r.delta.events} evenimente, ${r.delta.deliveries} livrări gata, ${r.delta.blocked} blocaje, ${r.delta.runs.failed} execuții eșuate.`);
    if (r.interrupt?.summary) lines.push(r.interrupt.summary);
    if (r.prefs) lines.push(r.prefs.onlyDecisions ? "Bine: te întrerup doar pentru decizii și riscuri." : "Notificările revin la normal.");
    if (r.autonomy) lines.push(`Nivelul de autonomie e acum ${r.autonomy.level}.`);
    if (r.recommendations) lines.push(r.recommendations.items.length ? r.recommendations.items.map((x) => x.title).slice(0, 2).join(" · ") : "Nu am recomandări susținute de istoricul tău.");
    if (r.companyMap) lines.push(`Compania: ${r.companyMap.departments.length} departamente, ${r.companyMap.activeRuns} execuții active acum.`);
    lines.push(...intelLines(r));
  }
  const face = faceCommand(resolved?.steps || []);
  if (face?.shape === "FACE") lines.push("Aceasta e fața mea: linii și particule, nu chipul cuiva.");
  if (face?.shape === "CORE" && !lines.length) lines.push("Am revenit la nucleu.");
  if (face?.hidden) lines.push("Am ascuns fața.");
  if (!lines.length) lines.push(resolved?.steps?.some((s) => s.intent === "unknown") ? "Nu am înțeles. Încearcă „Hai să lucrăm la …”, „Arată-mi planul”, „Ce face acum?”, „Oprește tot”." : "Gata.");
  return lines.filter(Boolean).join("\n");
}

/** The plan the cockpit is currently presenting (only that one can be confirmed, by its id + nonce + hash). */
export function presentedFrom(envelope) {
  if (!envelope?.id || envelope.status !== "PROPOSED") return null;
  return { envelopeId: envelope.id, nonce: envelope.nonce, hash: envelope.envelopeHash };
}

/** Bounded layout history for "undo" (UI-only; never authority). */
export function pushLayout(history, layout, max = 20) { return [...history.slice(-(max - 1)), layout]; }

/** Stage path of a factory mission with the environment where each stage ACTUALLY ran (from evidence and runs). */
export function missionGraph(view) {
  if (!view) return [];
  const ev = (stage) => view.evidence.filter((e) => e.stage === stage && !e.stale);
  const where = (rows, fallback) => (rows.length ? (/@wsl-runner/.test(rows[rows.length - 1].runner || "") || /bwrap/.test(rows[rows.length - 1].isolation || "") ? "ifrim-runner" : "Windows") : fallback);
  const status = (rows) => (!rows.length ? "WAITING" : rows.some((r) => r.status === "FAIL") ? "FAILED" : rows.some((r) => r.status === "BLOCKED") ? "BLOCKED" : rows.every((r) => r.status === "PASS") ? "DONE" : "RUNNING");
  const runStatus = (rows) => (!rows.length ? "WAITING" : rows.some((r) => ["running", "starting"].includes(r.status)) ? "RUNNING" : rows.some((r) => r.status === "failed") ? "FAILED" : rows.some((r) => r.status === "completed") ? "DONE" : "BLOCKED");
  const writer = view.runs.filter((r) => r.provider === "codex");
  const reviewer = view.runs.filter((r) => r.provider === "claude");
  return [
    { key: "spec", label: "Specificație", status: view.factory.approvedSpecVersion ? "DONE" : "WAITING", where: "Hub" },
    { key: "baseline", label: "Baseline", status: status(ev("BASELINE")), where: where(ev("BASELINE"), "—") },
    { key: "writer", label: "Codex (writer)", status: runStatus(writer), where: writer.length ? (writer[writer.length - 1].environment === "wsl-runner" ? "ifrim-runner" : "Windows") : "—" },
    { key: "checks", label: "Verificări", status: status(ev("CHECKING")), where: where(ev("CHECKING"), "—") },
    { key: "review", label: "Claude (review)", status: runStatus(reviewer), where: reviewer.length ? "Windows (graniță de unealtă)" : "—" },
    { key: "qa", label: "QA", status: status(ev("QA")), where: where(ev("QA"), "—") },
    { key: "preview", label: "Preview", status: status(ev("PREVIEW")), where: where(ev("PREVIEW"), "—") },
    { key: "e2e", label: "E2E", status: status(ev("E2E")), where: ev("E2E").length ? (ev("E2E")[0].runner === "playwright@wsl-runner" ? "ifrim-runner" : "Windows (browser)") : "—" },
    { key: "delivery", label: "Livrare", status: ["DELIVERY_READY", "ACCEPTED"].includes(view.factory.stage) ? "DONE" : view.factory.stage === "REJECTED" ? "FAILED" : "WAITING", where: "Hub" },
  ];
}
