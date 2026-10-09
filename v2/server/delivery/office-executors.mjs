// Stage before M12 — the office part of a delivery package (requested in the owner's sentence: „un document Word, un Excel cu date
// demonstrative, un pachet de campanie… totul într-un singur dosar”). Same plan, same confirmation, same folder as the clips and the
// summary. Each step: generate (deterministic, no model) → read the file back → verify in the real application (Word / Excel through
// COM, own invisible instance, read-only) → record the level reached. A re-run after an interruption reuses an identical file instead of
// writing a copy (resume never duplicates). Nothing is published or sent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { generateDocx, generateXlsx, checkDocxFile, checkXlsxFile, verifyDocxInWord, verifyXlsxInExcel } from "../office/office.mjs";
import { buildDocx, expectedDocxShape } from "../office/docx.mjs";
import { buildXlsx, formulaCells } from "../office/xlsx.mjs";
import { presentationDocument, bookingsWorkbook } from "../office/demo-content.mjs";
import { buildCampaign, campaignMarkdown, campaignWorkbook } from "../office/campaign.mjs";

export const OFFICE_ARTIFACTS = Object.freeze(["document", "workbook", "campaign"]);
const refuse = (code, message) => new HubError("policy", message, { code });
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const day = (iso) => { try { return new Date(iso).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" }); } catch { return String(iso).slice(0, 10); } };

/**
 * `appCheck`: "com" (Word/Excel through COM) | "skip" (tests without Office: the level stays FILE_CHECKED and says APP_NOT_RUN).
 * The live Hub uses "com"; config.testMode defaults to "skip" unless HUB_V2_OFFICE_COM=1.
 */
export function createOfficeExecutors({ deliveries, factory, opsPlans, config, appCheck = (config.testMode && process.env.HUB_V2_OFFICE_COM !== "1") ? "skip" : "com" }) {
  function bound(params, planId) {
    let d = deliveries.need(params.deliveryId);
    if (d.status === "PLANNED" && d.opsPlanId === planId) d = deliveries.startDirect(d.id, planId);
    if (d.opsPlanId !== planId) throw refuse("CAPTURE_NOT_BOUND", "Pasul nu aparține planului acestei livrări.");
    if (!["ACTIVE", "READY", "NEEDS_OWNER"].includes(d.status)) throw refuse("DELIVERY_NOT_ACTIVE", `Livrarea e ${d.status}; pașii ei nu rulează.`);
    return d;
  }
  const folderOf = (d) => path.join(d.template.exports.dir, d.template.exports.folder);
  const workDir = () => path.join(config.workDir || path.join(config.dataDir, "work"), "office");

  /** The facts the documents may state, all from the Hub's records (criteria of the verified bundle, the exported clips). */
  function facts(d) {
    const binding = factory.deliveryBinding(d.missionId) || {};
    const items = deliveries.items(d.id).filter((i) => i.status === "CURRENT");
    const renders = Object.fromEntries(items.filter((i) => i.kind === "render").map((i) => [i.role, i]));
    const clips = items.filter((i) => i.kind === "export").map((i) => {
      const file = i.meta?.file || i.refId;
      const durationMs = renders[i.role]?.meta?.durationMs || null;
      return { role: i.role, name: path.basename(file), file, sha256: i.refSha, format: i.role === "vertical" ? "9:16" : "16:9", duration: durationMs ? `${Math.round(durationMs / 1000)} s` : "", durationSec: durationMs ? Math.round(durationMs / 1000) : null };
    });
    const criteria = (binding.criteria || []).map((c) => ({ id: c.id, text: String(c.text || "").slice(0, 160), status: String(c.status || "").startsWith("PASS") ? "PASS" : String(c.status || "—") }));
    const captures = items.filter((i) => i.kind === "capture").map((i) => ({ name: `Flux filmat în browser (${i.role === "mobile" ? "telefon, 390 px" : "desktop, 1280×720"})`, status: "PASS (dovada vizibilă)" }));
    return { criteria, siteChecks: captures, clips, siteUrl: d.template.preview.url, verifiedAt: binding.bundleId ? `pachetul verificat ${binding.bundleId}` : null, generatedAt: day(d.createdAt), createdAt: d.createdAt };
  }

  /** Writes `buf` as `name` in `dir` unless an identical file is already there (resume): { file, sha256, reused }. */
  function writeOnce(dir, name, buf, authorize) {
    const target = path.join(dir, name);
    authorize({ op: "export.local", destination: target });
    const digest = sha(buf);
    if (fs.existsSync(target)) {
      if (sha(fs.readFileSync(target)) === digest) return { file: target, sha256: digest, reused: true };
      // Never overwrite something else: the next free name.
      const ext = path.extname(name);
      for (let i = 2; i < 100; i += 1) {
        const alt = path.join(dir, `${name.slice(0, -ext.length)} (${i})${ext}`);
        if (!fs.existsSync(alt)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(alt, buf); return { file: alt, sha256: digest, reused: false }; }
        if (sha(fs.readFileSync(alt)) === digest) return { file: alt, sha256: digest, reused: true };
      }
      throw refuse("OFFICE_NAME_EXHAUSTED", `Prea multe versiuni ale lui ${name}.`);
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
    return { file: target, sha256: digest, reused: false };
  }

  async function appVerify(kind, file, expected, pdfOut) {
    if (appCheck !== "com") return { ok: true, level: "APP_NOT_RUN", note: "Verificarea în aplicație nu rulează în acest mediu (fără Office)." };
    return kind === "docx" ? verifyDocxInWord(file, expected, { pdfOut, workDir: workDir() }) : verifyXlsxInExcel(file, expected, { pdfOut, workDir: workDir() });
  }
  const fail = (what, r) => new HubError("tool", `${what}: ${r.error || (r.problems || []).join("; ") || r.level}`, { code: "OFFICE_VERIFY_FAILED", data: { level: r.level } });

  return {
    "delivery.office.document": {
      describe: ({ deliveryId }) => {
        const d = deliveries.get(deliveryId);
        const dest = d ? path.join(folderOf(d), "Prezentare demo.docx") : undefined;
        return { title: "Scrie documentul Word al prezentării (titluri, tabele, date demonstrative) și verifică-l în Word", params: { deliveryId },
          ops: [{ op: "export.local", destination: dest }, { op: "office.verify" }], folders: d ? [folderOf(d)] : [], observed: ["criteriile verificate și clipurile exportate ale livrării"], transmitted: [],
          outputs: ["Prezentare demo.docx + PDF (verificat în Word)"] };
      },
      run: async ({ params, planId, authorize }) => {
        const d = bound(params, planId);
        const f = facts(d);
        const model = presentationDocument(f);
        const buf = buildDocx(model, { created: new Date(d.createdAt) });
        const w = writeOnce(folderOf(d), "Prezentare demo.docx", buf, authorize);
        const shape = expectedDocxShape(model);
        const file = checkDocxFile(w.file, shape);
        if (!file.ok) throw fail("Documentul salvat nu are structura cerută", file);
        authorize({ op: "office.verify" });
        const pdf = w.file.replace(/\.docx$/i, ".pdf");
        authorize({ op: "export.local", destination: pdf });
        const app = await appVerify("docx", w.file, shape, fs.existsSync(pdf) && w.reused ? null : pdf);
        if (!app.ok) throw fail("Word nu confirmă documentul", app);
        return { result: { file: w.file, sha256: w.sha256, reused: w.reused, level: app.level === "APP_VERIFIED" ? "APP_VERIFIED" : "FILE_CHECKED", app: app.app || null, version: app.version || null,
          pages: app.pages || null, headings: file.headings.length, tables: file.tables.length, pdf: fs.existsSync(pdf) ? pdf : null } };
      },
    },

    "delivery.office.workbook": {
      describe: ({ deliveryId }) => {
        const d = deliveries.get(deliveryId);
        const dest = d ? path.join(folderOf(d), "Programari demo.xlsx") : undefined;
        return { title: "Construiește registrul Excel cu programări demonstrative (formule, filtre, formatare) și recalculează-l în Excel", params: { deliveryId },
          ops: [{ op: "export.local", destination: dest }, { op: "office.verify" }], folders: d ? [folderOf(d)] : [], observed: [], transmitted: [], outputs: ["Programari demo.xlsx + PDF (formule verificate de Excel)"] };
      },
      run: async ({ params, planId, authorize }) => {
        const d = bound(params, planId);
        const wb = bookingsWorkbook();
        const buf = buildXlsx(wb.model, { created: new Date(d.createdAt) });
        const w = writeOnce(folderOf(d), "Programari demo.xlsx", buf, authorize);
        const file = checkXlsxFile(w.file, { formulas: formulaCells(wb.model), sheets: wb.model.sheets });
        if (!file.ok) throw fail("Registrul salvat nu are formulele sau filtrele cerute", file);
        authorize({ op: "office.verify" });
        const pdf = w.file.replace(/\.xlsx$/i, ".pdf");
        authorize({ op: "export.local", destination: pdf });
        const app = await appVerify("xlsx", w.file, wb.expect, fs.existsSync(pdf) && w.reused ? null : pdf);
        if (!app.ok) throw fail("Excel nu confirmă valorile formulelor", app);
        return { result: { file: w.file, sha256: w.sha256, reused: w.reused, level: app.level === "APP_VERIFIED" ? "APP_VERIFIED" : "FILE_CHECKED", app: app.app || null, version: app.version || null,
          formulasChecked: app.cells?.length || 0, formulas: file.formulas, pdf: fs.existsSync(pdf) ? pdf : null } };
      },
    },

    "delivery.campaign": {
      describe: ({ deliveryId }) => {
        const d = deliveries.get(deliveryId);
        const dir = d ? path.join(folderOf(d), "Campanie") : undefined;
        return { title: "Pregătește local pachetul de campanie (obiectiv, public, mesaj, calendar, texte și variante pe canale), fără publicare", params: { deliveryId },
          ops: [{ op: "export.local", destination: dir ? path.join(dir, "campanie.md") : undefined }, { op: "office.verify" }], folders: d ? [folderOf(d)] : [], observed: ["clipurile exportate ale livrării"], transmitted: [],
          outputs: ["dosarul Campanie (campanie.md, calendar.xlsx, texte pe canale, campanie.json); nimic publicat"] };
      },
      run: async ({ params, planId, authorize }) => {
        const d = bound(params, planId);
        const f = facts(d);
        const c = buildCampaign({ noun: "programarea", proofs: f.criteria.filter((x) => x.status === "PASS").map((x) => `${x.id}: ${x.text}`), cta: "Hai să discutăm",
          materials: f.clips.map((m) => ({ name: m.name, file: m.file, format: m.format, sha256: m.sha256, durationSec: m.durationSec })), startDate: new Date(Date.parse(d.createdAt) + 4 * 86400000).toISOString().slice(0, 10) });
        const dir = path.join(folderOf(d), "Campanie");
        const files = [];
        files.push(writeOnce(dir, "campanie.md", Buffer.from(campaignMarkdown(c), "utf8"), authorize));
        files.push(writeOnce(dir, "campanie.json", Buffer.from(`${JSON.stringify(c, null, 2)}\n`, "utf8"), authorize));
        for (const t of c.texts) files.push(writeOnce(path.join(dir, "texte"), `${t.channel}.txt`, Buffer.from(`${t.text}\n`, "utf8"), authorize));
        const cal = campaignWorkbook(c);
        const x = writeOnce(dir, "calendar.xlsx", buildXlsx(cal.model, { created: new Date(d.createdAt) }), authorize);
        files.push(x);
        const file = checkXlsxFile(x.file, { formulas: formulaCells(cal.model), sheets: cal.model.sheets });
        if (!file.ok) throw fail("Calendarul campaniei nu are structura cerută", file);
        authorize({ op: "office.verify" });
        const app = await appVerify("xlsx", x.file, cal.expect, null);
        if (!app.ok) throw fail("Excel nu confirmă calendarul campaniei", app);
        const complete = Boolean(c.objective && c.audience.length && c.message && c.calendar.length && c.texts.length === c.channels.length);
        return { result: { dir, files: files.map((w) => path.relative(folderOf(d), w.file)), channels: c.channels.length, posts: c.calendar.length, materials: c.materials.length, missing: c.missing,
          complete, calendarLevel: app.level === "APP_VERIFIED" ? "APP_VERIFIED" : "FILE_CHECKED", published: false } };
      },
    },

    "delivery.package.index": {
      describe: ({ deliveryId }) => {
        const d = deliveries.get(deliveryId);
        return { title: "Scrie cuprinsul dosarului (README + manifest cu sha256 pentru fiecare fișier)", params: { deliveryId },
          ops: [{ op: "export.local", destination: d ? path.join(folderOf(d), "README.md") : undefined }], folders: d ? [folderOf(d)] : [], observed: [], transmitted: [], outputs: ["README.md + manifest.json în dosar"] };
      },
      run: async ({ params, planId, authorize }) => {
        const d = bound(params, planId);
        const root = folderOf(d);
        const list = [];
        const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (!/^(README\.md|manifest\.json)$/i.test(e.name) && !/\.tmp$/.test(e.name)) list.push(p); } };
        walk(root);
        list.sort();
        const files = list.map((p) => { const b = fs.readFileSync(p); return { path: path.relative(root, p).replace(/\\/g, "/"), bytes: b.length, sha256: sha(b) }; });
        const steps = (opsPlans.view(planId)?.steps || []).filter((s) => s.status === "DONE" && s.result);
        const level = (kind) => steps.find((s) => s.kind === kind)?.result?.level || steps.find((s) => s.kind === kind)?.result?.calendarLevel || null;
        const manifest = { schema: 1, deliveryId: d.id, project: d.template.project.name, folder: root, files,
          verification: { document: level("delivery.office.document"), workbook: level("delivery.office.workbook"), campaignCalendar: level("delivery.campaign") }, published: false, note: "Date demonstrative; nimic publicat." };
        const readme = [`# ${d.title}`, "", "Dosarul prezentării, pregătit de Ifrim Agent Hub dintr-un singur plan confirmat. Nimic nu a fost publicat.", "",
          "| Fișier | Mărime |", "|---|---|", ...files.map((f) => `| ${f.path} | ${Math.max(1, Math.round(f.bytes / 1024))} KB |`), "",
          "Verificări: " + Object.entries(manifest.verification).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", "), "",
          "Date demonstrative: programările și cifrele sunt exemple; prețurile sunt „De stabilit”.", ""].join("\n");
        // README/manifest describe the folder as it is now: rewritten on purpose (they are the index, not a deliverable copy).
        authorize({ op: "export.local", destination: path.join(root, "README.md") });
        fs.writeFileSync(path.join(root, "README.md"), readme, "utf8");
        fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        return { result: { folder: root, files: files.length, verification: manifest.verification } };
      },
    },
  };
}

/** Which office artifacts a sentence asks for (Romanian, diacritics folded). Pure. */
export function requestedArtifacts(text) {
  // A negated clause („fără Excel”, „nu face campania”) asks for nothing.
  const t = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/(?:^|\s)(?:fara|nu fa|nu face|nu vreau|nu e nevoie de)\s[^,.;:]*/g, " ");
  const out = [];
  if (/\b(word|docx|document(ul)?)\b/.test(t)) out.push("document");
  if (/\b(excel|xlsx|registru|foaie de calcul|tabel(ul)? excel)\b/.test(t)) out.push("workbook");
  if (/\bcampani(e|a|ei)\b/.test(t)) out.push("campaign");
  return out;
}
