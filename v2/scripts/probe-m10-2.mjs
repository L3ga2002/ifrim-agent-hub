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
};

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
  console.log(`Fereastra: seq ${r.window.sinceSeq} → ${r.window.untilSeq} (${r.window.fromAt || "început"} → ${r.window.toAt || "—"})${r.window.testMode ? " [TEST]" : ""}`);
  for (const [key, label] of Object.entries(LABELS)) console.log(`${String(r.counters[key] ?? "?").padStart(4)}  ${label}`);
  if (r.settings?.drift?.length) console.log(`Drift setări: ${r.settings.drift.map((d) => `${d.key} (${d.reasons.join(", ")})`).join("; ")}`);
  console.log(`Hash setări: ${r.settings?.tableHash || "—"}`);
}
