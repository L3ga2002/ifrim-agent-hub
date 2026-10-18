/**
 * Demo content for the detailing presentation (Word, Excel, campaign). Every number is DECLARED DEMONSTRATIVE; there are no prices
 * (the catalog has no configured service, so a price is „De stabilit”), no client names and no claims about real results. The facts that
 * do exist (the site's verified checks, the clips, the export folder) are passed in by the caller from the Hub's own records.
 */
export const DEMO_NOTE = "Date demonstrative: programările, duratele și sursele din acest material sunt exemple create pentru prezentare. Nu sunt clienți, prețuri sau rezultate reale.";
export const PRICE_TBD = "De stabilit";

const SERVICES = [
  { name: "Spălare exterioară detaliată", minutes: 60 },
  { name: "Curățare interior", minutes: 90 },
  { name: "Polish faruri", minutes: 45 },
  { name: "Decontaminare vopsea", minutes: 120 },
  { name: "Consultanță protecție ceramică", minutes: 30 },
];
const SOURCES = ["Site", "Telefon", "Instagram"];
const STATUSES = ["Confirmată", "În așteptare", "Anulată"];

/** 12 demo bookings, deterministic (no randomness: the same input gives the same workbook). */
export function demoBookings(startIso = "2026-10-12") {
  const start = new Date(`${startIso}T00:00:00Z`);
  const hours = ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getTime() + Math.floor(i / 3) * 86400000);
    const svc = SERVICES[(i * 2) % SERVICES.length];
    return { date: d.toISOString().slice(0, 10), time: hours[(i * 5) % hours.length], service: svc.name, minutes: svc.minutes, status: STATUSES[[0, 0, 1, 0, 2, 0, 1, 0, 0, 1, 0, 0][i]], source: SOURCES[i % 3] };
  });
}

/** The workbook model + the values Excel's engine must give for every formula. */
export function bookingsWorkbook({ title = "Programări demo — Detailing" } = {}) {
  const rows = demoBookings();
  const n = rows.length;
  const last = n + 1;
  const data = rows.map((b, i) => [{ date: b.date }, b.time, b.service, b.minutes, { f: `D${i + 2}/60` }, b.status, b.source, PRICE_TBD]);
  const count = (pred) => rows.filter(pred).length;
  const totalMin = rows.reduce((a, b) => a + b.minutes, 0);
  const confirmed = count((b) => b.status === "Confirmată");
  const summary = [
    ["Programări (total)", { f: `COUNTA(Programari!C2:C${last})` }, n],
    ["Confirmate", { f: `COUNTIF(Programari!F2:F${last},"Confirmată")` }, confirmed],
    ["În așteptare", { f: `COUNTIF(Programari!F2:F${last},"În așteptare")` }, count((b) => b.status === "În așteptare")],
    ["Anulate", { f: `COUNTIF(Programari!F2:F${last},"Anulată")` }, count((b) => b.status === "Anulată")],
    ["Rata de confirmare", { f: "B3/B2" }, confirmed / n],
    ["Minute programate (fără anulate)", { f: `SUMIF(Programari!F2:F${last},"<>Anulată",Programari!D2:D${last})` }, rows.filter((b) => b.status !== "Anulată").reduce((a, b) => a + b.minutes, 0)],
    ["Durata medie (min)", { f: `AVERAGE(Programari!D2:D${last})` }, totalMin / n],
    ["Din site", { f: `COUNTIF(Programari!G2:G${last},"Site")` }, count((b) => b.source === "Site")],
    ["Din telefon", { f: `COUNTIF(Programari!G2:G${last},"Telefon")` }, count((b) => b.source === "Telefon")],
    ["Din Instagram", { f: `COUNTIF(Programari!G2:G${last},"Instagram")` }, count((b) => b.source === "Instagram")],
  ];
  const model = {
    title,
    sheets: [
      { name: "Programari", columns: [
        { header: "Data", type: "date", width: 12 }, { header: "Ora", type: "text", width: 8 }, { header: "Serviciu", type: "text", width: 32 },
        { header: "Durata (min)", type: "int", width: 13 }, { header: "Durata (ore)", type: "decimal", width: 13 }, { header: "Status", type: "text", width: 14 },
        { header: "Sursă", type: "text", width: 12 }, { header: "Preț", type: "text", width: 12 }],
        rows: data,
        totals: [["Total", "", "", { f: `SUM(D2:D${last})` }, { f: `SUM(E2:E${last})` }, "", "", ""]],
        notes: [DEMO_NOTE] },
      { name: "Rezumat", columns: [{ header: "Indicator", type: "text", width: 36 }, { header: "Valoare", type: "decimal", width: 14 }],
        rows: summary.map(([label, f]) => [label, f]), autoFilter: true, notes: [DEMO_NOTE, "Valorile sunt calculate de formulele registrului, nu scrise de mână."] },
    ],
  };
  // The rate is a percent: its own column type would be per cell; keep decimal and say so in the label (the check compares numbers).
  const expect = [
    { sheet: "Programari", ref: `D${last + 1}`, value: totalMin },
    { sheet: "Programari", ref: `E${last + 1}`, value: totalMin / 60 },
    { sheet: "Programari", ref: "E2", value: rows[0].minutes / 60 },
    ...summary.map(([, , value], i) => ({ sheet: "Rezumat", ref: `B${i + 2}`, value })),
  ];
  return { model, expect, rows };
}

