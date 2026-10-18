// M10 Studio project bundle: export a content project (brief, scripts, storyboard, claims, every edit version, variants, the source
// files with their rights) to a folder with a hash-bound manifest `proiect-studio.json`, and import such a folder into a Studio — the
// project itself, not just an MP4. Import = preview (read-only: the manifest is JSON, never executed; every file is inside the folder,
// a regular file, with its sha256 checked) → ONE confirmation → the import through the services (library ingest, rights, content
// documents, edit versions, variants). IDs are remapped (a test hub's ids never become real identities); labels (SIMULATION …) and
// provenance are kept; approvals are NEVER imported (creative review stays pending). Re-importing the same manifest is idempotent.
// A folder without a manifest (an older delivery) can still be reconstructed explicitly from its edit plans and sources, with the
// missing parts listed — never presented as a lossless import.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { insertEditVersion } from "./review.mjs";

export const BUNDLE_FORMAT = "ifrim-studio-project";
export const BUNDLE_VERSION = 1;
export const BUNDLE_FILE = "proiect-studio.json";
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const ID_RE = /^(mav|ccl|mev|mep|mva)_[a-z0-9]+_[0-9a-f]{6,}$/;
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sha256Text = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Replaces every string that equals an old id by its new id (deep; objects and arrays rebuilt, nothing else touched). */
export function remapIds(value, map) {
  if (typeof value === "string") return map.has(value) ? map.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, map)]));
  return value;
}
const safeName = (s) => String(s || "asset").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "asset";

