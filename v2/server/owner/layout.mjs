import { HubError } from "../core/errors.mjs";

/**
 * ContextualUIComposer (M06 §13): which safe, existing components the cockpit shows and in what order. The model (or a local
 * intent) may PROPOSE a layout, but only as this schema: a card type from the catalog plus a reference to data the Hub
 * already has (project, mission, envelope, run, department). The UI resolves the data itself from the API; a layout never
 * carries numbers, text to render as results, HTML, scripts, URLs or actions. Changing the layout never approves anything.
 */
export const CARD_TYPES = Object.freeze({
  ProjectSummary: { refs: ["project"], label: "Rezumatul proiectului" },
  NextStepCard: { refs: ["project"], label: "Următorul pas" },
  MissionPlan: { refs: ["project", "mission", "envelope"], label: "Planul (fără execuție)" },
  DecisionCard: { refs: ["envelope", "project"], label: "Decizia ta" },
  AgentGraph: { refs: ["project", "mission"], label: "Agenți și execuții" },
  EnvironmentCard: { refs: ["project"], label: "Medii și izolare" },
  DiffPanel: { refs: ["mission"], label: "Ce s-a schimbat" },
  TestPanel: { refs: ["mission"], label: "Teste și verificări" },
  ReviewPanel: { refs: ["mission"], label: "Review" },
  Timeline: { refs: ["mission", "project"], label: "Cronologie" },
  Replay: { refs: ["mission"], label: "Reluare (doar citire)" },
  Preview: { refs: ["mission"], label: "Preview" },
  Briefing: { refs: ["project", "company"], label: "Ce s-a schimbat" },
  Explain: { refs: ["project", "mission"], label: "Explicație" },
  CompanyMap: { refs: ["company", "department"], label: "Harta companiei" },
});
const SIZES = new Set(["s", "m", "l"]);
const MAX_CARDS = 8;
const ID_RE = /^[a-z]{2,5}_[a-z0-9]{4,12}_[0-9a-f]{6,12}$|^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Validates a proposed layout against the catalog and the Hub's data. `exists(kind, id)` answers whether the referenced
 * object exists AND belongs to the cockpit's project (missions/envelopes of another project are refused).
 */
