import os from "node:os";
import { HUB_VERSION, API_CONTRACT } from "../config.mjs";
import { environmentOverview } from "../environments/overview.mjs";

/** Only stored observations and live facts of this process; never inspect, probe or start an adapter. */
export function systemMap(hub) {
  const now = hub.config.now(); const readAt = now.toISOString(); const nodes = [];
  const add = (id, label, source, checkedAt, values = {}) => { const n = { id, label, state: "unknown", stateText: "Necunoscut", facts: [], source, checkedAt, link: "/system", ...values }; nodes.push(n); return n; };
  const fact = (label, value) => ({ label, value: value ?? null });
  add("pc", "Calculator", "node:os / process", readAt, { state: "ok", stateText: "Proces local activ", running: true, facts: [fact("Platformă", os.platform()), fact("Versiune OS", os.release()), fact("Procesoare", os.cpus().length), fact("Model CPU", os.cpus()[0]?.model), fact("Memorie totală", os.totalmem()), fact("Memorie liberă", os.freemem()), fact("PID Hub", process.pid), fact("Timp activ (s)", Math.floor(process.uptime()))] });
  const boot = hub.db.prepare("SELECT scope_id, created_at, payload_json FROM events WHERE type = 'system.booted' ORDER BY seq DESC LIMIT 1").get();
  const gate = hub.settings.get("executionGate");
  add("hub", "Hub", "system.booted / settings", boot?.created_at || null, { state: gate?.status !== "open" ? "warn" : "ok", stateText: gate?.status !== "open" ? "Poartă suspendată" : "Activ", running: true, facts: [fact("Versiune", HUB_VERSION), fact("Contract API", API_CONTRACT), fact("Boot ID", hub.bootId || boot?.scope_id), fact("Pornit la", boot?.created_at), fact("Mod", hub.settings.get("mode")), fact("Poartă", gate?.status !== "open" ? "suspendată" : "deschisă")] });
  const count = (table) => hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  add("db", "Baza de date", "schema_migrations / diagnostics SQL", readAt, { state: "ok", stateText: "Citire reușită", available: { ok: true, checkedAt: readAt }, facts: [fact("Schema", hub.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v), ...["projects", "missions", "tasks", "agent_runs"].map((t) => fact(t, count(t)))] });
  const backup = hub.db.prepare("SELECT * FROM backups WHERE project_id = ? AND status = 'verified' ORDER BY created_at DESC LIMIT 1").get(hub.projects.hub()?.id || "");
  const fresh = Boolean(backup?.restore_verified_at && now - new Date(backup.created_at) <= 1800000);
  add("backups", "Backupuri", "backups", backup?.restore_verified_at || null, { state: fresh ? "ok" : "warn", stateText: fresh ? "Backup verificat recent" : "Fără backup verificat recent", facts: [fact("Creat la", backup?.created_at), fact("Restaurare verificată la", backup?.restore_verified_at), fact("freshVerified (30 min)", fresh)] });
  const schedules = hub.schedules.list(); const active = schedules.filter((s) => s.status === "ACTIVE"); const last = schedules.filter((s) => s.lastRunAt).sort((a, b) => Date.parse(b.lastRunAt) - Date.parse(a.lastRunAt))[0];
  add("schedules", "Programări", "schedules", last?.lastRunAt || null, { state: active.length ? "ok" : "off", stateText: active.length ? "Programări active" : "Fără programări active", facts: [fact("Active", active.length), fact("Următoarea", active.map((s) => s.nextRunAt).filter(Boolean).sort()[0]), fact("Ultima rulare", last?.lastRunAt), fact("Ultimul rezultat", last?.lastResult)] });
  const env = environmentOverview(hub); const runner = env.environments.find((e) => e.id === "wsl-runner");
  add("runner", "Runner WSL", "environmentOverview: wsl-runner", runner?.inspection?.inspectedAt || null, { available: null, running: null, installed: runner?.inspection?.installed ?? null, configured: runner?.policy?.valid ?? null, state: runner ? runner.attestation?.valid && runner.policy?.valid && runner.account?.ok ? "ok" : "warn" : "unknown", stateText: runner ? "Observații înregistrate" : "Neverificat", facts: [fact("Inspectat la", runner?.inspection?.inspectedAt), fact("Atestare validă", runner?.attestation?.valid), fact("Atestare încheiată la", runner?.attestation?.latest?.finishedAt), fact("Politică validă", runner?.policy?.valid), fact("Cont verificat la", runner?.account?.probedAt)] });
  const runs = hub.runs.activeRuns();
  for (const id of ["codex", "claude"]) {
    const p = hub.providerState.get(id); const available = p?.probedAt ? { ok: p.ok === true, checkedAt: p.probedAt } : null;
    const stale = available && now - new Date(available.checkedAt) > 86400000;
    add(id, id === "codex" ? "Codex" : "Claude", "providerState (providerSummary)", p?.probedAt || p?.installation?.inspectedAt || null, { installed: p?.installation ? p.installation.installed !== false : null, configured: p?.auth ? p.auth.authenticated ?? p.auth.loggedIn ?? p.auth.ok ?? (p.auth.accountType ? p.auth.accountType !== "none" : null) : null, available, running: runs.some((r) => r.provider === id), state: stale ? "warn" : available ? available.ok ? "ok" : "error" : "unknown", stateText: stale ? "Verificare veche" : available ? available.ok ? "Verificare reușită" : "Verificare eșuată" : "Disponibilitate neverificată", facts: [fact("Instalat", p?.installation?.installed), fact("Verificat la", p?.probedAt)] });
  }
  const voice = hub.voice.status(null); const lega = hub.lega.state();
  add("voice", "Voce", "voiceEngine.status / lega.state", readAt, { installed: voice.engine?.installed ?? null, available: typeof voice.localTranscription?.available === "boolean" ? { ok: voice.localTranscription.available, checkedAt: readAt } : null, state: lega?.status === "active" ? "ok" : "off", stateText: lega?.status === "active" ? "Sesiune activă" : "Voce oprită", running: lega?.status === "active", facts: [fact("Motor", voice.engine?.engine), fact("Transcriere locală", voice.localTranscription?.available), fact("Sesiune", lega?.status)] });
  const edges = ["db", "backups", "schedules", "runner", "codex", "claude", "voice"].map((to) => ({ from: "hub", to, kind: "uses", provenance: "hub service wiring" }));
  edges.unshift({ from: "pc", to: "hub", kind: "hosts", provenance: "process" });
  if (env.projects?.some((p) => p.route === "wsl-runner")) edges.push({ from: "runner", to: "codex", kind: "adapter", provenance: "environmentOverview project routes: codex@wsl-runner" });
  return { readAt, nodes, edges };
}
