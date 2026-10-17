// M10.2 probe reader (U03). GET only: it never sends a command, a token or a cookie, so it cannot change the Hub's state.
//
//   node v2/scripts/probe-m10-2.mjs --mark              → prints the newest event seq (the marker before a probe)
//   node v2/scripts/probe-m10-2.mjs --since <seq>       → prints the counters for every event after <seq>
//   node v2/scripts/probe-m10-2.mjs --since <seq> --until <seq> --json
//
// A live probe (U16) is read only after the owner approved the upgrade and the residue cleanup; the counters come from the Hub's
// own logs (GET /api/owner/probe), never from the browser. HUB_V2_PORT selects another Hub (a test Hub, the simulator).
//
// Live probe procedure (U16; repeats flows A–C of v2/tests/m10-2-probe-e2e.test.mjs on the real Hub, owner decisions 11 and 14 first):
//   1. `--mark` before the owner starts a flow; note the printed seq.
//   2. The owner runs the flow himself (voice or cockpit). This script sends nothing in between.
//   3. `--since <seq>` right after the flow ends (add `--until <seq>` from a second `--mark` to close the window exactly).
// Expected on the one-plan path: grant forms, manual grants, manual mode changes, Approvals navigations, Lega old-flow pointers and
// developer interventions all 0. Scope confirmations: A = 2 (import + content plan), B = 1, C = 0. Extra authentications: A ≤ 1
// (the folder step-up), B = C = 0. On the live Hub the `test` channel counts as a developer intervention (testMode is off), and any
// settings drift (a row changed without its settings.changed event) is listed by key only, never by value.
//
// 2.12.2 (R4): the text output starts with the owner's §7 list under his exact names (GRANT_FORMS_OPENED … UNKNOWN_INTENTS), then the
// other existing counters. A Hub that does not serve a counter yet prints „?” for it; the two owner names that are existing counters
// (MANUAL_DEV_DB_API_INTERVENTIONS = developerInterventions, CONTEXTUAL_REARM = gateRearms) fall back to the old key. --json prints
// the Hub's answer unchanged (on 2.12.2 it carries `ownerList` with the same names).
// 2.12.3 (D1): UNKNOWN_INTENTS leaves out the provider transcripts Lega's agent answered (a tool call or speech in the same Lega session,
// before the owner's next sentence); their number follows the line („o frază la care a răspuns Lega (neinclusă)”).
import { PORT, request } from "./common.mjs";

const LABELS = {
  grantFormsOpened: "Formulare de grant deschise",
  manualGrantCreates: "Grant-uri create manual",
  manualModeChanges: "Schimbări manuale de mod / poartă deschisă",
  approvalsNavigations: "Aprobări: navigări + click-uri pe carduri vechi",
  scopeConfirmations: "Confirmări de plan (scope)",
  clarifications: "Întrebări de clarificare",
  extraAuthentications: "Autentificări suplimentare",
  developerInterventions: "Intervenții de dezvoltator (agent/cli/test, drift setări)",
  automaticReadinessSteps: "Pași automați de pregătire",
  legaOldFlowPointers: "Indicații Lega spre fluxul vechi",
  gateRearms: "Redeschideri ale porții din cockpit (Windows Hello)",
  navigationToAdvanced: "Navigări la Integrări → Validare live (cale manuală / Avansat)",
  planConfirmations: "Confirmări de plan (prima confirmare a fiecărui plan)",
  extraScopeConfirmations: "Confirmări suplimentare în același plan",
  voiceConfirmations: "Confirmări de plan rostite (vocea ta, verificată local)",
  voicePause: "Pauze spuse cu vocea",
  voiceContinue: "„Continuă” rostit care a reluat",
  stopAll: "Stop All",
  unknownIntents: "Fraze neînțelese (fără întrebare sau explicație)",
};

