// M12 Sales (S-07): the Hub's own answers to the owner's offer questions — „Arată-mi oferta”, „Ce lipsește?”, „Aprobă oferta” — read from
// the latest synthetic preparation and its offer (sales/preparation.mjs, sales/sales.mjs). Reads only: nothing is written, approved,
// requested, sent or started here. The same answers serve the typed cockpit, the owner's voice (intake) and Lega's read tool
// (lega.sales_preparation, voice-first only). The approval of the offer stays the owner's own decision, in Vânzări → Oportunitate, on the
// exact id + full SHA; this module only says where and what.

const clip = (v, n = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** Where the opportunity of an offer is shown (the Sales screen, its opportunity tab). */
export const salesOpportunityPath = (opportunityId) => `/sales?tab=opp&id=${encodeURIComponent(String(opportunityId || ""))}`;

/** A preparation's status, said to the owner (Romanian, short). */
export const PREPARATION_STATUS_RO = Object.freeze({
  PLANNED: "planul așteaptă confirmarea ta (nimic nu a pornit)", PREPARING: "se pregătește (fără model; nimic nu pleacă din calculator)",
  WAITING_OWNER: "oferta e gata de revizuirea ta și așteaptă aprobarea ta internă", PACKAGING: "ai aprobat oferta; se fac ciorna netrimisă și dosarul ofertei",
  READY: "dosarul ofertei e gata, local; nimic trimis", STALE: "oprită: oferta sau intrările ei s-au schimbat", STOPPED: "oprită (de exemplu după „Oprește tot”)",
  EXPIRED: "expirată (fereastra planului confirmat a trecut)", CANCELLED: "anulată", FAILED: "oprită de o eroare",
});
const PROPOSAL_STATUS_RO = Object.freeze({ DRAFT: "ciornă, neaprobată", APPROVED_INTERNAL: "aprobată intern de tine (nu e trimisă)", SUPERSEDED: "înlocuită de o versiune mai nouă",
  STALE: "depășită: intrările ei s-au schimbat" });
const CONTINUE_HINT = "O continuare cere un card nou, pe care îl confirmi o dată („Continuă pregătirea ofertei”).";
/** Last review round (RR7 / RR12, R18): a card the owner never confirmed has nothing to continue — a new request is the way. */
export const NEVER_CONFIRMED_HINT = "Cardul ei inițial nu a fost confirmat niciodată, deci nu are ce continua: o cerere nouă („pregătește o ofertă pentru …”) e calea.";
/** RR7 / RR12 (C2): the Stop All that stopped it still holds the gate — the rearm comes first, in the cockpit. */
export const REARM_FIRST_HINT = "„Oprește tot” a oprit-o și poarta e încă oprită: întâi redeschizi poarta din cockpit (cardul „Redeschide poarta”, cu Windows Hello); abia apoi o continuare („Continuă pregătirea ofertei”) cere un card nou, pe care îl confirmi o dată.";
const CONTINUABLE_STATUSES = ["STALE", "STOPPED", "EXPIRED", "FAILED"];

export function createSalesAnswers({ sales, preparations, opsPlans = null }) {
  /**
   * What the owner can do next with a preparation, from the server's own flags (RR7 / RR12: isContinuable — R18 — and stopHold — C2; RC3:
   * a running preparation whose phase plan is paused or waits for him) — never a continuation the server would refuse.
   * → { text, waitsForRearm, paused, planId? } | null
   */
  function nextOf(p) {
    if (!p) return null;
    if (CONTINUABLE_STATUSES.includes(p.status)) {
      if (preparations.isContinuable && !preparations.isContinuable(p)) return { text: NEVER_CONFIRMED_HINT, waitsForRearm: false, paused: false };
      const hold = preparations.stopHold ? preparations.stopHold(p) : null;
      if (hold) return { text: REARM_FIRST_HINT, waitsForRearm: true, paused: false };
      return { text: CONTINUE_HINT, waitsForRearm: false, paused: false };
    }
    const planId = p.status === "PACKAGING" && p.phaseBPlanId ? p.phaseBPlanId : p.planId;
    let plan = null;
    try { plan = planId && opsPlans?.view ? opsPlans.view(planId) : null; } catch { plan = null; }
    if (plan && ["PAUSED", "NEEDS_OWNER"].includes(plan.status)) {
      const held = preparations.planStopHold ? preparations.planStopHold(plan) : null;
      return { text: held ? "Planul pregătirii e oprit și poarta e încă oprită de „Oprește tot”: întâi o redeschizi din cockpit (cardul „Redeschide poarta”), apoi îl reiei cu „Continuă”."
        : `Planul pregătirii e oprit (${plan.status === "PAUSED" ? "pus pe pauză" : "așteaptă decizia ta"}): îl reiei cu „Continuă”; nimic nu se reia singur.`, waitsForRearm: Boolean(held), paused: true, planId: plan.id };
    }
    return null;
  }
  /**
   * The preparation the answers are about (M12 final review C3; last review round RR8): the one the owner is working on — the conversation's
   * last Sales target (`preparationId`: the card or the continuation card just shown or confirmed) — else the most recently changed one (a
   * card just proposed — PLANNED, no offer yet — or an older preparation just continued), never a newer unrelated offer. Only a card that
   * never started and is gone (cancelled or expired before any step: no company, no offer) is skipped. With its opportunity view; null when none exists.
   */
  function latest({ preparationId = null } = {}) {
    if (!preparations?.list) return null;
    const list = preparations.list();
    const live = (x) => x.opportunityId || !["CANCELLED", "EXPIRED"].includes(x.status);
    const named = preparationId ? list.find((x) => x.id === preparationId && live(x)) : null;
    const changed = (x) => String(x.updatedAt || x.createdAt || "");
    const byChange = [...list].sort((a, b) => changed(b).localeCompare(changed(a)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const p = named || byChange.find(live) || null;
    if (!p) return null;
    let view = null;
    try { view = p.opportunityId ? sales.getOpportunity(p.opportunityId) : null; } catch { view = null; }
    const proposal = view?.proposals?.[0] || null;
    const dossier = p.opportunityId && preparations.forOpportunity ? preparations.forOpportunity(p.opportunityId).dossiers[0] || null : null;
    return { p, view, proposal, dossier };
  }
  /** The facts every answer carries (ids, version, the FULL sha, statuses; never a contact value). */
  const factsOf = ({ p, view, proposal, dossier }) => ({ preparationId: p.id, preparationStatus: p.status, opportunityId: p.opportunityId || null,
    // RR7 / RR12: the server's own flags (additive, contract 15).
    continuable: Boolean(preparations.isContinuable?.(p)), waitsForRearm: Boolean(nextOf(p)?.waitsForRearm),
    opportunityStatus: view?.opportunity?.status || null, synthetic: true,
    proposal: proposal ? { id: proposal.id, version: proposal.version, sha: proposal.contentSha, status: proposal.status, approvedSha: proposal.approvedSha || null } : null,
    dossier: dossier ? { id: dossier.id, revision: dossier.revision, status: dossier.status, manifestSha256: dossier.manifestSha256 || null, app: dossier.verification?.proposalDocx?.app || null } : null });
  const none = () => ({ message: "Nu am încă o ofertă pregătită. Spune „pregătește o ofertă pentru …” (de exemplu: pregătește o ofertă pentru un service auto din Cluj care vrea programări online) și îți arăt un singur plan.", sales: null });
  const planned = (l) => {
    const next = nextOf(l.p);
    return { message: `Pregătirea ofertei: ${PREPARATION_STATUS_RO[l.p.status] || l.p.status}. Oferta nu există încă.${next ? ` ${next.text}` : ""}`, sales: factsOf(l), ...(next?.waitsForRearm ? { waitsForRearm: true } : {}) };
  };

  /** „Arată-mi oferta”: the latest offer (id, version, full SHA, status), where it is, and what its preparation is doing. */
  function show(opts = {}) {
    const l = latest(opts);
    if (!l) return none();
    if (!l.proposal) return planned(l);
    const { p, proposal, dossier } = l;
    const parts = [`Oferta sintetică v${proposal.version} (${proposal.id}), SHA ${proposal.contentSha}: ${PROPOSAL_STATUS_RO[proposal.status] || proposal.status}.`,
      `Pregătirea: ${PREPARATION_STATUS_RO[p.status] || p.status}.`];
    if (dossier) parts.push(`Dosarul ofertei, revizia ${dossier.revision}: ${dossier.status}${dossier.manifestSha256 ? ` (manifest SHA ${dossier.manifestSha256})` : ""}; ciorna e DRAFT_ONLY, netrimisă.`);
    const next = nextOf(p);
    if (next) parts.push(next.text);
    parts.push("Ți-o deschid în Vânzări → Oportunitate.");
    return { message: parts.join(" "), navigate: salesOpportunityPath(p.opportunityId), sales: factsOf(l), ...(next?.waitsForRearm ? { waitsForRearm: true } : {}) };
  }

  /** „Ce lipsește?”: what the brief did not say, what q-v2 could not score, the unknown prices and the owner's pending decision. */
  function missing(opts = {}) {
    const l = latest(opts);
    if (!l) return none();
    const { p, view, proposal } = l;
    const parts = [];
    const brief = (p.brief?.missing || []).filter((m) => m && m.field !== "catalog" && m.field !== "intent").map((m) => clip(m.text, 80)).filter(Boolean);
    if (brief.length) parts.push(`Din cererea ta lipsesc: ${brief.join(", ")}.`);
    const q = view?.org?.id && sales.latestQualification ? sales.latestQualification(view.org.id) : null;
    const qMissing = (q?.result?.missing || []).map((x) => clip(typeof x === "string" ? x : x?.text || x?.claim || "", 100)).filter(Boolean);
    if (qMissing.length) parts.push(`Calificarea ${q.formulaVersion || "q-v2"} (inferențele nu primesc puncte): ${qMissing.slice(0, 8).join("; ")}.`);
    const unknown = (proposal?.content?.pricing || []).filter((x) => x?.status === "UNKNOWN");
    if (unknown.length || proposal) parts.push(unknown.length ? "Prețul și termenul: De stabilit (neconfigurat) — catalogul de servicii nu e configurat, deci nu pun nicio sumă."
      : "Prețurile vin doar din catalogul configurat.");
    if (p.status === "WAITING_OWNER" && proposal?.status === "DRAFT") {
      parts.push(`Aprobarea ta internă a ofertei v${proposal.version} (${proposal.id}, SHA ${proposal.contentSha}): o dai tu, în Vânzări → Oportunitate, cu „Aprob intern”; eu nu o pot da.`);
    } else if (p.status === "PLANNED") parts.push("Confirmarea planului de pregătire (cardul din cockpit).");
    const next = nextOf(p);
    if (CONTINUABLE_STATUSES.includes(p.status)) parts.push(`Pregătirea e ${PREPARATION_STATUS_RO[p.status]}. ${next?.text || CONTINUE_HINT}`);
    else if (next?.paused) parts.push(next.text);
    if (!parts.length) parts.push("Nu lipsește nimic din ce pot verifica eu; prețurile rămân „De stabilit” până configurezi catalogul.");
    return { message: parts.join(" ").slice(0, 1500), navigate: p.opportunityId ? salesOpportunityPath(p.opportunityId) : null, sales: { ...factsOf(l), missing: { brief, qualification: qMissing, unknownPrices: unknown.length } },
      ...(next?.waitsForRearm ? { waitsForRearm: true } : {}) };
  }

  /** „Aprobă oferta”: never an approval — where the owner gives it, on the exact id + full SHA. Nothing is requested or created. */
  function approveTalk(opts = {}) {
    const l = latest(opts);
    const never = "Eu nu aprob oferta și nu am creat nicio aprobare: aprobarea internă e decizia ta.";
    if (!l) return { message: `${never} ${none().message}`, sales: null };
    // C3: the newest preparation has no offer yet; an OLDER one may still wait for the owner's approval — named as the older one.
    if (!l.proposal) return { message: `${never} ${planned(l).message}${olderWaiting(l.p)}`, sales: factsOf(l) };
    const { p, proposal, view } = l;
    const waiting = proposal.status === "DRAFT" && view?.opportunity?.status === "READY_FOR_OWNER_REVIEW";
    const where = waiting
      ? `O dai în Vânzări → Oportunitate, pe ținta exactă — oferta v${proposal.version}, id ${proposal.id}, SHA ${proposal.contentSha} — cu butonul „Aprob intern”, în sesiunea ta de proprietar. Aprobarea nu trimite nimic și nu marchează CONTACTED sau WON.`
      : proposal.status === "APPROVED_INTERNAL" ? `Oferta v${proposal.version} (${proposal.id}) e deja aprobată intern de tine; nu e trimisă.`
        : `Oferta v${proposal.version} nu așteaptă acum aprobarea (${PROPOSAL_STATUS_RO[proposal.status] || proposal.status}; pregătirea: ${PREPARATION_STATUS_RO[p.status] || p.status}).`;
    return { message: `${never} ${where}`, navigate: salesOpportunityPath(p.opportunityId), sales: factsOf(l) };
  }

  /** An older preparation still waiting for the owner's approval of its exact offer (named as the older one), or "". */
  function olderWaiting(newest) {
    const other = preparations.list().find((x) => x.id !== newest?.id && x.status === "WAITING_OWNER" && x.opportunityId);
    if (!other) return "";
    let proposal = null;
    try { proposal = sales.getOpportunity(other.opportunityId)?.proposals?.[0] || null; } catch { proposal = null; }
    if (!proposal || proposal.status !== "DRAFT") return "";
    return ` O ofertă mai veche (pregătirea ${other.id}) așteaptă aprobarea ta: v${proposal.version} (${proposal.id}, SHA ${proposal.contentSha}); o aprobi în Vânzări → Oportunitate, pe ținta ei exactă.`;
  }

  /** Lega's voice-first read (lega.sales_preparation): the offer and what is missing, in one bounded text. */
  function legaText() {
    const a = show();
    if (!a.sales?.proposal) return `${a.message} Trimiterea, contactarea și publicarea sunt dezactivate (OUTREACH_DISABLED).`;
    return `${a.message.replace(/ Ți-o deschid în Vânzări → Oportunitate\.$/, "")} ${missing().message} Trimiterea, contactarea și publicarea sunt dezactivate (OUTREACH_DISABLED).`.slice(0, 2400);
  }

  return { latest, show, missing, approveTalk, legaText, nextOf };
}
