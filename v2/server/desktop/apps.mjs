// M10 app registry. An app goes through separate states (never merged): INSTALLED (an executable found in a standard source) →
// DISCOVERED (its Authenticode signer is the expected publisher and the signature is trusted on this machine) → AUTHORIZED_SCOPE (the
// owner authorized it once for the operator, in an authenticated session). Each operation keeps its own verification level, recorded
// from real runs: IMPLEMENTED, VERIFIED_GUI, VERIFIED_API, IMPLEMENTED_API, ASSISTED_ONLY, BLOCKED_BY_OS, UNSUPPORTED, UNVERIFIED.
// "The window opened" is never "video editing works": each operation is verified on its own.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { json, parse } from "../storage/db.mjs";

export const APP_STATES = Object.freeze(["NOT_FOUND", "INSTALLED", "DISCOVERED", "AUTHORIZED_SCOPE"]);
export const OP_LEVELS = Object.freeze(["IMPLEMENTED", "IMPLEMENTED_API", "VERIFIED_GUI", "VERIFIED_API", "ASSISTED_ONLY", "BLOCKED_BY_OS", "UNSUPPORTED", "UNVERIFIED"]);

export function loadCatalog(v2Root) {
  const file = path.join(v2Root, "config", "desktop-apps.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  return doc.apps.map((a) => Object.freeze({ ...a }));
}

export function createAppRegistry({ db, bus, clock, config, catalog = null }) {
  const now = () => clock().toISOString();
  const apps = catalog || loadCatalog(config.v2Root);
  const byId = new Map(apps.map((a) => [a.id, a]));
  const row = (id) => db.prepare("SELECT * FROM desktop_apps WHERE id = ?").get(id);

  /** One entry as the policy and the UI read it (catalog + discovery + authorization + per-operation verification). */
  function get(id) {
    const cat = byId.get(id);
    if (!cat) return null;
    const r = row(id);
    const authorized = parse(r?.authorized_json, {});
    const verified = parse(r?.verified_json, {});
    const signature = parse(r?.signature_json, {});
    const status = !r ? "NOT_FOUND" : r.status;
    const ops = Object.fromEntries(Object.entries(cat.capabilities || {}).map(([op, level]) => [op, verified[op]?.level || level]));
    return { id, displayName: cat.displayName, processNames: cat.processNames, publisher: cat.publisher, profile: cat.profile, privileged: false,
      status: status === "DISCOVERED" && authorized.authorized ? "AUTHORIZED_SCOPE" : status, authorized: Boolean(authorized.authorized) && status !== "NOT_FOUND" && status !== "INSTALLED",
      authorizedBy: authorized.authorized ? { at: authorized.at, via: authorized.via, sessionId: authorized.sessionId } : null,
      exePath: r?.exe_path || null, exeSha256: r?.exe_sha256 || null, version: r?.version || null, signature, launch: { ...(cat.launch || {}), ...parse(r?.launch_json, {}) },
      discoveredFrom: r?.discovered_from || null, capabilities: ops, verification: verified, updatedAt: r?.updated_at || null };
  }
  const list = () => apps.map((a) => get(a.id));
  const find = (ref) => {
    const n = String(ref || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return apps.find((a) => a.id === n || a.displayName.toLowerCase().replace(/[^a-z0-9]/g, "") === n || a.processNames.some((p) => p.toLowerCase() === n)) || null;
  };

  /**
   * Discovery through the helper (standard sources only). An executable counts as DISCOVERED only when its signer names the catalog's
   * publisher and Windows trusts the signature; otherwise it stays INSTALLED (found, identity not verified) and is never authorized.
   */
  async function discover(client, { actor = "hub" } = {}) {
    const candidates = apps.map((a) => ({ id: a.id, appPaths: a.discover?.appPaths || [], startMenu: a.discover?.startMenu || [], knownPaths: a.discover?.knownPaths || [],
      versionedDir: a.discover?.versionedDir || null, versionedExe: a.discover?.versionedExe || null }));
    const res = await client.request("discoverApps", { candidates, timeoutMs: 30000 }, { plan: "discovery", step: "discover", apps: [], exp: new Date(clock().getTime() + 60000).toISOString() });
    const out = [];
    bus.transaction(() => {
      for (const d of res.apps || []) {
        const cat = byId.get(d.id);
        if (!cat) continue;
        // Prefer the versioned / known executable over a launcher stub; the first trusted one from the expected publisher wins.
        const ranked = [...(d.found || [])].sort((a, b) => rank(b.source) - rank(a.source));
        const verified = ranked.find((f) => f.signed && f.trusted && String(f.signer || "").toLowerCase().includes(cat.publisher.toLowerCase()));
        const pick = verified || ranked[0] || null;
        const status = !pick ? "NOT_FOUND" : verified ? "DISCOVERED" : "INSTALLED";
        const prev = row(cat.id);
        let sha = null;
        if (pick) { try { sha = crypto.createHash("sha256").update(fs.readFileSync(pick.path)).digest("hex"); } catch { sha = null; } }
        const launch = cat.launch?.kind === "exe" && pick ? { exe: pick.path } : cat.launch?.kind === "explorer" && pick ? { exe: pick.path } : {};
        const changed = prev && prev.exe_sha256 && sha && prev.exe_sha256 !== sha;
        db.prepare(`INSERT INTO desktop_apps (id, display_name, status, exe_path, exe_sha256, version, publisher, signature_json, launch_json, discovered_from, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, exe_path = excluded.exe_path, exe_sha256 = excluded.exe_sha256,
          version = excluded.version, publisher = excluded.publisher, signature_json = excluded.signature_json, launch_json = excluded.launch_json, discovered_from = excluded.discovered_from,
          updated_at = excluded.updated_at`).run(cat.id, cat.displayName, status, pick?.path || null, sha, pick?.fileVersion || pick?.productVersion || null, pick ? cat.publisher : null,
          json(pick ? { signed: Boolean(pick.signed), trusted: Boolean(pick.trusted), signer: String(pick.signer || "").slice(0, 300), product: pick.productName || null } : {}),
          json(launch), pick?.source || "", now());
        // A different binary than the one the owner authorized is not the same app: the authorization is withdrawn (re-authorize).
        if (changed) db.prepare("UPDATE desktop_apps SET authorized_json = '{}' WHERE id = ?").run(cat.id);
        out.push({ id: cat.id, status, path: pick?.path || null, version: pick?.fileVersion || null, signer: pick?.signer || null, binaryChanged: Boolean(changed), tried: d.tried });
      }
      bus.append({ type: "desktop.apps.discovered", scopeType: "desktop", scopeId: "apps", source: actor, payload: { apps: out.map((a) => ({ id: a.id, status: a.status, version: a.version, binaryChanged: a.binaryChanged })) } });
    });
    return out;
  }
  const rank = (source) => ({ versioned_dir: 4, known_path: 3, app_paths: 2, start_menu: 1 }[source] || 0);

  /** The owner's one authorization of these apps for the operator (from a confirmed plan / activation card in the owner session). */
  function authorize(ids, { sessionId, via, actor = "owner" }) {
    const done = [];
    bus.transaction(() => {
      for (const id of ids) {
        const e = get(id);
        if (!e) throw new HubError("not_found", `Aplicație necunoscută: ${id}`);
        if (e.status === "NOT_FOUND") throw new HubError("conflict", `${e.displayName} nu e instalată pe acest calculator.`);
        if (e.status === "INSTALLED") throw new HubError("policy", `${e.displayName}: identitatea executabilului nu e verificată (semnătura nu e a editorului ${byId.get(id).publisher}); nu o autorizez.`);
        db.prepare("UPDATE desktop_apps SET authorized_json = ?, updated_at = ? WHERE id = ?").run(json({ authorized: true, at: now(), via, sessionId, exeSha256: e.exeSha256 }), now(), id);
        done.push(id);
      }
      bus.append({ type: "desktop.apps.authorized", scopeType: "desktop", scopeId: "apps", source: actor, payload: { apps: done, via } });
    });
    return done.map(get);
  }
  function revoke(ids, { actor = "owner", reason = "" } = {}) {
    bus.transaction(() => {
      for (const id of ids) db.prepare("UPDATE desktop_apps SET authorized_json = '{}', updated_at = ? WHERE id = ?").run(now(), id);
      bus.append({ type: "desktop.apps.revoked", scopeType: "desktop", scopeId: "apps", source: actor, payload: { apps: ids, reason: String(reason).slice(0, 200) } });
    });
    return ids.map(get);
  }
  /** Records the verification level of one operation from a real run (with its evidence). */
  function recordVerification(id, op, level, evidence = {}) {
    if (!OP_LEVELS.includes(level)) throw new HubError("validation", `Nivel necunoscut: ${level}`);
    const r = row(id);
    if (!r) return null;
    const v = parse(r.verified_json, {});
    v[op] = { level, at: now(), evidence };
    db.prepare("UPDATE desktop_apps SET verified_json = ?, updated_at = ? WHERE id = ?").run(json(v), now(), id);
    return get(id);
  }
  return { list, get, find, discover, authorize, revoke, recordVerification, catalog: apps };
}