/**
 * The presentation document. `facts` (all optional, from the Hub's records): { siteUrl, siteChecks: [{ name, status }], criteria:
 * [{ id, text, status }], clips: [{ name, duration }], exportDir, deliveryId, generatedAt }.
 */
export function presentationDocument(facts = {}) {
  const bookings = demoBookings();
  const blocks = [
    { type: "note", text: DEMO_NOTE },
    { type: "h1", text: "Ce arată demo-ul" },
    { type: "p", text: "Un site de programări pentru un atelier de detailing auto: clientul alege serviciul, ziua și ora, apoi primește confirmarea. Demo-ul rulează local, pe datele de mai jos." },
    { type: "bullet", text: "**Programare în trei pași**: serviciu, interval, date de contact." },
    { type: "bullet", text: "**Intervale reale de lucru**: fără suprapuneri, cu durata fiecărui serviciu." },
    { type: "bullet", text: "**Confirmare clară**: rezumatul programării la final." },
    { type: "h1", text: "Verificarea site-ului" },
  ];
  if (facts.siteChecks?.length || facts.criteria?.length) {
    blocks.push({ type: "p", text: `Rezultatele de mai jos vin din verificările Hub-ului${facts.siteUrl ? ` pe ${facts.siteUrl}` : ""}${facts.verifiedAt ? ` (${facts.verifiedAt})` : ""}.` });
    blocks.push({ type: "table", header: ["Verificare", "Rezultat"], widths: [3, 1], rows: [...(facts.criteria || []).map((c) => [`${c.id}: ${c.text}`, c.status]), ...(facts.siteChecks || []).map((c) => [c.name, c.status])] });
  } else blocks.push({ type: "p", text: "Verificarea site-ului nu are încă rezultate înregistrate în Hub pentru acest material." });
  blocks.push(
    { type: "h1", text: "Servicii prezentate" },
    { type: "table", header: ["Serviciu", "Durata", "Preț"], widths: [3, 1, 1], rows: SERVICES.map((s) => [s.name, `${s.minutes} min`, PRICE_TBD]) },
    { type: "p", text: "Prețurile nu sunt stabilite: catalogul de servicii nu are încă un preț configurat, deci materialul nu afișează sume." },
    { type: "h1", text: "Exemplu de programări (date demonstrative)" },
    { type: "table", header: ["Data", "Ora", "Serviciu", "Status", "Sursă"], widths: [1.2, 0.8, 3, 1.3, 1], rows: bookings.slice(0, 8).map((b) => [b.date.split("-").reverse().join("."), b.time, b.service, b.status, b.source]) },
    { type: "p", text: "Registrul Excel din același dosar conține toate cele 12 programări demonstrative și indicatorii calculați cu formule." },
  );
  if (facts.clips?.length) {
    blocks.push({ type: "h1", text: "Materiale video" }, { type: "table", header: ["Clip", "Format", "Durată"], widths: [3, 1, 1], rows: facts.clips.map((c) => [c.name, c.format || "", c.duration || ""]) });
  }
  blocks.push(
    { type: "h1", text: "Pașii următori" },
    { type: "bullet", text: "Stabilirea prețurilor reale în catalogul de servicii." },
    { type: "bullet", text: "Alegerea canalelor pentru campanie (pregătită local, nepublicată)." },
    { type: "bullet", text: "Programarea unei prezentări cu atelierul." },
  );
  return { title: "Prezentare demo — Programări detailing", subtitle: `Material pregătit de Ifrim Agent Hub${facts.generatedAt ? ` · ${facts.generatedAt}` : ""}`, author: "Ifrim Agent Hub", blocks };
}
