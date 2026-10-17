// Pure helpers for the M12 Sales preparation on the Opportunity screen and the q-v2 notes on the org sheet (no DOM, no React) —
// covered by v2/tests/m12-prep-ui-logic.test.mjs. Data: GET /api/sales/opportunities/:id/dossiers ({ preparations, dossiers }) and the
// qualification row of the org sheet. Everything is rendered as plain text; a status is always said in words, never by colour alone.

const str = (v) => (v === undefined || v === null ? "" : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
export const FULL_SHA = /^[0-9a-f]{64}$/;

/** [Romanian label, tone] per preparation status (D6). The tone feeds the existing chip classes. */
export const PREPARATION_STATUS_META = Object.freeze({
  PLANNED: ["Propusă: aștept confirmarea planului", "neutral"], PREPARING: ["În pregătire (fără model)", "info"],
  WAITING_OWNER: ["Așteaptă aprobarea ta", "approval"], PACKAGING: ["Se fac ciorna și dosarul", "info"], READY: ["Dosarul e gata", "ok"],
  STALE: ["Depășită: intrările s-au schimbat", "warn"], STOPPED: ["Oprită", "warn"], EXPIRED: ["Expirată", "warn"], CANCELLED: ["Anulată", "neutral"], FAILED: ["Oprită de o eroare", "error"],
});
/** [Romanian label, tone] per dossier status (D6). */
export const DOSSIER_STATUS_META = Object.freeze({
  WRITING: ["Se scrie", "info"], READY: ["Gata (local)", "ok"], STALE: ["Depășit: intrările s-au schimbat", "warn"], SUPERSEDED: ["Înlocuit de o revizie nouă", "neutral"],
  INCOMPLETE: ["Incomplet (oprit la jumătate)", "warn"],
});
export const preparationStatusMeta = (status) => { const m = PREPARATION_STATUS_META[status]; return m ? { label: m[0], tone: m[1] } : { label: str(status) || "—", tone: "neutral" }; };
export const dossierStatusMeta = (status) => { const m = DOSSIER_STATUS_META[status]; return m ? { label: m[0], tone: m[1] } : { label: str(status) || "—", tone: "neutral" }; };

/** Statuses a continuation card may resume (the server's CONTINUABLE: one new confirmation, the same root plan). */
export const PREPARATION_CONTINUABLE = Object.freeze(["STALE", "STOPPED", "EXPIRED", "FAILED"]);

/**
 * Who confirmed the plan, said truthfully: Windows Hello only for a WebAuthn session; a local development session is named as such and
 * never presented as the owner's presence.
 */
export function consentAuthorityText(authority) {
  if (authority === "webauthn") return "Plan confirmat de tine, în sesiunea verificată cu Windows Hello / cheia ta.";
  if (authority === "local_dev_profile") return "Plan confirmat într-o sesiune locală de dezvoltare (încredere în acest calculator, nu dovada prezenței tale).";
  return "Planul nu e confirmat încă.";
}

/**
 * One preparation as the screen shows it (from the read route; unknown fields stay empty, never invented). Review F10: whether it can be
 * continued and whether it waits for the rearm are the SERVER's flags (`continuable`: a continuable status AND a root the owner confirmed,
 * R18; `waitsForRearm`: the Stop All that stopped it still holds the gate, C2 / F9) — never recomputed from the status alone.
 */
export function preparationView(raw = {}) {
  const r = obj(raw);
  const awaited = r.awaited && typeof r.awaited === "object" ? { proposalId: str(r.awaited.proposalId), proposalSha: str(r.awaited.proposalSha) } : null;
  const status = str(r.status);
  return { id: str(r.id), status, statusReason: str(r.statusReason), staleReason: str(r.staleReason), request: str(r.request),
    authority: r.authority === "webauthn" || r.authority === "local_dev_profile" ? r.authority : null, confirmedAt: str(r.confirmedAt),
    awaited, awaitedComplete: Boolean(awaited && /^spr_[A-Za-z0-9_]+$/.test(awaited.proposalId) && FULL_SHA.test(awaited.proposalSha)),
    awaitedLabel: awaited ? awaitedOfferLabel(status, r.awaitedCurrent === true) : "",
    decisionsLeft: arr(r.decisionsLeft).map(str).filter(Boolean),
    continuable: r.continuable === true && PREPARATION_CONTINUABLE.includes(status), waitsForRearm: r.waitsForRearm === true,
    activateBy: str(r.activateBy), synthetic: r.synthetic !== false, createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) };
}

