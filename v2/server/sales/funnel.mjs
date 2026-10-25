import { HubError } from "../core/errors.mjs";
import { provenanceOf } from "../owner/recap.mjs";
import { OPPORTUNITY_TRANSITIONS } from "./sales.mjs";

// The statuses are read from the Sales state machine (never retyped: S-08 keeps every CONTACTED / WON literal inside sales.mjs). The side
// stages are the hold and the loss; a closed opportunity is a status with no outgoing transition.
export const SIDE = Object.freeze(["ON_HOLD", "LOST"]);
export const PIPELINE = Object.freeze(Object.keys(OPPORTUNITY_TRANSITIONS).filter((status) => !SIDE.includes(status)));
export const CLOSED = Object.freeze(Object.keys(OPPORTUNITY_TRANSITIONS).filter((status) => OPPORTUNITY_TRANSITIONS[status].length === 0));
/** Romanian stage labels in PIPELINE order (pinned by a test: a new or reordered Sales status fails it instead of shifting labels). */
export const STAGE_LABELS = Object.freeze(["Identificate", "Ofertă în lucru", "De revizuit de tine", "Aprobate intern", "Contactate (de tine)", "În discuție", "Câștigate"]);
export function funnelThreshold(value = 21) { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 365) throw new HubError("validation", "Pragul trebuie să fie un număr întreg între 1 și 365 de zile"); return n; }
/** Cohorts use transition history, never ratios of current stage counts. */
export function funnelOf({ opportunities, transitions = [], proposals = [], contacts = [], drafts = [], outreach = "DISABLED", threshold = 21, now = new Date() }) {
  threshold = funnelThreshold(threshold); const end = new Date(now).getTime();
  const indexBy = (rows, field) => { const map = new Map(); for (const row of rows) { const key = row[field]; if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; };
  const history = indexBy(transitions.filter((t) => t.subject_type === "opportunity"), "subject_id");
  const proposalIndex = indexBy(proposals, "opportunity_id"); const contactIndex = indexBy(contacts, "opportunity_id"); const draftIndex = indexBy(drafts, "opportunity_id");
  const opportunitiesView = opportunities.map((o) => {
    const times = [[o.updated_at, "sales_opportunities.updated_at"], ...(history.get(o.id) || []).map((t) => [t.created_at, "sales_transitions.created_at"]), ...(contactIndex.get(o.id) || []).map((c) => [c.occurred_at, "sales_contact_events.occurred_at"]), ...(proposalIndex.get(o.id) || []).flatMap((p) => [[p.created_at, "sales_proposals.created_at"], [p.approved_at, "sales_proposals.approved_at"]]), ...(draftIndex.get(o.id) || []).map((d) => [d.updated_at, "sales_drafts.updated_at"])].filter(([at]) => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]));
    const [lastActivityAt = null, lastActivitySource = null] = times[0] || [];
    const silentDays = lastActivityAt ? Math.floor((end - Date.parse(lastActivityAt)) / 86400000) : null;
    const open = !CLOSED.includes(o.status);
    const list = open && silentDays !== null && silentDays >= threshold ? "cooling" : open && (o.status === "READY_FOR_OWNER_REVIEW" || o.next_action_at && Date.parse(o.next_action_at) <= end) ? "move_now" : null;
    return { id: o.id, title: o.title, orgName: o.orgName, status: o.status, synthetic: Boolean(o.synthetic), lastActivityAt, lastActivitySource, silentDays, nextAction: o.next_action || "", nextActionAt: o.next_action_at || null, list };
  });
  const group = (status, label) => { const rows = opportunitiesView.filter((o) => o.status === status); const synthetic = rows.filter((o) => o.synthetic).length; return { status, label, count: rows.length, real: rows.length - synthetic, synthetic }; };
  const conversions = PIPELINE.slice(0, -1).map((from, index) => {
    const to = PIPELINE[index + 1]; const cutoff = end - 90 * 86400000;
    const cohort = opportunitiesView.filter((o) => !o.synthetic).map((o) => ({ o, entered: (history.get(o.id) || []).filter((t) => t.to_status === from && Date.parse(t.created_at) >= cutoff && Date.parse(t.created_at) <= end).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0] })).filter((x) => x.entered);
    const n = cohort.length;
    const reached = cohort.filter(({ o, entered }) => (history.get(o.id) || []).some((t) => PIPELINE.indexOf(t.to_status) >= index + 1 && Date.parse(t.created_at) > Date.parse(entered.created_at) && Date.parse(t.created_at) <= end)).length;
    return { from, to, state: n >= 5 ? "ok" : "insufficient", rate: n >= 5 ? reached / n : null, cohort: { n, from: new Date(cutoff).toISOString(), to: new Date(end).toISOString() }, reason: n >= 5 ? null : opportunitiesView.length && opportunitiesView.every((o) => o.synthetic) ? "Date insuficiente: datele sunt sintetice; rate nu se calculează din ele." : "Date insuficiente: sunt necesare cel puțin 5 oportunități reale în cohortă." };
  });
  return { readAt: new Date(end).toISOString(), outreach, note: "Aici doar se înregistrează; nu se trimite nimic.", threshold: { days: threshold, rule: `Se răcește când au trecut cel puțin ${threshold} de zile întregi (perioade de 24 h) de la ultima activitate înregistrată.` }, stages: PIPELINE.map((s, i) => group(s, STAGE_LABELS[i])), side: [group("ON_HOLD", "În așteptare"), group("LOST", "Pierdute")], conversions, opportunities: opportunitiesView, lists: { moveNow: opportunitiesView.filter((o) => o.list === "move_now").map((o) => o.id), cooling: opportunitiesView.filter((o) => o.list === "cooling").map((o) => o.id) }, provenance: provenanceOf(opportunitiesView).provenance };
}
export function salesFunnel(hub, { threshold = 21, now = hub.config.now() } = {}) {
  const all = (table) => hub.db.prepare(`SELECT * FROM ${table}`).all();
  const opportunities = hub.db.prepare("SELECT o.*, g.display_name AS orgName, CASE WHEN o.synthetic = 1 OR g.synthetic = 1 THEN 1 ELSE 0 END AS synthetic FROM sales_opportunities o JOIN sales_orgs g ON g.id = o.org_id").all();
  const result = funnelOf({ opportunities, transitions: all("sales_transitions"), proposals: all("sales_proposals"), contacts: all("sales_contact_events"), drafts: all("sales_drafts"), outreach: hub.sales.overview().outreach, threshold, now });
  const counts = hub.db.prepare("SELECT o.status, COUNT(*) AS count, SUM(CASE WHEN o.synthetic = 1 OR g.synthetic = 1 THEN 1 ELSE 0 END) AS synthetic FROM sales_opportunities o JOIN sales_orgs g ON g.id = o.org_id GROUP BY o.status").all();
  for (const stage of [...result.stages, ...result.side]) { const row = counts.find((r) => r.status === stage.status); stage.count = row?.count || 0; stage.synthetic = row?.synthetic || 0; stage.real = stage.count - stage.synthetic; }
  return result;
}
