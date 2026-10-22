// M14: the Lega READ of an existing „Birou intern” record — „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”,
// „Arată devizul DVZ-0001”, the number alone, or „Arată devizul” (the newest; a choice when there are several). The answer is the
// record's own state, its reason, the decision waiting for the owner, the export and the next action, read through desk.detail(); the
// L3ga screen opens that record in the „Birou intern” panel. Nothing is created, continued, approved or exported from here.
import { DESK_FLOWS, DESK_STATUS_RO } from "./desk.mjs";

const NOUN = Object.freeze({ ops_start: "dosarul de pornire", support_case: "cazul de suport", finance_doc: "devizul" });
const NOUNS = Object.freeze({ ops_start: "dosare de pornire", support_case: "cazuri de suport", finance_doc: "devize" });
const KIND_OF_PREFIX = Object.freeze(Object.fromEntries(Object.entries(DESK_FLOWS).map(([kind, f]) => [f.prefix, kind])));
const MAX_CHOICES = 6;
const sentence = (s) => { const t = String(s || "").trim(); return !t ? "" : /[.!?…]$/.test(t) ? t : `${t}.`; };

/** „OPS-1” / „ops 0001” → „OPS-0001” (the form the desk numbers its records with), or null. */
export function deskInternalNo(value) {
  const m = String(value || "").trim().match(/^(ops|sup|dvz)[ -]?0*(\d{1,6})$/i);
  return m ? `${m[1].toUpperCase()}-${m[2].padStart(4, "0")}` : null;
}

export function createDeskAnswers({ db, desk }) {
  const byInternalNo = (no) => {
    const row = db.prepare("SELECT id FROM desk_records WHERE internal_no = ?").get(String(no || ""));
    return row ? desk.get(row.id) : null;
  };
  const ofKind = (kind) => db.prepare("SELECT id FROM desk_records WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 50").all(kind).map((r) => desk.get(r.id)).filter(Boolean);
  const optionOf = (r) => ({ id: r.id, label: `${r.internalNo} · ${DESK_STATUS_RO[r.status] || r.status} · ${r.title}`.slice(0, 160) });

  /** One record told as the panel shows it: state + reason, the decision waiting, the export, the next action, what it never does. */
  function tell(id, { askedKind = null, missing = false } = {}) {
    const d = desk.detail(id);
    const r = d.record;
    const flow = DESK_FLOWS[r.kind];
    const parts = [];
    if (askedKind && askedKind !== r.kind) parts.push(`${r.internalNo} e ${NOUN[r.kind]}, nu ${NOUN[askedKind]}.`);
    parts.push(`${flow.title} ${r.internalNo} (SINTETIC): ${r.statusText}.`);
    const why = r.status === "STALE" ? r.staleReason || r.statusReason : r.statusReason;
    if (why) parts.push(sentence(why));
    if (d.inputsCurrent === false && r.status !== "STALE") parts.push("Intrările lui s-au schimbat de la pregătire (oferta sau pachetul citat); la următoarea verificare devine depășit.");
    if (d.decision) parts.push(`Așteaptă decizia ta: „${r.kind === "support_case" ? "Aprob textul intern" : "Aprob devizul intern"}” pe documentul v${d.decision.version} (ID și SHA complet afișate în panou).`);
    const x = Array.isArray(d.exports) ? d.exports[0] : null;
    if (x) parts.push(`Exportul revizia ${x.revision}: ${x.status === "READY" ? "gata" : x.status === "STALE" ? "depășit (fișierele rămân)" : x.status}, folderul „${x.folderName}”.`);
    if (d.waitsForRearm) parts.push("Întâi redeschiderea porții (cardul „Redeschide poarta”), apoi o continuare.");
    else if (d.continuable) parts.push("Îl continui cu butonul „Continuă” din panou: un singur card nou, pe aceeași înregistrare; ce e făcut nu se repetă.");
    if (missing || !d.continuable) parts.push(`Următoarea acțiune: ${sentence(r.nextAction || "—")}`);
    return { message: parts.join(" "), desk: { recordId: r.id, internalNo: r.internalNo, kind: r.kind, status: r.status, statusText: r.statusText, continuable: Boolean(d.continuable), waitsForOwner: Boolean(d.decision) } };
  }

  /** The answer to a desk read: { message, desk? , clarification? } — never a write. */
  function show({ internalNo = null, kind = null, askedKind = null, missing = false, chosenId = null } = {}) {
    if (chosenId) {
      const r = desk.get(chosenId);
      if (!r) return { message: "Înregistrarea aleasă nu mai există; spune-mi numărul ei (de exemplu OPS-0001)." };
      return tell(r.id, { missing });
    }
    const no = deskInternalNo(internalNo);
    const wanted = kind || (no ? KIND_OF_PREFIX[no.slice(0, 3)] : null) || askedKind;
    if (no) {
      const r = byInternalNo(no);
      if (r) return tell(r.id, { askedKind, missing });
      const others = ofKind(wanted);
      if (!others.length) return { message: `Nu găsesc ${no} și nu am încă ${NOUNS[wanted]} în Birou intern; nu creez nimic dintr-o cerere de afișare.` };
      return { message: `Nu găsesc ${no}. Am ${others.length === 1 ? "doar" : "aceste"} ${NOUNS[wanted]}: ${others.slice(0, MAX_CHOICES).map((o) => o.internalNo).join(", ")}. Pe care îl deschid?`,
        clarification: { question: `Nu găsesc ${no}. Pe care îl deschid?`, options: others.slice(0, MAX_CHOICES).map(optionOf), forIntent: "desk_show" } };
    }
    if (!wanted) return { message: "Ce să deschid din Birou intern? Spune numărul (OPS-0001, SUP-0001, DVZ-0001) sau „arată devizul / cazul de suport / dosarul de pornire”." };
    const list = ofKind(wanted);
    if (!list.length) return { message: `Nu am încă ${NOUNS[wanted]} în Birou intern. Nu creez nimic dintr-o cerere de afișare; dacă vrei unul, cere-l explicit (de exemplu „Pregătește ${NOUN[wanted]}…”).` };
    if (list.length === 1) return tell(list[0].id, { askedKind: wanted, missing });
    return { message: `Am ${list.length} ${NOUNS[wanted]}. Pe care îl deschid?`, clarification: { question: `Pe care îl deschid? (${NOUNS[wanted]})`, options: list.slice(0, MAX_CHOICES).map(optionOf), forIntent: "desk_show" } };
  }

  return { show, byInternalNo };
}