export function validateLayout(input, { projectId, exists }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HubError("validation", "Layout invalid");
  const cards = Array.isArray(input.cards) ? input.cards : [];
  if (cards.length > MAX_CARDS) throw new HubError("validation", `Cel mult ${MAX_CARDS} carduri`);
  const out = []; const problems = [];
  const seen = new Set();
  for (const [i, card] of cards.entries()) {
    if (!card || typeof card !== "object") { problems.push(`card ${i}: invalid`); continue; }
    const extra = Object.keys(card).filter((k) => !["type", "ref", "size", "pinned"].includes(k));
    if (extra.length) { problems.push(`card ${i}: câmpuri nepermise (${extra.join(", ")})`); continue; }
    const def = Object.hasOwn(CARD_TYPES, card.type) ? CARD_TYPES[card.type] : null;
    if (!def) { problems.push(`card ${i}: tip necunoscut`); continue; }
    const ref = card.ref && typeof card.ref === "object" ? card.ref : { kind: def.refs[0], id: def.refs[0] === "company" ? "company" : projectId };
    if (!def.refs.includes(ref.kind)) { problems.push(`card ${i}: ${card.type} nu acceptă referința ${String(ref.kind).slice(0, 20)}`); continue; }
    const id = String(ref.id ?? "");
    if (ref.kind !== "company" && !ID_RE.test(id)) { problems.push(`card ${i}: id invalid`); continue; }
    if (ref.kind === "project" && id !== projectId) { problems.push(`card ${i}: alt proiect`); continue; }
    if (!["company"].includes(ref.kind) && !exists(ref.kind, id)) { problems.push(`card ${i}: ${ref.kind} inexistent sau din alt proiect`); continue; }
    const key = `${card.type}:${ref.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: card.type, ref: { kind: ref.kind, id: ref.kind === "company" ? "company" : id }, size: SIZES.has(card.size) ? card.size : "m", pinned: card.pinned === true });
  }
  if (problems.length && !out.length) throw new HubError("validation", `Layout refuzat: ${problems.slice(0, 4).join("; ")}`);
  return { version: 1, focus: input.focus === true, cards: out, problems };
}

/** The default cockpit layout for a project, from its state (deterministic; no model). */
export function defaultLayout(cockpit) {
  const pid = cockpit.project.id;
  const cards = [{ type: "ProjectSummary", ref: { kind: "project", id: pid }, size: "m", pinned: true }, { type: "NextStepCard", ref: { kind: "project", id: pid }, size: "m", pinned: false }];
  if (cockpit.proposedPlan) cards.push({ type: "DecisionCard", ref: { kind: "envelope", id: cockpit.proposedPlan.envelopeId }, size: "l", pinned: false });
  if (cockpit.running.missions[0]) cards.push({ type: "AgentGraph", ref: { kind: "mission", id: cockpit.running.missions[0].missionId }, size: "l", pinned: false });
  const focusMission = cockpit.running.missions[0]?.missionId || cockpit.readyForReview[0]?.missionId || cockpit.blocked[0]?.missionId || null;
  if (focusMission && !cockpit.running.missions[0]) cards.push({ type: "TestPanel", ref: { kind: "mission", id: focusMission }, size: "m", pinned: false });
  cards.push({ type: "EnvironmentCard", ref: { kind: "project", id: pid }, size: "s", pinned: false });
  return { version: 1, focus: false, cards };
}

/** How one resolved intent step changes the layout (adds or focuses the matching card); returns null when nothing changes. */
export function layoutForIntent(step, cockpit, current) {
  const pid = cockpit?.project?.id;
  const mission = step.args?.missionId || cockpit?.running?.missions?.[0]?.missionId || cockpit?.readyForReview?.[0]?.missionId || cockpit?.blocked?.[0]?.missionId || cockpit?.open?.[0]?.missionId || null;
  const base = current?.cards ? current : defaultLayout(cockpit);
  const add = (type, ref, size = "l") => {
    const cards = base.cards.filter((c) => !(c.type === type && c.ref.id === ref.id));
    return { ...base, focus: false, cards: [{ type, ref, size, pinned: false }, ...cards.filter((c) => c.pinned), ...cards.filter((c) => !c.pinned)].slice(0, MAX_CARDS) };
  };
  switch (step.intent) {
    case "show_changes": return mission ? add("DiffPanel", { kind: "mission", id: mission }) : null;
    case "show_tests": return mission ? add("TestPanel", { kind: "mission", id: mission }) : null;
    case "show_review": return mission ? add("ReviewPanel", { kind: "mission", id: mission }) : null;
    case "show_preview": return mission ? add("Preview", { kind: "mission", id: mission }) : null;
    case "replay": return mission ? add("Replay", { kind: "mission", id: mission }) : null;
    case "status": case "why_blocked": case "why_route": return add("Explain", mission ? { kind: "mission", id: mission } : { kind: "project", id: pid }, "m");
    // The plan just prepared is shown as the decision card (the one confirmable plan); without one, the list of prepared missions.
    // M08: a plan over an objective is the same confirmable decision card (review M08: it was created but never shown).
    case "show_plan": case "continue_work": case "objective_plan": return step.args?.envelopeId ? add("DecisionCard", { kind: "envelope", id: step.args.envelopeId }) : add("MissionPlan", { kind: "project", id: pid });
    case "briefing": case "continue_last": return add("Briefing", { kind: "project", id: pid }, "m");
    case "focus": return { ...base, focus: true, cards: base.cards.filter((c) => ["ProjectSummary", "NextStepCard", "DecisionCard"].includes(c.type) || c.pinned) };
    default: return null;
  }
}
