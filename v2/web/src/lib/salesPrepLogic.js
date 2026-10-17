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

/** One preparation as the screen shows it (from the read route; unknown fields stay empty, never invented). */
export function preparationView(raw = {}) {
  const r = obj(raw);
  const awaited = r.awaited && typeof r.awaited === "object" ? { proposalId: str(r.awaited.proposalId), proposalSha: str(r.awaited.proposalSha) } : null;
  return { id: str(r.id), status: str(r.status), statusReason: str(r.statusReason), staleReason: str(r.staleReason), request: str(r.request),
    authority: r.authority === "webauthn" || r.authority === "local_dev_profile" ? r.authority : null, confirmedAt: str(r.confirmedAt),
    awaited, awaitedComplete: Boolean(awaited && /^spr_[A-Za-z0-9_]+$/.test(awaited.proposalId) && FULL_SHA.test(awaited.proposalSha)),
    decisionsLeft: arr(r.decisionsLeft).map(str).filter(Boolean), continuable: PREPARATION_CONTINUABLE.includes(r.status), synthetic: r.synthetic !== false,
    createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) };
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
  return { id: str(r.id), revision: Number(r.revision) || 0, status: str(r.status), statusReason: str(r.statusReason), folderName: str(r.folderName),
    manifestSha256: FULL_SHA.test(str(r.manifestSha256)) ? str(r.manifestSha256) : "", files, fileCount: files.length,
    draftOnly: labels.includes("DRAFT_ONLY"), localOnly: labels.includes("LOCAL_ONLY"), syntheticData: labels.includes("SYNTHETIC_DATA") || r.synthetic === true,
    sent: r.sent === true, inputsCurrent: r.status === "READY" ? r.inputsCurrent !== false : null, verification: appVerificationText(r.verification),
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
