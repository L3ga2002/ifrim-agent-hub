// M13 „Birou intern” in the L3ga screen: pure helpers for the desk panel (Operations / Customer Support / Finance-Admin). They read the
// server's records; nothing here decides, confirms or starts anything (the approval of a document runs in the owner session, on its exact
// id + full SHA; a continuation is ONE card the owner confirms).

export const DESK_SECTIONS = Object.freeze([
  { kind: "ops_start", title: "Operations — dosarul de pornire", example: "Pregătește dosarul de pornire a proiectului din oferta aprobată" },
  { kind: "support_case", title: "Suport — cazuri", example: "Caz de suport pentru Demo Livrare: clienții pot anula singuri o programare?" },
  { kind: "finance_doc", title: "Finance-Admin — devize", example: "Pregătește devizul din oferta aprobată" },
]);
const TONES = { READY: "ok", WAITING_OWNER: "approval", PLANNED: "info", PREPARING: "info", PACKAGING: "info", STALE: "warn", STOPPED: "warn", EXPIRED: "warn", FAILED: "error", CANCELLED: "neutral" };
export const deskTone = (status) => TONES[status] || "neutral";
export const DESK_CLASS_RO = Object.freeze({ QUESTION: "întrebare", DEFECT_REPORTED: "defect raportat (nedovedit)", NEW_REQUEST: "cerere nouă" });
export const ITEM_RO = Object.freeze({ RECEIVED: "primit", MISSING: "lipsește" });

/**
 * The record on screen for each kind — the one a read opened (M14: „Arată devizul DVZ-0001” → focusId), else the newest — and how many
 * others there are. A focus on a record that is not in the list (deleted, another hub) is ignored.
 */
export function deskOverview(records = [], focusId = null) {
  const list = Array.isArray(records) ? records : [];
  return DESK_SECTIONS.map((s) => {
    const mine = list.filter((r) => r?.kind === s.kind);
    const focused = focusId ? mine.find((r) => r.id === focusId) || null : null;
    return { ...s, current: focused || mine[0] || null, focused: Boolean(focused), older: Math.max(0, mine.length - 1) };
  });
}

/**
 * The decision block of a record: only for a record that waits for the owner with its CURRENT document (the server's `decision`), and
 * only with the exact target (dar_ id, version, full 64-hex SHA). → { ok, artifactId, version, sha, label, path } | { ok: false, reason }
 */
export function deskDecision(detail) {
  const d = detail?.decision || null;
  if (!d) return { ok: false, reason: null };
  if (!/^dar_[A-Za-z0-9_]+$/.test(String(d.artifactId || ""))) return { ok: false, reason: "Lipsește ID-ul exact al documentului." };
  if (!/^[0-9a-f]{64}$/.test(String(d.sha || ""))) return { ok: false, reason: "Lipsește SHA-ul complet al documentului (64 de caractere)." };
  const support = detail.record?.kind === "support_case";
  return { ok: true, artifactId: d.artifactId, version: d.version, sha: d.sha, path: `/api/desk/artifacts/${encodeURIComponent(d.artifactId)}/approve`,
    label: support ? "Aprob textul intern" : "Aprob devizul intern",
    says: support ? "Aprobi doar textul acestui răspuns: rămâne DRAFT_ONLY — NETRIMIS, iar cazul rămâne deschis (nu e rezolvat, nu e închis)."
      : "Aprobi intern doar conținutul acestui deviz: nu e emitere fiscală, nu se trimite, nu înseamnă acceptarea clientului sau încasare." };
}

/** What the record waits for, in one line (the server's next action first; then why it stopped). */
export function deskNext(detail) {
  const r = detail?.record || {};
  if (["STALE", "STOPPED", "EXPIRED", "FAILED"].includes(r.status)) {
    if (detail?.waitsForRearm) return "Întâi redeschiderea porții (cardul „Redeschide poarta”), apoi o continuare.";
    if (detail?.continuable) return `${r.statusReason || "S-a oprit."} Un card nou îl continuă (aceeași înregistrare).`;
  }
  return r.nextAction || r.statusReason || "—";
}

/** The documents shown with the record: the newest version and its state. */
export const latestArtifact = (detail) => (Array.isArray(detail?.artifacts) ? detail.artifacts[0] || null : null);
export const latestExport = (detail) => (Array.isArray(detail?.exports) ? detail.exports[0] || null : null);
/** The Word level of an export, said as the server recorded it (never claimed). */
export function exportWordText(exp) {
  const v = exp?.verification?.docx;
  if (!v) return null;
  if (v.app === "APP_VERIFIED") return `Word: verificat în Word${v.appVersion ? ` ${v.appVersion}` : ""}${v.pages ? `, ${v.pages} pagini` : ""}; PDF exportat de Word.`;
  if (v.app === "APP_FAILED") return `Word: verificarea a eșuat (${v.note || "APP_FAILED"}).`;
  return `Word: verificat doar ca fișier (${v.note || "APP_NOT_RUN"}); PDF-ul nu a fost produs.`;
}
export const deskReload = (e) => /^(desk|ops)\./.test(String(e?.type || ""));
