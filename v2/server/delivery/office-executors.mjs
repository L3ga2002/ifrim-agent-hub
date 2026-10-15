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
import { hashCanonical } from "../core/canonical.mjs";

export const OFFICE_ARTIFACTS = Object.freeze(["document", "workbook", "campaign"]);
const refuse = (code, message) => new HubError("policy", message, { code });
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const day = (iso) => { try { return new Date(iso).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" }); } catch { return String(iso).slice(0, 10); } };

/**
 * `appCheck`: "com" (Word/Excel through COM) | "skip" (tests without Office: the level stays FILE_CHECKED and says APP_NOT_RUN).
 * The live Hub uses "com"; config.testMode defaults to "skip" unless HUB_V2_OFFICE_COM=1.
 */
export function createOfficeExecutors({ deliveries, factory, opsPlans, config, appCheck = (config.testMode && process.env.HUB_V2_OFFICE_COM !== "1") ? "skip" : "com" }) {
  const describedDelivery = id => { const d = deliveries.get(id); return d ? { ...d, template: deliveries.effectiveTemplate(d) } : null; };
  function bound(params, planId) {
    let d = deliveries.need(params.deliveryId);
    if (d.status === "PLANNED" && d.opsPlanId === planId) d = deliveries.startDirect(d.id, planId);
    if (d.opsPlanId !== planId) throw refuse("CAPTURE_NOT_BOUND", "Pasul nu aparține planului acestei livrări.");
    if (!["ACTIVE", "READY", "NEEDS_OWNER"].includes(d.status)) throw refuse("DELIVERY_NOT_ACTIVE", `Livrarea e ${d.status}; pașii ei nu rulează.`);
    return { ...d, template: deliveries.effectiveTemplate(d, { planId }) };
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
        const d = describedDelivery(deliveryId);
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
        const d = describedDelivery(deliveryId);
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
        const d = describedDelivery(deliveryId);
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
        const d = describedDelivery(deliveryId);
        return { title: "Scrie cuprinsul dosarului (README + manifest cu sha256 pentru fiecare fișier)", params: { deliveryId },
          ops: [{ op: "export.local", destination: d ? path.join(folderOf(d), "README.md") : undefined }], folders: d ? [folderOf(d)] : [], observed: [], transmitted: [], outputs: ["README.md + manifest.json în dosar"] };
      },
      run: async ({ params, planId, authorize }) => {
        const d = bound(params, planId);
        const root = folderOf(d);
        // Closure R-PACK: a file kept by proof from an earlier delivery is COPIED into this folder (the same verified bytes, never
        // regenerated), so the package stands on its own after the source folder moves or disappears; the source stays untouched.
        const reusedSource = (d.template.reused || []).map((r) => ({ kind: r.kind, file: r.file, sha256: r.sha256, sourceDeliveryId: r.sourceDeliveryId, inputsSha: r.inputsSha, reason: r.reason }));
        const localCopies = [];
        for (const r of reusedSource) {
          let buf = null;
          try { buf = fs.readFileSync(r.file); } catch { buf = null; }
          // Review F7: the reused file is still the one the card named (the card may have waited); a changed or missing file stops the step.
          if (!buf || sha(buf) !== r.sha256) {
            // An earlier run of this step may already have copied it (resume): the local copy with the confirmed bytes is enough.
            // The copy may carry the next free name ("… (2).xlsx") when the folder already held another file of that name.
            const ext = path.extname(r.file);
            const local = (fs.existsSync(root) ? fs.readdirSync(root) : []).filter((n) => path.extname(n).toLowerCase() === ext.toLowerCase())
              .map((n) => path.join(root, n)).find((p) => { try { return fs.statSync(p).isFile() && sha(fs.readFileSync(p)) === r.sha256; } catch { return false; } });
            if (local) { localCopies.push({ ...r, local, copied: false }); continue; }
            throw refuse("REUSED_FILE_CHANGED", `${path.basename(r.file)} nu mai e fișierul refolosit din planul confirmat (${buf ? "conținut schimbat" : "lipsește"}); cere livrarea din nou ca să fie regenerat.`);
          }
          const w = writeOnce(root, path.basename(r.file), buf, authorize);
          if (sha(fs.readFileSync(w.file)) !== r.sha256) throw refuse("REUSED_COPY_MISMATCH", `Copia lui ${path.basename(r.file)} în dosarul nou nu are aceiași octeți.`);
          localCopies.push({ ...r, local: w.file, copied: !w.reused });
        }
        const list = [];
        const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (!/^(README\.md|manifest\.json)$/i.test(e.name) && !/\.tmp$/.test(e.name)) list.push(p); } };
        walk(root);
        list.sort();
        const files = list.map((p) => { const b = fs.readFileSync(p); return { path: path.relative(root, p).replace(/\\/g, "/"), bytes: b.length, sha256: sha(b) }; });
        const steps = (opsPlans.view(planId)?.steps || []).filter((s) => s.status === "DONE" && s.result);
        const level = (kind) => steps.find((s) => s.kind === kind)?.result?.level || steps.find((s) => s.kind === kind)?.result?.calendarLevel || null;
        // R-REV + closure R-PACK: an artifact kept by proof (same inputs, same bytes) is listed by its LOCAL path in this folder (relative,
        // in `files` with the same sha), with its provenance (the source delivery and its original file) and the reason.
        const reused = localCopies.map((r) => ({ kind: r.kind, file: path.relative(root, r.local).replace(/\\/g, "/"), sha256: r.sha256,
          source: { deliveryId: r.sourceDeliveryId, file: r.file }, inputsSha: r.inputsSha, reason: r.reason, copiedVerified: true }));
        const manifest = { schema: 1, deliveryId: d.id, project: d.template.project.name, folder: root, files, ...(reused.length ? { reused } : {}),
          verification: { document: level("delivery.office.document"), workbook: level("delivery.office.workbook"), campaignCalendar: level("delivery.campaign") }, published: false, note: "Date demonstrative; nimic publicat." };
        const readme = [`# ${d.title}`, "", "Dosarul prezentării, pregătit de Ifrim Agent Hub dintr-un singur plan confirmat. Nimic nu a fost publicat.", "",
          "| Fișier | Mărime |", "|---|---|", ...files.map((f) => `| ${f.path} | ${Math.max(1, Math.round(f.bytes / 1024))} KB |`), "",
          "Verificări: " + Object.entries(manifest.verification).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", "), "",
          ...(reused.length ? ["Refolosite din livrarea anterioară (aceleași intrări, aceiași octeți), copiate și verificate în acest dosar:", ...reused.map((r) => `- ${r.file} — sha256 ${r.sha256.slice(0, 16)}… — din livrarea ${r.source.deliveryId} — ${r.reason}`), ""] : []),
          "Date demonstrative: programările și cifrele sunt exemple; prețurile sunt „De stabilit”.", ""].join("\n");
        // README/manifest describe the folder as it is now: rewritten on purpose (they are the index, not a deliverable copy).
        authorize({ op: "export.local", destination: path.join(root, "README.md") });
        fs.writeFileSync(path.join(root, "README.md"), readme, "utf8");
        fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        // Closure R-PACK: the folder is checked on its own (manifest → every file inside it, by sha), never through the source folder.
        const self = verifyPackageFolder(root);
        if (!self.ok) throw refuse("PACKAGE_NOT_SELF_CONTAINED", `Dosarul nu se verifică singur: ${self.problems.join("; ")}`);
        return { result: { folder: root, files: files.length, verification: manifest.verification, ...(reused.length ? { reused: localCopies.map((r) => ({ kind: r.kind, file: r.local, sha256: r.sha256, sourceDeliveryId: r.sourceDeliveryId })) } : {}) } };
      },
    },
  };
}