/**
 * Review F21: what the offer id + SHA the preparation recorded is, said truthfully: the target it waits for (only while it waits or
 * packages and that version is still the current one), the approved offer of a ready dossier, or the offer it USED to wait for (outdated,
 * or still current but no longer awaited automatically) — never „Oferta așteptată” for a stale or stopped target.
 */
export function awaitedOfferLabel(status, current) {
  if (["WAITING_OWNER", "PACKAGING"].includes(status)) return current ? "Oferta așteptată (ținta exactă a aprobării tale)" : "Oferta pe care o aștepta (depășită: nu mai e ținta)";
  if (status === "READY") return current ? "Oferta aprobată din care s-a făcut dosarul" : "Oferta din care s-a făcut dosarul (depășită)";
  return current ? "Oferta pe care o aștepta (încă versiunea curentă; nu mai e așteptată automat)" : "Oferta pe care o aștepta (depășită: nu mai e ținta)";
}

/**
 * Review F1/F3/F10: what the panel offers for continuing a stopped preparation. → { kind, text }
 *   "continue"  the server says it is continuable and nothing holds it: the „Pregătește continuarea” button (ONE new card, confirmed once);
 *   "rearm"     „Oprește tot” stopped it and still holds the gate: the rearm comes first, in the cockpit (no button that would be refused);
 *   "new"       a status a continuation would resume, but the server refuses it (e.g. a card never confirmed, R18): a new request instead;
 *   null        nothing to continue (it runs, waits for you, is ready or cancelled).
 */
export function continuationOffer(p) {
  const v = obj(p);
  if (!PREPARATION_CONTINUABLE.includes(v.status)) return { kind: null, text: "" };
  if (v.waitsForRearm) return { kind: "rearm", text: "„Oprește tot” a oprit această pregătire și poarta e încă oprită: întâi redeschizi poarta în cockpit, pe cardul „Redeschide poarta” (Windows Hello); apoi revii aici și pregătești continuarea." };
  if (v.continuable) return { kind: "continue", text: "Continuarea e un card nou, pe care îl confirmi o dată; ce s-a făcut deja nu se repetă (aceeași firmă sintetică, aceeași ofertă dacă nu s-a schimbat nimic)." };
  return { kind: "new", text: "Pregătirea aceasta nu se poate continua (cardul ei inițial nu a fost confirmat niciodată): cere din nou oferta, ca o cerere nouă." };
}

/** The owner route that proposes the continuation card (POST, owner session; the card is then confirmed like any plan card). */
export const continuationPath = (preparationId) => `/api/sales/preparations/${encodeURIComponent(str(preparationId))}/continue`;
/** Where the rearm card lives (the cockpit's start screen shows it while the gate is stopped). */
export const COCKPIT_HREF = "#/lega";

/**
 * While the preparation waits for the owner's approval: until when the draft and the dossier still follow by themselves (the confirmed
 * plan's window, from the confirmation). → "" when there is no window to say.
 */
export function activationWindowText(p, now = Date.now()) {
  const v = obj(p);
  if (v.status !== "WAITING_OWNER" || !v.activateBy) return "";
  const at = Date.parse(v.activateBy);
  if (!Number.isFinite(at)) return "";
  const min = Math.round((at - now) / 60000);
  if (min <= 0) return "Fereastra planului confirmat a trecut: după aprobarea ofertei, ciorna și dosarul nu mai pornesc singure; o continuare cere un card nou.";
  const left = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  return `Dacă aprobi oferta exactă în următoarele ${left}, ciorna și dosarul se fac singure; după aceea, o continuare cere un card nou.`;
}

/**
 * What the Word check of a dossier says (S-06, T-S6): FILE_CHECKED is the file check; APP_VERIFIED only when Word itself opened it;
 * APP_NOT_RUN is said as such (never as „verificat în Word”); APP_FAILED is a failure. → { file, app, label, tone, note }
 */
