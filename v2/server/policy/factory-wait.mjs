/**
 * 2.12.2 (review F6): what a Software Factory mission waits for, in the owner's words, on the SERVER surfaces (the cockpit's „De ce e
 * blocat?” list and Lega's mission_detail tool, which the voice may say aloud). The same texts as the web's factoryWaitLabel
 * (web/src/lib/uiLogic.js; v2/tests/m10-2-p0r9-review-fixes.test.mjs keeps the two identical), so no surface ever shows or says the raw
 * value („retry”, „owner_decision”). Pure; no database.
 */
export const FACTORY_WAIT_REASONS = Object.freeze(["approval", "grant", "gate", "provider", "runner", "owner_decision", "cancel", "retry"]);

/** The label for a factory waitReason (and the mission's stage, which refines two of them), or null for none / an unknown value. */
export function factoryWaitText(waitReason, stage = null) {
  switch (waitReason) {
    case "approval": return "Așteaptă aprobarea ta (comandă sau modificare cerută de model)";
    case "grant": return "Așteaptă un grant (fără grant nu pornește niciun model)";
    case "gate": return "Așteaptă poarta de execuție (mod, poartă, izolare sau facturare)";
    case "provider": return "Modelul lucrează (urmărește cronologia execuției)";
    case "runner": return stage === "BLOCKED" ? "Runner-ul sau browserul nu au putut rula (fără model); remediază cauza, apoi Reia" : "Runner-ul Hub rulează verificările (fără model)";
    case "owner_decision": return stage === "SPEC_DRAFT" ? "Completează și aprobă specificația" : "Așteaptă decizia ta";
    case "cancel": return "Oprire cerută; aștept confirmarea că nimic nu mai rulează";
    // P0-R3: a turn ran out of its per-turn limit; the factory re-dispatches it ONCE by itself after the cooldown.
    case "retry": return "Tura a depășit limita pe tură; o reiau automat o singură dată, după cel puțin un minut (Pauză și Stop rămân disponibile)";
    default: return null;
  }
}
