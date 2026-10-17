// M12 final review C2 — what the cockpit does with the Hub's Sales answers (pure; Lega.jsx uses it). „Arată-mi oferta” opens the offer's
// opportunity (that screen IS the answer); „Ce lipsește?” and „Aprobă oferta” are answers in words: they stay in the conversation and the
// offer's screen is offered as a button next to them — a navigation never takes the answer away (the conversation is the cockpit's own
// state, lost when the screen changes).

/** The label of the button that opens the offer from a kept answer. */
export const SALES_OPEN_LABEL = "Deschide oferta în Vânzări";

/**
 * → { go: path | null, links: [{ path, label }] } for the step results of ONE sentence: `go` only for an offer shown with nothing else to
 * read („Arată-mi oferta”); every other Sales path is a link next to the answer.
 */
export function salesNavigation(results = []) {
  const list = Array.isArray(results) ? results : [];
  const sales = list.filter((r) => typeof r?.navigate === "string" && r.navigate.startsWith("/sales"));
  const answered = list.some((r) => (r?.intent === "sales_missing" || r?.intent === "sales_approve_talk") && r.message);
  const go = answered ? null : sales.find((r) => r.intent === "sales_show")?.navigate || null;
  const links = [];
  for (const r of sales) if (r.navigate !== go && !links.some((l) => l.path === r.navigate)) links.push({ path: r.navigate, label: SALES_OPEN_LABEL });
  return { go, links };
}
