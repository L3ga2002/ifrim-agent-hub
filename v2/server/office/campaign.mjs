import { DEMO_NOTE, PRICE_TBD } from "./demo-content.mjs";

/**
 * A campaign package prepared LOCALLY (the stage before M12): objective, audience, message, proof, calendar, per-channel texts and
 * variants, the materials that exist on disk, and what is deliberately left out (publication, budget, channel accounts). Nothing here
 * publishes or spends; `distribution` is the shape M12 fills (channels connected, budget, autoPublish) inside ONE approved plan, so a
 * future campaign can include publication without a confirmation per post. All texts are built from facts passed in; no results,
 * prices or client names are invented.
 */
export const CAMPAIGN_SCHEMA = 1;
const CHANNELS = Object.freeze([
  { key: "instagram_reels", name: "Instagram Reels", format: "9:16", limit: 2200 },
  { key: "facebook", name: "Facebook", format: "16:9", limit: 5000 },
  { key: "tiktok", name: "TikTok", format: "9:16", limit: 2200 },
  { key: "linkedin", name: "LinkedIn", format: "16:9", limit: 3000 },
  { key: "google_business", name: "Google Business Profile", format: "16:9", limit: 1500 },
]);

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * `facts`: { business: "atelier de detailing auto", noun: "programarea", proofs: [ "AC-1: …" ], materials: [{ name, file, format, sha256, durationSec }],
 *   cta: "Hai să discutăm", startDate: "YYYY-MM-DD" }.
 */
export function buildCampaign(facts) {
  const business = facts.business || "atelier de detailing auto";
  const noun = facts.noun || "programarea";
  const cta = facts.cta || "Hai să discutăm";
  const proofs = (facts.proofs || []).slice(0, 6);
  const materials = facts.materials || [];
  const start = facts.startDate || "2026-10-13";
  const objective = `Să arătăm proprietarilor de ateliere de detailing cum arată ${noun} online în trei pași și să obținem discuții de prezentare.`;
  const audience = [
    "Proprietari și manageri de ateliere de detailing auto și spălătorii premium.",
    "Ateliere care primesc azi programări mai ales prin telefon și mesaje.",
  ];
  const message = `Clientul tău își face singur ${noun}, de pe telefon, în trei pași: alege serviciul, ziua și ora, apoi primește confirmarea.`;
  const hooks = [
    "Câte apeluri pierzi când ești cu mâinile pe mașină?",
    "Programare de pe telefon în trei pași, fără apeluri.",
    "Așa arată o programare online pentru un atelier de detailing.",
  ];
  const body = (ch) => {
    const lines = [hooks[CHANNELS.indexOf(ch) % hooks.length], "", message, "", "Ce arată demo-ul:", "• alegerea serviciului și a intervalului;", "• fără suprapuneri de programări;", "• confirmare clară la final.", "", `${cta}: îți arătăm demo-ul pe datele atelierului tău.`];
    if (ch.key === "linkedin") lines.splice(1, 0, "", "Pentru atelierele care vor mai puține telefoane și o agendă clară.");
    return lines.join("\n").slice(0, ch.limit);
  };
  const texts = CHANNELS.map((ch) => ({ channel: ch.key, name: ch.name, format: ch.format, text: body(ch), material: materials.find((m) => m.format === ch.format)?.name || null }));
  const calendar = [];
  CHANNELS.forEach((ch, i) => {
    calendar.push({ date: addDays(start, i * 2), channel: ch.name, format: ch.format, textRef: ch.key, material: texts[i].material || "de produs", status: "Pregătit local" });
    calendar.push({ date: addDays(start, i * 2 + 7), channel: ch.name, format: ch.format, textRef: ch.key, material: texts[i].material || "de produs", status: "Pregătit local" });
  });
  calendar.sort((a, b) => (a.date === b.date ? a.channel.localeCompare(b.channel) : a.date.localeCompare(b.date)));
  const missing = CHANNELS.filter((ch) => !materials.some((m) => m.format === ch.format)).map((ch) => `${ch.name}: lipsește un clip ${ch.format}`);
  return {
    schema: CAMPAIGN_SCHEMA, title: `Campanie demo — ${business}`, objective, audience, message, cta, proofs, hooks, channels: CHANNELS.map((c) => ({ ...c })), texts, calendar, materials, missing,
    budget: PRICE_TBD, note: DEMO_NOTE,
    distribution: { status: "LOCAL_ONLY", publish: false, channelsConnected: [], budget: null, autoPublish: false, plannedFor: "M12",
      note: "Publicarea și bugetul intră în M12, într-un plan aprobat o singură dată (canale conectate, buget, calendar), fără confirmare pentru fiecare postare." },
  };
}

