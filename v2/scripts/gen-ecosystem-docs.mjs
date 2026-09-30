// Generates the Milestone 01 audit documents from the single source of truth in v2/config/ecosystem/*.json.
// Usage: node v2/scripts/gen-ecosystem-docs.mjs   (writes .ifrim/V2_*.md; no network, no models)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const v2 = path.resolve(here, "..");
const root = path.resolve(v2, "..");
const read = (name) => {
  const file = path.join(v2, "config", "ecosystem", `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const cell = (v, max = 160) => { const s = esc(Array.isArray(v) ? v.join(", ") : v); return s.length > max ? `${s.slice(0, max - 1)}…` : s || "—"; };
const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `- ${esc(x)}`).join("\n") : "- —");
const write = (name, text) => { fs.writeFileSync(path.join(root, ".ifrim", name), `${text.trim()}\n`); console.log(`wrote .ifrim/${name}`); };
const header = (title, cfg, intro) => [`# ${title}`, "", `> Generat din \`v2/config/ecosystem/\` de \`v2/scripts/gen-ecosystem-docs.mjs\`. Verificat: ${cfg?.verifiedOn || "—"}. Nu edita manual: modifică JSON-ul și regenerează.`, "", intro, ""].join("\n");

const FIELD_LABELS = [
  ["officialSource", "Sursă oficială"], ["technicalDoc", "Documentație tehnică"], ["whatItDoes", "Ce face"], ["planRequired", "Plan necesar"], ["platform", "Platformă"],
  ["rollout", "Rollout"], ["accountEligibility", "Eligibilitate cont"], ["authMethod", "Autentificare"], ["allowance", "Allowance"], ["sharedUsage", "Utilizare partajată"],
  ["subscriptionIncluded", "Inclus în abonament?"], ["extraBillingRisk", "Risc de facturare suplimentară (credite/extra usage)"], ["apiBillingRisk", "Risc de facturare API"],
  ["programmaticIntegration", "Integrare programatică"], ["programmaticDetail", "Detaliu integrare"], ["nativeUserSurface", "Suprafață nativă"], ["localRequirements", "Cerințe locale"],
  ["hubRelevance", "Relevanță pentru Hub"], ["proposedRole", "Rol propus"], ["executionSurface", "Suprafață de execuție"], ["counterpartEquivalent", "Echivalent la celălalt ecosistem"],
  ["uniqueStrengths", "Ce face unic / mai bine"], ["securityConcerns", "Securitate"], ["implementationPath", "Cale de implementare"], ["testRequired", "Test necesar"],
  ["status", "Status"], ["hubDecision", "Decizie Hub"], ["confidence", "Încredere"], ["notes", "Note"],
];

function capabilityDoc(cfg, title, intro) {
  const records = cfg?.records || [];
  const byCat = new Map();
  for (const r of records) (byCat.get(r.category || "other") || byCat.set(r.category || "other", []).get(r.category || "other")).push(r);
  const lines = [header(title, cfg, intro)];
  if (cfg?.summary) lines.push("## Rezumat", "", cfg.summary, "");
  lines.push("## Tabel sintetic", "", "| ID | Capabilitate | Status | Plan | Inclus | Risc API | Control | Decizie Hub | Relevanță |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of records) lines.push(`| ${esc(r.id)} | ${cell(r.feature, 70)} | ${esc(r.status)} | ${cell(r.planRequired, 60)} | ${esc(r.subscriptionIncluded)} | ${esc(r.apiBillingRisk)} | ${esc(r.programmaticIntegration)} | ${esc(r.hubDecision)} | ${esc(r.hubRelevance)} |`);
  lines.push("");
  if (cfg?.indexItems?.length) {
    lines.push("## Index de surse (anunțuri / release notes)", "", "| Data | Titlu | Relevanță | URL |", "|---|---|---|---|");
    for (const i of cfg.indexItems) lines.push(`| ${esc(i.date)} | ${cell(i.title, 90)} | ${cell(i.hubRelevance, 80)} | ${esc(i.url)} |`);
    lines.push("");
  }
  for (const [cat, items] of byCat) {
    lines.push(`## ${cat}`, "");
    for (const r of items) {
      lines.push(`### ${esc(r.feature)} (\`${r.id}\`)`, "");
      for (const [key, label] of FIELD_LABELS) if (r[key] !== undefined && r[key] !== "") lines.push(`- **${label}:** ${esc(Array.isArray(r[key]) ? r[key].join(", ") : r[key])}`);
      if (r.sourcesChecked?.length) lines.push(`- **Surse citite:** ${r.sourcesChecked.map(esc).join(" · ")}`);
      if (r.verification) lines.push(`- **Verificare adversarială:** ${esc(r.verification.verdict)}${r.verification.correctedFields?.length ? ` (corectat: ${r.verification.correctedFields.map(esc).join(", ")})` : ""}${r.verification.note ? ` — ${esc(r.verification.note)}` : ""}`);
      lines.push("");
    }
  }
  if (cfg?.openQuestions?.length) lines.push("## Întrebări deschise", "", list(cfg.openQuestions), "");
  if (cfg?.unreachableSources?.length) lines.push("## Surse inaccesibile", "", list(cfg.unreachableSources), "");
  return lines.join("\n");
}

const openai = read("openai");
if (openai) write("V2_OPENAI_CAPABILITY_AUDIT.md", capabilityDoc(openai, "Audit capabilități OpenAI (Milestone 01)",
  "Recapitularea DevDay 2026 (29.09.2026) este indexul; documentația specifică este autoritatea tehnică. Statusurile descriu contul tău, nu disponibilitatea generală: DOCUMENTED ≠ AVAILABLE."));
const anthropic = read("anthropic");
if (anthropic) write("V2_ANTHROPIC_CAPABILITY_AUDIT.md", capabilityDoc(anthropic, "Audit capabilități Anthropic / Claude (Milestone 01)",
  "Surse: Anthropic Newsroom, Claude Help Center (release notes, planuri Pro/Max), documentația Claude Code, plus dovezi locale fără inferență (claude auth status, claude agents --json, skills/connectori ai contului)."));
const standards = read("standards");
if (standards) write("V2_STANDARDS_AUDIT.md", capabilityDoc(standards, "Standarde deschise (Agent Skills, MCP, AGENTS.md, A2A)",
  "Standardele sunt stratul de portabilitate între ecosisteme; Hub-ul le preferă formatelor proprietare."));

const matrix = read("matrix");
if (matrix) {
  const lines = [header("Matricea cross-ecosistem (decizii de inginerie)", matrix,
    "Nu este o comparație de marketing și nu declară un câștigător general: pentru fiecare capabilitate alege calea cea mai bună azi, cu fallback, risc de facturare, nivel de control și ce trebuie să construiască Hub-ul. Hub-ul deține întotdeauna starea operațională cross-provider.")];
  lines.push("| Capabilitate | OpenAI nativ | Anthropic nativ | V1/V2 | Terț | Cea mai bună cale acum | Fallback | Risc facturare | Control programatic | Hub trebuie să construiască | Proprietar canonic |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of matrix.rows || []) lines.push(`| **${esc(r.capability)}** | ${cell(r.openaiNative)} | ${cell(r.anthropicNative)} | ${cell(r.v1Capability)} | ${cell(r.thirdPartyCandidate)} | ${cell(r.bestCurrentPath)} | ${cell(r.fallback)} | ${cell(r.subscriptionBillingRisk)} | ${cell(r.programmaticControl)} | ${cell(r.hubImplementationRequired)} | ${cell(r.canonicalOwner)} |`);
  lines.push("", "## Justificări", "");
  for (const r of matrix.rows || []) lines.push(`- **${esc(r.capability)}:** ${esc(r.rationale)}${r.reviewCorrections?.length ? ` _(corectat la review: ${r.reviewCorrections.map(esc).join("; ")})_` : ""}`);
  if (matrix.notes?.length) lines.push("", "## Note", "", list(matrix.notes));
  write("V2_AI_ECOSYSTEM_MATRIX.md", lines.join("\n"));
}

const frameworks = read("frameworks");
// OpenAI, Anthropic and Agent Hub V1 are evaluated first, on the same fields (systems.json).
const systems = read("systems");
if (frameworks) {
  const entries = [...(systems?.systems || []), ...(frameworks.frameworks || [])];
  const lines = [header("Evaluarea frameworkurilor și platformelor", frameworks,
    "Ecosistemele OpenAI și Anthropic și Agent Hub V1 sunt evaluate primele; frameworkurile open-source sunt evaluate DUPĂ auditurile native, ca să nu reconstruim funcții native. Decizii: REUSE / ADAPT / INTEGRATE / REIMPLEMENT / REFERENCE / RETIRE / REJECT.")];
  if (frameworks.summary) lines.push("## Decizii", "", frameworks.summary, "");
  lines.push("| Sistem | Scop | Versiune / dată | Licență | Windows | Facturare | Suprapunere OpenAI | Suprapunere Anthropic | Valoare unică | Decizie |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const f of entries) lines.push(`| **${esc(f.name)}** | ${cell(f.purpose, 90)} | ${cell(f.versionDate, 60)} | ${cell(f.license, 40)} | ${cell(f.windowsSupport, 60)} | ${cell(f.billing, 80)} | ${cell(f.nativeOpenaiOverlap, 90)} | ${cell(f.nativeAnthropicOverlap, 90)} | ${cell(f.uniqueValue, 90)} | **${esc(f.decision)}** |`);
  lines.push("");
  for (const f of entries) {
    lines.push(`## ${esc(f.name)}`, "", `- **Repository:** ${esc(f.repoUrl)}${f.verifiedOfficial === false ? " (neconfirmat ca oficial)" : ""}`, `- **Scop:** ${esc(f.purpose)}`,
      `- **Versiune / dată:** ${esc(f.versionDate)}`, `- **Licență:** ${esc(f.license)}`, `- **Maturitate:** ${esc(f.maturity)}`, `- **Securitate:** ${esc(f.security)}`,
      `- **Windows:** ${esc(f.windowsSupport)}`, `- **Dependențe:** ${esc(f.dependencies)}`, `- **Facturare:** ${esc(f.billing)}`, `- **Complexitate operațională:** ${esc(f.operationalComplexity)}`,
      `- **Suprapunere nativă OpenAI:** ${esc(f.nativeOpenaiOverlap)}`, `- **Suprapunere nativă Anthropic:** ${esc(f.nativeAnthropicOverlap)}`, `- **Valoare unică:** ${esc(f.uniqueValue)}`,
      `- **Decizie:** **${esc(f.decision)}** — ${esc(f.rationale)}`, `- **Ownership propus:** ${esc(f.ownershipProposal)}`, "", "**Puncte forte**", "", list(f.strengths), "", "**Puncte slabe**", "", list(f.weaknesses), "",
      "**Componente reutilizabile**", "", list(f.reusableComponents), "");
    if (f.sourcesChecked?.length) lines.push(`Surse: ${f.sourcesChecked.map(esc).join(" · ")}`, "");
    if (f.verification) lines.push(`Verificare adversarială: ${esc(f.verification.verdict)}${f.verification.correctedFields?.length ? ` (corectat: ${f.verification.correctedFields.map(esc).join(", ")})` : ""}${f.verification.note ? ` — ${esc(f.verification.note)}` : ""}`, "");
  }
  write("V2_FRAMEWORK_EVALUATION.md", lines.join("\n"));
}

const surfaces = read("surfaces");
if (surfaces) {
  const ops = ["start", "resume", "sendInput", "streamEvents", "interrupt", "stop", "prepareHandoff", "getStatus", "getArtifacts"];
  const short = (s) => ({ SUPPORTED: "✔", ASSISTED: "A", PLANNED: "P", UNSUPPORTED: "—" }[s] || "—");
  const lines = [header("Suprafețe de execuție (ExecutionSurface)", surfaces,
    "Același provider oferă mai multe suprafețe. Routerul alege PROVIDER + MODEL + SUPRAFAȚĂ + UNELTE + MEDIU. Nivel de control: PROGRAMMATIC (Hub-ul o conduce prin CLI/protocol oficial), ASSISTED (tu o rulezi în aplicația vendorului; Hub-ul pregătește și înregistrează), NATIVE_INTERACTIVE, MIRROR (Hub-ul doar observă), NONE.")];
  lines.push("| ID | Provider | Tip | Control | Facturare | Locație | Disponibilitate (bază) | Decizie Hub |", "|---|---|---|---|---|---|---|---|");
  for (const s of surfaces.surfaces) lines.push(`| \`${s.id}\` | ${s.provider} | ${esc(s.surfaceType)} | ${s.programmaticControl} | ${s.billingMode} | ${s.location} | ${s.availability} | ${esc(s.hubDecision)} |`);
  lines.push("", "## Operații ExecutionSurfaceAdapter", "", "✔ SUPPORTED · A ASSISTED · P PLANNED · — UNSUPPORTED (valoare reală, întoarsă apelantului)", "",
    `| Suprafață | ${ops.join(" | ")} |`, `|---|${ops.map(() => "---").join("|")}|`);
  for (const s of surfaces.surfaces) {
    const o = s.operations || {};
    lines.push(`| \`${s.id}\` | ${ops.map((op) => short(typeof o[op] === "string" ? o[op] : o[op]?.support)).join(" | ")} |`);
  }
  lines.push("", "## Detalii", "");
  for (const s of surfaces.surfaces) {
    lines.push(`### ${esc(s.name)} (\`${s.id}\`)`, "", esc(s.description), "", `- Capabilități: ${esc((s.capabilities || []).join(", "))}`, `- Platformă: ${esc(s.platform)} · Plan: ${esc(s.planRequirement)} · Auth: ${esc(s.authMode)}`,
      `- Disponibilitate de bază: ${s.availability} — ${esc(s.availabilityReason)}`, `- Restricții de siguranță: ${esc((s.safetyConstraints || []).join("; "))}`, "");
  }
  write("V2_EXECUTION_SURFACES.md", lines.join("\n"));
}