export function createProjectBundles({ db, bus, clock, assets, rights, content, edits, paths, importRoots }) {
  const now = () => clock().toISOString();

  // ---------------------------------------------------------------- export
  /** Writes the bundle of a content project into `dir` (sources under surse/; an identical file already there is reused, never overwritten). */
  function exportProject({ contentProjectId, dir, actor = "owner" }) {
    const d = content.detail(contentProjectId);
    const editRows = db.prepare("SELECT * FROM media_edit_projects WHERE content_project_id = ? ORDER BY created_at").all(contentProjectId);
    if (!editRows.length) throw new HubError("validation", "Proiectul nu are un plan de montaj de exportat.");
    fs.mkdirSync(path.join(dir, "surse"), { recursive: true });
    const editsOut = [];
    const assetIds = new Set();
    for (const e of editRows) {
      const versions = db.prepare("SELECT * FROM media_edit_versions WHERE edit_project_id = ? ORDER BY version").all(e.id);
      for (const v of versions) for (const m of JSON.stringify(parse(v.ir_json, {})).matchAll(/"assetVersionId":"([^"]+)"/g)) assetIds.add(m[1]);
      editsOut.push({ key: e.id, title: e.title, currentVersion: e.current_version, versions: versions.map((v) => ({ key: v.id, version: v.version, changeKind: v.change_kind, parentKey: v.parent_version_id,
        variantKey: v.variant_key, irSha256: v.ir_sha256, ir: parse(v.ir_json, {}), change: parse(v.change_json, {}) })) });
    }
    const existing = new Map(); // sha → relative name already in surse/
    for (const name of fs.readdirSync(path.join(dir, "surse"))) {
      const f = path.join(dir, "surse", name);
      try { if (fs.statSync(f).isFile()) existing.set(sha256File(f), `surse/${name}`); } catch { /* skip */ }
    }
    const assetsOut = [];
    for (const vid of assetIds) {
      const v = assets.getVersion(vid);
      if (!v) throw new HubError("conflict", `Materialul ${vid} folosit în montaj nu mai e în bibliotecă.`);
      const a = assets.get(v.assetId);
      const src = assets.versionPath(vid);
      let rel = existing.get(v.sha256);
      if (!rel) {
        const ext = path.extname(src) || "";
        rel = `surse/${safeName(a?.title || "asset")}-${v.sha256.slice(0, 8)}${ext}`;
        if (!fs.existsSync(path.join(dir, rel))) fs.copyFileSync(src, path.join(dir, rel));
        fs.chmodSync(path.join(dir, rel), 0o644);
      }
      const current = rights.current(v.assetId);
      assetsOut.push({ key: vid, file: rel, sha256: v.sha256, bytes: v.bytes, kind: a?.kind, category: a?.category, title: a?.title, origin: a?.origin, captureLabel: v.captureLabel || a?.captureLabel || null,
        rights: current.active.map((r) => ({ status: r.status, holder: r.holder, platforms: r.platforms, uses: r.uses, territory: r.territory, startsAt: r.startsAt, endsAt: r.endsAt, attribution: r.attribution, licenseRef: r.licenseRef })) });
    }
    const variants = db.prepare("SELECT v.* FROM media_variants v JOIN media_edit_projects p ON p.id = v.edit_project_id WHERE p.content_project_id = ? ORDER BY v.created_at").all(contentProjectId)
      .map((v) => ({ key: v.id, editKey: v.edit_project_id, platformKey: v.platform_key, masterKey: v.master_version_id, variantKey: v.variant_version_id }));
    const manifest = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: now(), exportedBy: actor,
      project: { title: d.project.title, format: d.project.format, platforms: d.project.platforms, audience: d.project.audience, presetId: d.project.presetId, presetVersion: d.project.presetVersion },
      labels: [...new Set(editsOut.flatMap((e) => e.versions.flatMap((v) => v.ir?.meta?.labels || [])))],
      documents: { brief: d.brief ? { body: d.brief.body, authorKind: d.brief.authorKind, author: d.brief.author } : null,
        scripts: (d.scripts || []).map((s) => ({ language: s.language, body: s.body, authorKind: s.authorKind, author: s.author })),
        storyboard: d.storyboard ? { body: d.storyboard.body, authorKind: d.storyboard.authorKind, author: d.storyboard.author } : null },
      claims: (d.claims || []).map((c) => ({ key: c.id, text: c.text, status: c.status, evidence: c.evidence, shot: c.shot, conditions: c.conditions })),
      assets: assetsOut, edits: editsOut, variants,
      approvals: { creative: "NOT_EXPORTED", note: "Aprobările nu se exportă: la import, revizuirea creativă e în așteptare." } };
    const text = JSON.stringify(manifest, null, 2);
    const tmp = path.join(dir, `${BUNDLE_FILE}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, path.join(dir, BUNDLE_FILE));
    bus.transaction(() => bus.append({ type: "media.project.exported", scopeType: "content", scopeId: contentProjectId, source: actor, payload: { assets: assetsOut.length, edits: editsOut.length, sha256: sha256Text(text).slice(0, 16) } }));
    return { file: path.join(dir, BUNDLE_FILE), sha256: sha256Text(text), assets: assetsOut.length, edits: editsOut.length, versions: editsOut.reduce((n, e) => n + e.versions.length, 0) };
  }

  // ---------------------------------------------------------------- preview (read-only)
  const inside = (root, p) => { const rel = path.relative(root, p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
  /** The folder must be (really) inside an allowed import root; returns its real path. */
  function realFolder(dir) {
    if (typeof dir !== "string" || !path.isAbsolute(dir) || dir.includes("\0") || /^\\\\/.test(dir)) throw new HubError("validation", "Folderul proiectului trebuie să fie o cale locală absolută.", { code: "IMPORT_PATH_INVALID" });
    let real;
    try { real = fs.realpathSync.native(dir); } catch { throw new HubError("not_found", "Folderul proiectului nu există.", { code: "IMPORT_PATH_MISSING" }); }
    if (!fs.statSync(real).isDirectory()) throw new HubError("validation", "Calea nu e un folder.", { code: "IMPORT_PATH_INVALID" });
    const roots = (importRoots() || []).map((r) => { try { return fs.realpathSync.native(r); } catch { return path.resolve(r); } });
    if (!roots.some((r) => inside(r.toLowerCase(), real.toLowerCase()))) throw new HubError("policy", `Folderul nu e într-un folder de import permis (${roots.join(", ") || "niciunul"}).`, { code: "IMPORT_OUTSIDE_ROOTS" });
    return real;
  }
  /** A file named by the manifest: relative, inside the folder, a regular file (no link), size and sha256 as declared. */
  function checkFile(root, rel, { sha256 = null, bytes = null } = {}) {
    if (typeof rel !== "string" || path.isAbsolute(rel) || rel.includes("\0") || rel.split(/[\\/]/).includes("..")) return { ok: false, problem: `cale nepermisă: ${rel}` };
    const abs = path.join(root, rel);
    if (!inside(root, abs)) return { ok: false, problem: `în afara folderului: ${rel}` };
    let st;
    try { st = fs.lstatSync(abs); } catch { return { ok: false, problem: `lipsește: ${rel}` }; }
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, problem: `nu e un fișier obișnuit: ${rel}` };
    if (bytes !== null && st.size !== bytes) return { ok: false, problem: `${rel}: dimensiune ${st.size}, declarat ${bytes}` };
    const sha = sha256File(abs);
    if (sha256 && sha !== sha256) return { ok: false, problem: `${rel}: hash diferit de manifest (modificat după export)` };
    return { ok: true, abs, sha256: sha, bytes: st.size };
  }

  function readManifest(root) {
    const file = path.join(root, BUNDLE_FILE);
    if (!fs.existsSync(file)) return null;
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_MANIFEST_BYTES) throw new HubError("validation", "Manifestul proiectului nu e un fișier valid.", { code: "BUNDLE_INVALID" });
    const text = fs.readFileSync(file, "utf8");
    let m;
    try { m = JSON.parse(text); } catch { throw new HubError("validation", "Manifestul proiectului nu e JSON valid.", { code: "BUNDLE_INVALID" }); }
    if (m.format !== BUNDLE_FORMAT || m.version !== BUNDLE_VERSION) throw new HubError("validation", `Format necunoscut (${m.format} v${m.version}).`, { code: "BUNDLE_FORMAT" });
    return { manifest: m, text, sha256: sha256Text(text) };
  }

  /** An older delivery without a manifest: the edit plans + sources, mapped explicitly; what cannot be restored is listed. */
  function reconstruct(root) {
    const plans = fs.readdirSync(root).filter((n) => /^plan-de-montaj.*\.json$/i.test(n)).sort();
    if (!plans.length) return null;
    const report = fs.existsSync(path.join(root, "qa-si-productie.json")) ? JSON.parse(fs.readFileSync(path.join(root, "qa-si-productie.json"), "utf8")) : null;
    const library = report?.steps?.find((s) => s.name === "library") || {};
    const sourceByRole = { capture: "surse/capture.mp4", endCard: "surse/end-card.png" };
    const assetsOut = [];
    for (const [role, rel] of Object.entries(sourceByRole)) if (library[role] && fs.existsSync(path.join(root, rel))) {
      const abs = path.join(root, rel);
      assetsOut.push({ key: library[role], file: rel, sha256: sha256File(abs), bytes: fs.statSync(abs).size, kind: role === "endCard" ? "image" : "video", category: role === "endCard" ? "brand_asset" : "screen_recording",
        title: role === "endCard" ? "Card final" : "Captură demo", origin: "OWNED", captureLabel: role === "endCard" ? "GENERATED" : "SIMULATION", rights: (report?.rights || []).length ? [{ status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"] }] : [] });
    }
    const versions = plans.map((n, i) => ({ key: `rec_v${i + 1}`, version: i + 1, changeKind: i === 0 ? "initial" : "patch", parentKey: i ? `rec_v${i}` : null, variantKey: null, ir: JSON.parse(fs.readFileSync(path.join(root, n), "utf8")) }));
    const manifest = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, reconstruction: true, project: { title: path.basename(root), format: "short", platforms: [], audience: "both" },
      labels: [...new Set(versions.flatMap((v) => v.ir?.meta?.labels || []))], documents: { brief: null, scripts: [], storyboard: null },
      claims: (report?.claims || []).map((c, i) => ({ key: `rec_claim_${i}`, text: c.text, status: c.status, evidence: c.evidence })), assets: assetsOut,
      edits: [{ key: "rec_edit", title: "Montaj (reconstruit)", versions }], variants: [] };
    const missing = ["brief", "scenariu", "storyboard", "planurile variantelor (doar fișierele MP4 există)", "legăturile afirmațiilor cu cadrele (id-urile din plan nu se pot reface)"];
    return { manifest, text: JSON.stringify(manifest), sha256: sha256Text(JSON.stringify(manifest)), missing };
  }

  function preview({ dir, actor = "owner" }) {
    const root = realFolder(dir);
    const loaded = readManifest(root) || reconstruct(root);
    if (!loaded) throw new HubError("validation", `Folderul nu conține un proiect Studio (${BUNDLE_FILE}) și nici planuri de montaj de reconstruit.`, { code: "BUNDLE_MISSING" });
    const m = loaded.manifest;
    const problems = [];
    const files = (m.assets || []).map((a) => { const c = checkFile(root, a.file, { sha256: a.sha256, bytes: a.bytes ?? null }); if (!c.ok) problems.push(c.problem); return { key: a.key, file: a.file, ok: c.ok, sha256: c.sha256 || null, bytes: c.bytes ?? null, kind: a.kind, origin: a.origin, captureLabel: a.captureLabel, rights: (a.rights || []).length }; });
    // Every asset an edit version points to must be one of the bundle's files (nothing outside the folder is pulled in).
    const keys = new Set((m.assets || []).map((a) => a.key));
    for (const e of m.edits || []) for (const v of e.versions || []) for (const mm of JSON.stringify(v.ir || {}).matchAll(/"assetVersionId":"([^"]+)"/g)) if (!keys.has(mm[1])) problems.push(`versiunea ${v.version} folosește un material care nu e în pachet (${mm[1]})`);
    const importKey = sha256Text(`${loaded.sha256}:${root.toLowerCase()}`);
    const prior = db.prepare("SELECT * FROM media_project_imports WHERE import_key = ?").get(importKey);
    const summary = { format: m.reconstruction ? "reconstruction" : "bundle", title: m.project?.title, labels: m.labels || [], assets: files, edits: (m.edits || []).map((e) => ({ title: e.title, versions: (e.versions || []).length })),
      variants: (m.variants || []).map((v) => v.platformKey), claims: (m.claims || []).length, documents: { brief: Boolean(m.documents?.brief), scripts: (m.documents?.scripts || []).map((s) => s.language), storyboard: Boolean(m.documents?.storyboard) },
      approvals: "nu se importă: revizuirea creativă rămâne în așteptare", missing: loaded.missing || [], problems, manifestSha256: loaded.sha256 };
    const previewHash = sha256Text(JSON.stringify(summary));
    let id = prior?.id;
    bus.transaction(() => {
      if (!prior) {
        id = newId("mpi");
        db.prepare("INSERT INTO media_project_imports (id, import_key, source_dir, manifest_sha256, format, status, preview_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PREVIEWED', ?, ?, ?, ?)")
          .run(id, importKey, root, loaded.sha256, summary.format, json({ ...summary, previewHash }), actor, now(), now());
      } else if (prior.status !== "IMPORTED") db.prepare("UPDATE media_project_imports SET preview_json = ?, status = 'PREVIEWED', updated_at = ? WHERE id = ?").run(json({ ...summary, previewHash }), now(), prior.id);
      bus.append({ type: "media.project.import_previewed", scopeType: "media_import", scopeId: id, source: actor, payload: { format: summary.format, assets: files.length, problems: problems.length } });
    });
    const row = db.prepare("SELECT * FROM media_project_imports WHERE id = ?").get(id);
    return { importId: id, importKey, status: row.status, contentProjectId: row.content_project_id, alreadyImported: row.status === "IMPORTED", previewHash, ...summary };
  }

  // ---------------------------------------------------------------- import (after ONE confirmation)
  async function confirmImport({ importId, previewHash, actor = "owner" }) {
    const row = db.prepare("SELECT * FROM media_project_imports WHERE id = ?").get(String(importId || ""));
    if (!row) throw new HubError("not_found", "Importul nu există; previzualizează din nou.");
    if (row.status === "IMPORTED") return { importId: row.id, contentProjectId: row.content_project_id, mapping: parse(row.mapping_json, {}), duplicate: true };
    const again = preview({ dir: row.source_dir, actor });
    if (again.previewHash !== previewHash) throw new HubError("conflict", "Folderul s-a schimbat după previzualizare; îți arăt din nou ce se importă.", { code: "IMPORT_CHANGED", data: { preview: again } });
    if (again.problems.length) throw new HubError("validation", `Pachetul are probleme: ${again.problems.slice(0, 5).join("; ")}`, { code: "BUNDLE_PROBLEMS", data: { problems: again.problems } });
    const root = row.source_dir;
    const loaded = readManifest(root) || reconstruct(root);
    const m = loaded.manifest;
    if (db.prepare("UPDATE media_project_imports SET status = 'IMPORTING', updated_at = ? WHERE id = ? AND status = 'PREVIEWED'").run(now(), row.id).changes !== 1) throw new HubError("conflict", "Importul e deja în curs.");
    const map = new Map();
    try {
      // 1. content project (labelled as an import; the original title kept)
      const project = content.createProject({ title: `${m.project?.title || "Proiect importat"}${m.reconstruction ? " (reconstruit)" : ""}`.slice(0, 200), format: m.project?.format || "", platforms: m.project?.platforms || [],
        audience: m.project?.audience || "both", presetId: m.project?.presetId || null, presetVersion: m.project?.presetVersion ?? null }, actor);
      // 2. library: each source file through the normal ingest (hash, sniff, probe; an identical file is reused with its own context)
      for (const a of m.assets || []) {
        const res = await assets.ingestFile({ sourcePath: path.join(root, a.file), allowedRoots: [root], title: a.title || path.basename(a.file), category: a.category || "raw", origin: a.origin || "UNKNOWN",
          captureLabel: a.captureLabel || undefined, contentProjectId: project.id, tags: ["import"], actor });
        map.set(a.key, res.version.id);
        // Rights: only what THIS bundle declares for THIS file, recorded for the new asset (shown in the preview, confirmed with it).
        for (const r of a.rights || []) rights.record({ assetId: res.asset.id, status: r.status, holder: r.holder || "", platforms: r.platforms || [], uses: r.uses || [], territory: r.territory || undefined,
          startsAt: r.startsAt || undefined, endsAt: r.endsAt || undefined, attribution: r.attribution || undefined, licenseRef: r.licenseRef || undefined, sourceKind: "project_import", sourceRef: `${BUNDLE_FILE}#${row.import_key.slice(0, 16)}`, actor });
      }
      // 3. claims, then the documents that reference them
      for (const c of m.claims || []) {
        const saved = content.saveClaim(project.id, { text: c.text, evidence: c.evidence || [], shot: remapIds(c.shot || {}, map), conditions: c.conditions || undefined, status: c.status || undefined }, actor);
        map.set(c.key, saved.id || saved.claim?.id);
      }
      const doc = m.documents || {};
      if (doc.brief) content.saveBrief(project.id, { body: remapIds(doc.brief.body, map), authorKind: doc.brief.authorKind, author: doc.brief.author });
      for (const s of doc.scripts || []) content.saveScript(project.id, { language: s.language, ...remapIds(s.body, map), authorKind: s.authorKind, author: s.author });
      if (doc.storyboard) content.saveStoryboard(project.id, { ...remapIds(doc.storyboard.body, map), authorKind: doc.storyboard.authorKind, author: doc.storyboard.author });
      // 4. edit versions in order (each validated against the library), parents and variant lines kept
      for (const e of m.edits || []) {
        const versions = [...(e.versions || [])].sort((a, b) => a.version - b.version);
        let editProjectId = null;
        for (const v of versions) {
          const ir = remapIds(v.ir, map);
          if (!editProjectId) {
            const created = edits.create({ contentProjectId: project.id, title: e.title, ir, actor });
            editProjectId = created.project?.id || created.editProject?.id || created.id;
            map.set(e.key, editProjectId);
            map.set(v.key, created.version.id);
          } else {
            const nv = insertEditVersion(db, bus, clock, { editProjectId, parentVersionId: v.parentKey ? map.get(v.parentKey) || null : null, ir, changeKind: v.changeKind === "initial" ? "import" : v.changeKind,
              change: { importedFrom: row.import_key.slice(0, 16), originalChangeKind: v.changeKind }, variantKey: v.variantKey || null, actor });
            map.set(v.key, nv.id);
          }
        }
      }
      // 5. variants (DRAFT: their renders are not imported; render + QA again in this Studio)
      bus.transaction(() => {
        for (const v of m.variants || []) {
          const id = newId("mva");
          db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, variant_version_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)")
            .run(id, map.get(v.editKey), map.get(v.masterKey), v.platformKey, map.get(v.variantKey) || null, actor, now(), now());
          map.set(v.key, id);
        }
        db.prepare("UPDATE media_project_imports SET status = 'IMPORTED', mapping_json = ?, content_project_id = ?, updated_at = ? WHERE id = ?").run(json(Object.fromEntries(map)), project.id, now(), row.id);
        bus.append({ type: "media.project.imported", scopeType: "content", scopeId: project.id, source: actor, payload: { importId: row.id, format: again.format, assets: (m.assets || []).length, edits: (m.edits || []).length, labels: m.labels || [] } });
      });
      return { importId: row.id, contentProjectId: project.id, mapping: Object.fromEntries(map), duplicate: false, missing: again.missing };
    } catch (error) {
      db.prepare("UPDATE media_project_imports SET status = 'FAILED', error = ?, mapping_json = ?, updated_at = ? WHERE id = ?").run(String(error.message).slice(0, 1000), json(Object.fromEntries(map)), now(), row.id);
      throw error;
    }
  }
  const get = (importId) => { const r = db.prepare("SELECT * FROM media_project_imports WHERE id = ?").get(String(importId || "")); return r ? { id: r.id, status: r.status, format: r.format, sourceDir: r.source_dir, contentProjectId: r.content_project_id, preview: parse(r.preview_json, {}), error: r.error } : null; };
  return { exportProject, preview, confirmImport, get, isBundleId: (s) => ID_RE.test(String(s || "")) };
}