/** The owner's §7 list, in his order and with his exact names; `keys`: the counter, then the old key it is an alias of. */
const OWNER_LINES = [
  { name: "GRANT_FORMS_OPENED", keys: ["grantFormsOpened"] },
  { name: "MANUAL_MODE_CHANGES", keys: ["manualModeChanges"] },
  { name: "NAVIGATION_TO_APPROVALS", keys: ["approvalsNavigations"] },
  { name: "NAVIGATION_TO_ADVANCED", keys: ["navigationToAdvanced"] },
  { name: "PLAN_CONFIRMATIONS", keys: ["planConfirmations"] },
  { name: "EXTRA_SCOPE_CONFIRMATIONS", keys: ["extraScopeConfirmations"] },
  { name: "MANUAL_DEV_DB_API_INTERVENTIONS", keys: ["manualDevDbApiInterventions", "developerInterventions"] },
  { name: "VOICE_CONFIRMATIONS", keys: ["voiceConfirmations"] },
  { name: "VOICE_PAUSE", keys: ["voicePause"] },
  { name: "VOICE_CONTINUE", keys: ["voiceContinue"] },
  { name: "STOP_ALL", keys: ["stopAll"] },
  { name: "CONTEXTUAL_REARM", keys: ["contextualRearm", "gateRearms"] },
  { name: "UNKNOWN_INTENTS", keys: ["unknownIntents"] },
];
const EXTRA_REASONS = { delta: "diferență", reconfirm: "reconfirmare", repeat: "a doua oară", continuation: "continuare" };

/** "a 2, b 1" from a { key: count } map (only the positive counts; flags such as continuationChecked are skipped), or "" for none. */
const list = (map, names = {}) => Object.entries(map || {}).filter(([, n]) => typeof n === "number" && n > 0).map(([k, n]) => `${names[k] || k} ${n}`).join(", ");

/** The detail printed after an owner line, from the Hub's breakdown (enum keys and counts only); "" when there is nothing to add. */
function detailOf(name, b) {
  if (!b) return "";
  const parts = [];
  if (name === "EXTRA_SCOPE_CONFIRMATIONS" && b.extraScopeConfirmations) {
    const l = list(b.extraScopeConfirmations, EXTRA_REASONS);
    if (l) parts.push(l);
    if (b.extraScopeConfirmations.continuationChecked === false) parts.push("continuările nu au putut fi verificate");
  } else if (name === "VOICE_PAUSE" && b.voicePause) {
    const l = list({ "a ta": b.voicePause.owner, "fără sesiunea ta": b.voicePause.other });
    if (l) parts.push(l);
  } else if (name === "VOICE_CONTINUE" && b.voiceContinue?.heard) {
    parts.push(`fraze verificate local: ${b.voiceContinue.heard} — ${list(b.voiceContinue.byOutcome)}`);
  } else if (name === "STOP_ALL" && b.stopAll) {
    const channels = list(b.stopAll.byChannel);
    if (channels) parts.push(`canal: ${channels}`);
    // 2.12.2 (R4-F8): STOP_ALL counts only the owner's Stop Alls; the other stops are on their own line (otherStops). An older Hub (no
    // `shutdowns`) still counted every stop: its kinds are printed next to the number, as before.
    const kinds = b.stopAll.shutdowns === undefined ? list(b.stopAll.byKind) : "";
    if (kinds) parts.push(`fel: ${kinds}`);
  } else if (name === "UNKNOWN_INTENTS" && b.unknownIntents) {
    const sources = list(b.unknownIntents.bySource);
    if (sources) parts.push(`sursă: ${sources}`);
    const n = b.unknownIntents.estimated;
    if (n) parts.push(`${n} ${n === 1 ? "estimată" : "estimate"} din refuzuri (frază înregistrată înainte de numărarea exactă)`);
    // 2.12.3 (D1): the provider transcripts Lega answered are left out of the number; an older Hub has no such key and prints nothing more.
    const byLega = b.unknownAnsweredByLega?.sentences || 0;
    if (byLega > 0) parts.push(byLega === 1 ? "o frază la care a răspuns Lega (neinclusă)" : `${byLega} fraze la care a răspuns Lega (neincluse)`);
  } else if (name === "VOICE_CONFIRMATIONS" && b.voiceConfirmations) {
    const l = list({ misiune: b.voiceConfirmations.envelope, operare: b.voiceConfirmations.ops });
    if (l) parts.push(l);
  }
  return parts.length ? ` (${parts.join("; ")})` : "";
}