/**
 * Closure R-PACK: a delivery folder checked on its own — manifest.json read from `root`, every listed file a relative path inside the
 * folder with its bytes and sha256, every reused entry a local file of the folder listed with the same sha (its source is provenance
 * only, never read). Works the same after the folder is moved or the source delivery is gone. → { ok, problems, files }
 */
export function verifyPackageFolder(root) {
  const problems = [];
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")); } catch { return { ok: false, problems: ["manifest.json lipsește sau nu se poate citi"], files: 0 }; }
  const real = (() => { try { return fs.realpathSync.native(root); } catch { return path.resolve(root); } })();
  const inside = (rel) => {
    if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes("..")) return null;
    const abs = path.resolve(real, rel);
    return abs.toLowerCase().startsWith(`${real.toLowerCase()}${path.sep}`) ? abs : null;
  };
  const listed = new Map();
  for (const f of Array.isArray(manifest.files) ? manifest.files : []) {
    const abs = inside(f?.path);
    if (!abs) { problems.push(`${f?.path}: nu e o cale din dosar`); continue; }
    let buf = null;
    try { const st = fs.lstatSync(abs); if (st.isFile() && !st.isSymbolicLink()) buf = fs.readFileSync(abs); } catch { buf = null; }
    if (!buf) { problems.push(`${f.path}: lipsește din dosar`); continue; }
    if (sha(buf) !== f.sha256 || buf.length !== f.bytes) problems.push(`${f.path}: octeți diferiți de manifest`);
    listed.set(String(f.path).toLowerCase(), f.sha256);
  }
  // A file in the folder that the manifest does not list (README / manifest themselves and temporary files aside) is reported too.
  const walk = (dir) => { let n = []; try { n = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of n) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (!/^(README\.md|manifest\.json)$/i.test(e.name) && !/\.tmp$/.test(e.name)) { const rel = path.relative(real, p).replace(/\\/g, "/"); if (!listed.has(rel.toLowerCase()) && !problems.some((x) => x.startsWith(`${rel}:`))) problems.push(`${rel}: nu e în manifest`); } } };
  walk(real);
  for (const r of Array.isArray(manifest.reused) ? manifest.reused : []) {
    if (!inside(r?.file)) { problems.push(`${r?.file}: fișierul refolosit nu e în dosar (trimitere în afara lui)`); continue; }
    if (listed.get(String(r.file).toLowerCase()) !== r.sha256) problems.push(`${r.file}: fișierul refolosit nu e listat în dosar cu același sha256`);
  }
  return { ok: problems.length === 0, problems, files: listed.size };
}