export function appVerificationText(verification) {
  const v = obj(obj(verification).proposalDocx);
  const file = v.file === "FILE_CHECKED" ? "Fișierul Word e verificat (structura documentului)." : v.file ? `Verificarea fișierului: ${str(v.file)}.` : "Fișierul Word nu e verificat încă.";
  const note = str(v.note);
  if (v.app === "APP_VERIFIED") {
    const who = [str(v.appName) || "Microsoft Word", v.appVersion ? str(v.appVersion) : ""].filter(Boolean).join(" ");
    return { file, app: "APP_VERIFIED", label: `Deschis și verificat în Word (${who}${Number.isFinite(Number(v.pages)) && v.pages !== null ? `, ${v.pages} pagini` : ""}); PDF exportat.`, tone: "ok", note };
  }
  if (v.app === "APP_NOT_RUN") return { file, app: "APP_NOT_RUN", label: "Word nu a rulat aici (APP_NOT_RUN): documentul e verificat doar ca fișier, nu în Word.", tone: "warn", note };
  if (v.app === "APP_FAILED") return { file, app: "APP_FAILED", label: "Word nu confirmă documentul (APP_FAILED).", tone: "error", note };
  return { file, app: null, label: "Verificarea în Word nu e înregistrată.", tone: "neutral", note };
}

/** One dossier as the screen shows it: the full manifest SHA (never a prefix), DRAFT_ONLY, nothing sent, the Word check truthfully. */
export function dossierView(raw = {}) {
  const r = obj(raw);
  const labels = arr(r.labels).map(str);
  const files = arr(r.files).map((f) => ({ path: str(obj(f).path), sha256: str(obj(f).sha256), bytes: Number(obj(f).bytes) || 0, reused: Boolean(obj(f).reusedFrom) }));
  const inputsCurrent = r.status === "READY" ? r.inputsCurrent !== false : null;
  return { id: str(r.id), revision: Number(r.revision) || 0, status: str(r.status), statusReason: str(r.statusReason), folderName: str(r.folderName),
    manifestSha256: FULL_SHA.test(str(r.manifestSha256)) ? str(r.manifestSha256) : "", files, fileCount: files.length,
    draftOnly: labels.includes("DRAFT_ONLY"), localOnly: labels.includes("LOCAL_ONLY"), syntheticData: labels.includes("SYNTHETIC_DATA") || r.synthetic === true,
    sent: r.sent === true, inputsCurrent, verification: appVerificationText(r.verification),
    // Review F21: a READY revision whose inputs changed since it was written is never the green „Gata”: it is said to be no longer current.
    display: inputsCurrent === false ? { label: "Neactual: intrările s-au schimbat de la scriere", tone: "warn" } : dossierStatusMeta(str(r.status)),
    proposalId: str(r.proposalId), proposalSha: str(r.proposalSha), createdAt: str(r.createdAt) };
}

/** The read route → what the Opportunity screen shows: the newest preparation (others only counted) and every dossier, newest first. */
export function preparationPanel(data) {
  const d = obj(data);
  const preparations = arr(d.preparations).map(preparationView);
  const dossiers = arr(d.dossiers).map(dossierView).sort((a, b) => b.revision - a.revision);
  return { show: preparations.length > 0 || dossiers.length > 0, current: preparations[0] || null, older: Math.max(0, preparations.length - 1), dossiers };
}

/**
 * The org sheet's q-v2 notes (C-04, S-04): the inferences that earned no points and the items present without recorded evidence.
 * Shown only for a q-v2 qualification or when there is something to list. → { show, formula, inferences: [{claim, why}], unproven: [{claim, why}] }
 */
export function qualificationNotes(raw) {
  const r = obj(raw);
  const result = obj(r.result && typeof r.result === "object" ? r.result : (() => { try { return JSON.parse(str(r.result_json)); } catch { return {}; } })());
  const formula = str(result.version || r.formulaVersion || r.formula_version);
  const item = (x) => ({ claim: str(obj(x).claim || obj(x).component), why: str(obj(x).why || obj(x).reasoning) });
  const inferences = arr(result.inferences).map(item).filter((x) => x.claim);
  const unproven = arr(result.unproven).map(item).filter((x) => x.claim);
  return { show: formula === "q-v2" || inferences.length > 0 || unproven.length > 0, formula, inferences, unproven };
}