/** R4-F8: the stops that are not the owner's „Oprește tot” (the Hub's shutdown with work in flight, a security stop), or "" for none. */
function otherStops(b) {
  if (!b?.stopAll || b.stopAll.shutdowns === undefined) return "";
  const l = list(Object.fromEntries(Object.entries(b.stopAll.byKind || {}).filter(([k]) => k !== "stop_all")), { shutdown: "închiderea Hub-ului cu lucru în curs", security: "oprire de securitate" });
  return l ? `Alte opriri (nu intră în STOP_ALL): ${l}` : "";
}

function args(argv) {
  const out = { mark: false, json: false, since: null, until: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mark") out.mark = true;
    else if (a === "--json") out.json = true;
    else if (a === "--since") out.since = argv[++i];
    else if (a === "--until") out.until = argv[++i];
    else throw new Error(`Argument necunoscut: ${a}`);
  }
  for (const k of ["since", "until"]) if (out[k] !== null && !/^\d+$/.test(String(out[k]))) throw new Error(`--${k} cere un număr întreg ≥ 0`);
  if (!out.mark && out.since === null) throw new Error("Folosește --mark sau --since <seq>");
  return out;
}

let opts;
try { opts = args(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }

const query = opts.mark ? "mark=1" : `sinceSeq=${opts.since}${opts.until !== null ? `&untilSeq=${opts.until}` : ""}`;
const res = await request("GET", `/api/owner/probe?${query}`);
if (res.status !== 200 || !res.json) {
  console.error(res.status === 0 ? `Hub-ul nu răspunde pe 127.0.0.1:${PORT}` : `GET /api/owner/probe: ${res.status} ${res.json?.error?.message || ""}`);
  process.exit(1);
}
if (opts.json || opts.mark) {
  console.log(JSON.stringify(res.json, null, 2));
} else {
  const r = res.json;
  const counters = r.counters || {};
  console.log(`Fereastra: seq ${r.window.sinceSeq} → ${r.window.untilSeq} (${r.window.fromAt || "început"} → ${r.window.toAt || "—"})${r.window.testMode ? " [TEST]" : ""}`);
  console.log("Lista proprietarului (§7):");
  let missing = 0;
  for (const line of OWNER_LINES) {
    const key = line.keys.find((k) => counters[k] !== undefined);
    if (key === undefined) missing += 1;
    const label = LABELS[line.keys[line.keys.length - 1]];
    console.log(`${line.name.padEnd(32)}${String(key === undefined ? "?" : counters[key]).padStart(4)}  ${label}${key === undefined ? "" : detailOf(line.name, r.breakdown)}`);
  }
  if (missing) console.log(`„?” = Hub-ul servit nu are încă ${missing === 1 ? "acest contor" : "aceste contoare"} (vin cu 2.12.2-m10.2).`);
  const others = otherStops(r.breakdown);
  if (others) console.log(others);
  // Before 2.12.2 entering Integrations → Validare live was counted as a grant form: say so instead of letting the number mislead.
  if (counters.navigationToAdvanced === undefined && counters.grantFormsOpened !== undefined) console.log("Pe acest Hub, GRANT_FORMS_OPENED include și intrările în Integrări → Validare live (separate abia din 2.12.2).");
  // The existing counters the owner's list does not name, as before (label after the count).
  const named = new Set(OWNER_LINES.flatMap((line) => line.keys));
  console.log("Alte contoare:");
  for (const [key, label] of Object.entries(LABELS)) if (!named.has(key)) console.log(`${String(counters[key] ?? "?").padStart(4)}  ${label}`);
  if (r.settings?.drift?.length) console.log(`Drift setări: ${r.settings.drift.map((d) => `${d.key} (${d.reasons.join(", ")})`).join("; ")}`);
  console.log(`Hash setări: ${r.settings?.tableHash || "—"}`);
}
