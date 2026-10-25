// One L3ga screen (2026-10-18): the pure parts of the Lega screen's panels (decisions, the offer card, the command help). Read-only
// helpers: none of them decides, confirms or starts anything.

/** What each kind of „Deciziile mele” row is, in words (the same labels as the Delivery Room's inbox). */
export const DECISION_KIND = Object.freeze({ software_bundle: "Pachet software", mission_decision: "Misiune oprită", delivery: "Livrare", sales_offer: "Ofertă de aprobat",
  // M13 „Birou intern”: the exact reply / deviz waiting for the owner's internal approval (on the L3ga screen).
  desk_support_reply: "Răspuns de suport de aprobat", desk_finance_doc: "Deviz de aprobat",
  // M15: the Hub's proposed correction of a delivery's claims had no label (the raw kind was shown).
  delivery_correction: "Corectură de confirmat" });

/** The decisions list is read again on the events that can add or remove a row. */
export const decisionsReload = (e) => /^(approval|sales|factory|delivery|envelope|ops|mission|desk)\./.test(String(e?.type || ""));

/** Examples for the help popover (they used to fill the empty conversation, taking the room of the work). */
export const COMMAND_EXAMPLES = Object.freeze([
  "Ce s-a întâmplat azi?",
  "L3ga, mod comandă",
  "Arată Vânzările",
  "Arată fișa ofertei",
  "Hai să lucrăm la …",
  "Doar arată-mi planul",
  "Ce avem azi?",
  "Ce s-a schimbat de ieri?",
  "Ce decizii am?",
  "L3ga, pregătește o ofertă demonstrativă pentru un service auto fictiv care vrea programări online",
  "Arată-mi oferta",
  "Ce lipsește?",
  "Pregătește dosarul de pornire a proiectului din oferta aprobată",
  "Caz de suport pentru Demo Livrare: clienții pot anula singuri o programare?",
  "Pregătește devizul din oferta aprobată",
  "Ce se întâmplă dacă luăm încă cinci clienți?",
  "Ține minte că…",
  "Deschide studioul",
  "La secunda 12 mută textul mai sus",
  "Arată folderul exporturilor",
  "Arată-ți fața",
  "Ecran complet",
  "Oprește tot",
]);

/** The opportunity a Sales path names (`/sales?tab=opp&id=…`), or null. */
export function salesOppFromPath(path) {
  if (typeof path !== "string" || !path.startsWith("/sales")) return null;
  const query = path.split("?")[1] || "";
  const params = new URLSearchParams(query);
  if (params.get("tab") !== "opp") return null;
  const id = params.get("id") || "";
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

/**
 * Which offer the Lega screen shows: the one the owner opened or the ones he dismissed stay his choice; otherwise the newest synthetic offer that
 * waits for his decision in „Deciziile mele” (so the decision is on the screen without being looked for). → opportunity id or null.
 */
export function offerToShow({ items = [], current = null, dismissed = [] } = {}) {
  if (current) return current;
  const gone = new Set(Array.isArray(dismissed) ? dismissed : dismissed ? [dismissed] : []);
  const waiting = (Array.isArray(items) ? items : []).filter((it) => it?.kind === "sales_offer" && it.opportunityId);
  const next = waiting.find((it) => !gone.has(it.opportunityId));
  return next ? next.opportunityId : null;
}

/**
 * The state line of the Lega screen, from real data only: an error, a sentence in flight, the voice session's phase, a plan or a
 * decision waiting, an execution running, or quiet. Never a success the Hub did not report.
 */
export function screenActivity({ busy = false, error = null, legaStatus = "off", legaPhase = "off", planWaiting = false, decisions = 0, runs = 0 } = {}) {
  if (error) return { tone: "error", text: `Eroare: ${String(error?.message || error).slice(0, 160)}` };
  if (busy) return { tone: "info", text: "Procesez cererea ta…" };
  if (legaStatus === "preparing" || legaStatus === "connecting") return { tone: "info", text: "Vocea Lega se conectează…" };
  if (legaStatus === "active") {
    if (legaPhase === "speaking") return { tone: "info", text: "Lega vorbește" };
    if (legaPhase === "user-speaking") return { tone: "info", text: "Te aud" };
    if (legaPhase === "delegating") return { tone: "info", text: "Lega procesează și predă cererea" };
    return { tone: "ok", text: "Lega te ascultă" };
  }
  if (planWaiting) return { tone: "approval", text: "Un plan așteaptă confirmarea ta" };
  if (decisions > 0) return { tone: "approval", text: decisions === 1 ? "O decizie așteaptă" : `${decisions} decizii așteaptă` };
  if (runs > 0) return { tone: "info", text: runs === 1 ? "O execuție rulează" : `${runs} execuții rulează` };
  return { tone: "neutral", text: "Liniște: nimic nu rulează" };
}