export function campaignMarkdown(c) {
  const out = [`# ${c.title}`, "", `> ${c.note}`, "", "## Obiectiv", "", c.objective, "", "## Public", "", ...c.audience.map((a) => `- ${a}`), "", "## Mesaj principal", "", c.message, "",
    `Îndemn: **${c.cta}**`, ""];
  if (c.proofs.length) out.push("## Dovezi (din verificările Hub-ului)", "", ...c.proofs.map((p) => `- ${p}`), "");
  out.push("## Materiale disponibile", "");
  if (c.materials.length) out.push("| Material | Format | Durată | sha256 |", "|---|---|---|---|", ...c.materials.map((m) => `| ${m.name} | ${m.format} | ${m.durationSec ? `${m.durationSec} s` : ""} | ${String(m.sha256 || "").slice(0, 12)} |`), "");
  else out.push("Niciun material video exportat încă.", "");
  if (c.missing.length) out.push("Lipsesc:", "", ...c.missing.map((m) => `- ${m}`), "");
  out.push("## Calendar (propunere, nepublicat)", "", "| Data | Canal | Format | Text | Material | Status |", "|---|---|---|---|---|---|",
    ...c.calendar.map((r) => `| ${r.date.split("-").reverse().join(".")} | ${r.channel} | ${r.format} | ${r.textRef} | ${r.material} | ${r.status} |`), "");
  out.push("## Texte pe canale", "");
  for (const t of c.texts) out.push(`### ${t.name} (${t.format})`, "", "```", t.text, "```", "");
  out.push("## Buget și distribuție", "", `Buget: ${c.budget}. Nimic nu a fost publicat și niciun canal nu e conectat.`, "", c.distribution.note, "");
  return out.join("\n");
}

/** The calendar as a workbook model (Excel), with per-channel counts by formula. */
export function campaignWorkbook(c) {
  const n = c.calendar.length;
  const last = n + 1;
  const rows = c.calendar.map((r) => [{ date: r.date }, r.channel, r.format, r.textRef, r.material, r.status]);
  const counts = c.channels.map((ch) => [ch.name, { f: `COUNTIF(Calendar!B2:B${last},"${ch.name}")` }]);
  const expect = [
    ...c.channels.map((ch, i) => ({ sheet: "Pe canale", ref: `B${i + 2}`, value: c.calendar.filter((r) => r.channel === ch.name).length })),
    { sheet: "Pe canale", ref: `B${c.channels.length + 2}`, value: n },
  ];
  return {
    model: { title: c.title, sheets: [
      { name: "Calendar", columns: [{ header: "Data", type: "date", width: 12 }, { header: "Canal", type: "text", width: 24 }, { header: "Format", type: "text", width: 9 },
        { header: "Text", type: "text", width: 18 }, { header: "Material", type: "text", width: 26 }, { header: "Status", type: "text", width: 16 }], rows, notes: [c.note, "Nimic nu e publicat: calendarul e o propunere locală."] },
      { name: "Pe canale", columns: [{ header: "Canal", type: "text", width: 26 }, { header: "Postări", type: "int", width: 10 }], rows: counts, totals: [["Total", { f: `SUM(B2:B${c.channels.length + 1})` }]] },
    ] },
    expect,
  };
}
