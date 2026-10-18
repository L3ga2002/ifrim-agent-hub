import { useState } from "react";
import { Play } from "lucide-react";
import { api } from "../../api.js";
import { useAction } from "../../store.js";
import { Notice, ErrorNotice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";
import { rearmRequiredOf } from "../../lib/rearmLogic.js";
import { continuationOffer, continuationPath, COCKPIT_HREF } from "../../lib/salesPrepLogic.js";
import { OpsPlanCard } from "../lega/OpsPlanCard.jsx";

/**
 * M12 final review (F1/F3/F10): how a stopped preparation (STALE / STOPPED / EXPIRED / FAILED) continues — driven by the SERVER's flags.
 *  - continuable, nothing holding it: „Pregătește continuarea” asks the Hub, in the owner session (withReauth: at most one Windows Hello),
 *    for ONE new card (POST /api/sales/preparations/:id/continue → sales.preparation.continue). The card is shown right here and confirmed
 *    once, like any plan card (OpsPlanCard → /api/ops/plans/:id/confirm); nothing runs before that, and what was done is not repeated.
 *  - „Oprește tot” still holds the gate (waitsForRearm): no button that would be refused; the rearm comes first, in the cockpit.
 *  - never confirmed (R18): a new request is the way, said plainly.
 * Nothing here approves the offer, sends, contacts or publishes anything.
 */
export function PreparationContinue({ p, onChange }) {
  const [card, setCard] = useState(null);
  const [rearm, setRearm] = useState(null);
  const offer = continuationOffer(p);
  const ask = useAction(async () => {
    setRearm(null);
    try {
      const out = await withReauth(() => api(continuationPath(p.id), { method: "POST", body: {} }));
      setCard(out?.plan || null);
      onChange?.();
      return out;
    } catch (e) {
      // The Stop All that stopped it holds the gate again (or still): the rearm comes first; not an error of the preparation.
      const need = rearmRequiredOf(e);
      if (!need) throw e;
      setRearm(need.reason);
      return null;
    }
  });
  if (card) {
    return (
      <div className="stack tight">
        <Notice tone="info" title="Cardul de continuare">Confirmă-l o dată, aici (sau în cockpit, unde apare și el). Până la confirmare nu pornește nimic; aprobarea ofertei rămâne decizia ta, separat.</Notice>
        <OpsPlanCard plan={card} card={{ type: "OpsPlan", size: "l" }} onClose={() => { setCard(null); onChange?.(); }} />
      </div>
    );
  }
  if (!offer.kind) return null;
  const rearmNotice = (text) => <Notice tone="warn" title="Întâi redeschiderea porții">{text} <a href={COCKPIT_HREF}>Deschide cockpitul</a></Notice>;
  if (offer.kind === "rearm") return rearmNotice(offer.text);
  if (offer.kind === "new") return <p className="faint small break" style={{ margin: 0 }}>{offer.text}</p>;
  return (
    <div className="stack tight">
      <p className="faint small break" style={{ margin: 0 }}>{offer.text}</p>
      {rearm && rearmNotice(rearm)}
      <div className="row wrap">
        <button type="button" className="btn primary sm" disabled={ask.pending} onClick={() => ask.run()}><Play size={14} aria-hidden="true" />{ask.pending ? "Pregătesc cardul…" : "Pregătește continuarea"}</button>
      </div>
      <ErrorNotice error={ask.error} />
    </div>
  );
}
