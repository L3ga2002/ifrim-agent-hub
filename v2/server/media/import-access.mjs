// M10 contextual import folders: "importă din folderul acesta" shows the exact folder and what would be read (types, counts, sizes —
// names only, never contents), then ONE choice: a one-time access for this import (expires, consumed) or a persistent import root chosen
// explicitly. The global allowlist is never widened to make an import pass; a drive root, the user profile itself, the Desktop root, the
// Hub's data, the repository and credential stores are refused; links, junctions and UNC paths are resolved / refused on the server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|bmp|tiff?|srt|vtt|json)$/i;
const SECRET = /(^|[\\/])(\.env(\.[^\\/]*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.pfx|.*\.p12|credentials(\.json)?|.*\.kdbx)$/i;
const inside = (root, p) => { const rel = path.relative(root.toLowerCase(), p.toLowerCase()); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

export function createImportAccess({ db, bus, clock, settings, config }) {
  const now = () => clock().toISOString();
  const home = os.homedir();
  const forbidden = () => [config.hubRoot, config.dataDir, config.mediaDir, config.backupDir, config.preUpgradeDir, path.join(home, ".codex"), path.join(home, ".claude"), path.join(home, ".ssh"),
    path.join(home, "AppData"), process.env.WINDIR || "C:\\Windows", process.env.ProgramFiles || "C:\\Program Files", process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"].filter(Boolean);

  /** The real folder (links / junctions resolved), validated on the server. */
  function realFolder(dir, { persistent = false } = {}) {
    if (typeof dir !== "string" || !path.isAbsolute(dir) || dir.includes("\0")) throw new HubError("validation", "Folderul trebuie să fie o cale locală absolută.", { code: "IMPORT_PATH_INVALID" });
    if (/^\\\\/.test(dir)) throw new HubError("policy", "Căile de rețea (UNC) nu sunt permise pentru import.", { code: "IMPORT_PATH_REFUSED" });
    let real;
    try { real = fs.realpathSync.native(dir); } catch { throw new HubError("not_found", "Folderul nu există.", { code: "IMPORT_PATH_MISSING" }); }
    if (!fs.statSync(real).isDirectory()) throw new HubError("validation", "Calea nu e un folder.", { code: "IMPORT_PATH_INVALID" });
    for (const f of forbidden()) { const fr = (() => { try { return fs.realpathSync.native(f); } catch { return path.resolve(f); } })(); if (inside(fr, real) || inside(real, fr)) throw new HubError("policy", "Folderul e protejat sau conține date protejate (Hub, repo, credențiale, sistem); nu îl folosesc pentru import.", { code: "IMPORT_PATH_REFUSED" }); }
    if (persistent) {
      const parsed = path.parse(real);
      const tooWide = [parsed.root, home, path.join(home, "Desktop"), path.join(home, "OneDrive"), path.join(home, "Documents")].map((x) => path.resolve(x).toLowerCase());
      if (tooWide.includes(real.toLowerCase())) throw new HubError("policy", "Ca folder permanent alege un subfolder concret (nu un disc întreg, profilul, Desktop sau Documents).", { code: "IMPORT_ROOT_TOO_WIDE" });
    }
    return real;
  }

  /** What an import from this folder would read: names, types, sizes (two levels at most; contents never opened; secrets skipped). */
  function preview(dir) {
    const real = realFolder(dir);
    const files = [];
    const skipped = { secrets: 0, links: 0, other: 0 };
    const walk = (d, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isSymbolicLink()) { skipped.links += 1; continue; }
        if (e.isDirectory()) { if (depth < 1) walk(abs, depth + 1); continue; }
        if (!e.isFile()) continue;
        if (SECRET.test(abs)) { skipped.secrets += 1; continue; }
        if (!MEDIA_EXT.test(e.name)) { skipped.other += 1; continue; }
        if (files.length >= 300) continue;
        let size = 0; try { size = fs.statSync(abs).size; } catch { /* listed without size */ }
        files.push({ rel: path.relative(real, abs).split(path.sep).join("/"), ext: path.extname(e.name).slice(1).toLowerCase(), bytes: size });
      }
    };
    walk(real, 0);
    const byType = files.reduce((a, f) => { const t = /^(mp4|mov|mkv|webm|avi|m4v)$/.test(f.ext) ? "video" : /^(mp3|wav|m4a|aac|flac|ogg)$/.test(f.ext) ? "audio" : /^(srt|vtt)$/.test(f.ext) ? "subtitrare" : f.ext === "json" ? "manifest" : "imagine"; a[t] = (a[t] || 0) + 1; return a; }, {});
    const listing = { folder: real, files, byType, totalBytes: files.reduce((n, f) => n + f.bytes, 0), skipped, hasProjectBundle: files.some((f) => f.rel === "proiect-studio.json") };
    return { ...listing, previewSha256: crypto.createHash("sha256").update(JSON.stringify(listing)).digest("hex") };
  }

  /** A one-time access for one import (expires, consumed) — or a persistent root (an explicit choice; the caller requires a fresh re-auth). */
  function authorize({ dir, mode = "once", previewSha256, planId = null, ownerSessionId = null, ttlMinutes = 60, actor = "owner" }) {
    if (!["once", "persistent"].includes(mode)) throw new HubError("validation", "Modul este „once” sau „persistent”.");
    const p = preview(dir);
    if (p.previewSha256 !== previewSha256) throw new HubError("conflict", "Conținutul folderului s-a schimbat după ce ți l-am arătat; îți arăt din nou.", { code: "IMPORT_PREVIEW_CHANGED", data: { preview: p } });
    if (mode === "persistent") realFolder(dir, { persistent: true });
    const id = newId("mig");
    bus.transaction(() => {
      db.prepare(`INSERT INTO media_import_grants (id, mode, root_path, files_json, status, plan_id, owner_session_id, preview_sha256, expires_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`).run(id, mode, p.folder, json(p.files.map((f) => f.rel)), planId, ownerSessionId, previewSha256,
        mode === "once" ? new Date(clock().getTime() + Math.min(240, Math.max(5, ttlMinutes)) * 60000).toISOString() : null, actor, now(), now());
      if (mode === "persistent") {
        const policy = settings.get("mediaPolicy") || {};
        const roots = [...new Set([...(Array.isArray(policy.importRoots) ? policy.importRoots : []), p.folder])].slice(0, 20);
        settings.set("mediaPolicy", { ...policy, importRoots: roots }, actor, `Folder de import permanent: ${p.folder}`);
      }
      bus.append({ type: "media.import.authorized", scopeType: "media_import", scopeId: id, source: actor, payload: { mode, folder: p.folder, files: p.files.length, planId } });
    });
    return { grantId: id, mode, folder: p.folder, files: p.files.length };
  }
  /** Roots of one-time accesses still valid (added to the import roots only while they last). */
  function activeOnceRoots() {
    const rows = db.prepare("SELECT * FROM media_import_grants WHERE mode = 'once' AND status = 'ACTIVE'").all();
    const t = now();
    const live = [];
    for (const r of rows) {
      if (r.expires_at && r.expires_at <= t) { db.prepare("UPDATE media_import_grants SET status = 'EXPIRED', updated_at = ? WHERE id = ?").run(t, r.id); continue; }
      live.push(r.root_path);
    }
    return live;
  }
  const markUsed = (grantId) => db.prepare("UPDATE media_import_grants SET status = 'USED', updated_at = ? WHERE id = ? AND mode = 'once' AND status = 'ACTIVE'").run(now(), String(grantId || "")).changes;
  const revoke = (grantId, actor = "owner") => bus.transaction(() => { const n = db.prepare("UPDATE media_import_grants SET status = 'REVOKED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'").run(now(), String(grantId || "")).changes; if (n) bus.append({ type: "media.import.revoked", scopeType: "media_import", scopeId: grantId, source: actor, payload: {} }); return n; });
  const list = () => db.prepare("SELECT * FROM media_import_grants ORDER BY created_at DESC LIMIT 50").all().map((r) => ({ id: r.id, mode: r.mode, folder: r.root_path, status: r.status, expiresAt: r.expires_at, planId: r.plan_id, files: parse(r.files_json, []).length, createdAt: r.created_at }));
  return { preview, authorize, activeOnceRoots, markUsed, revoke, list, realFolder };
}