/**
 * R-REV: whether the Excel workbook of an earlier delivery of the lineage (`source`, the one that generated it) may be kept by a refresh
 * instead of being generated again. Proven, never assumed: the source's DONE workbook step recorded a file and its sha256; the file on
 * disk still has that sha; and the generator run NOW on the current demo data with the source's own creation date produces exactly those
 * bytes (same data, same generator → same file). → { ok: true, reuse: { kind, sourceDeliveryId, file, sha256, inputsSha, level, reason } }
 * | { ok: false, code, detail }. Pure apart from reading the source's file.
 */
export function workbookReuse({ source, sourcePlan }) {
  const parent = source;
  const step = (sourcePlan?.steps || []).find((s) => s.kind === "delivery.office.workbook" && s.status === "DONE" && s.result?.file && s.result?.sha256);
  if (!step) return { ok: false, code: "NO_PARENT_WORKBOOK", detail: "livrarea anterioară nu are un registru Excel terminat" };
  const file = String(step.result.file);
  let onDisk = null;
  try { onDisk = sha(fs.readFileSync(file)); } catch { return { ok: false, code: "FILE_MISSING", detail: `${path.basename(file)} nu mai există` }; }
  if (onDisk !== step.result.sha256) return { ok: false, code: "FILE_CHANGED", detail: `${path.basename(file)} s-a schimbat după livrare` };
  const wb = bookingsWorkbook();
  const rebuilt = sha(buildXlsx(wb.model, { created: new Date(parent.createdAt) }));
  if (rebuilt !== step.result.sha256) return { ok: false, code: "INPUTS_CHANGED", detail: "datele demonstrative sau generatorul s-au schimbat (registrul nou ar fi diferit)", rebuilt, recorded: step.result.sha256 };
  return { ok: true, reuse: { kind: "workbook", sourceDeliveryId: String(parent.id), file, sha256: step.result.sha256, inputsSha: hashCanonical(wb.model), level: step.result.level || null,
    reason: "date demonstrative independente de cod: aceleași date și același generator dau exact același fișier (sha256 verificat)" } };
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
