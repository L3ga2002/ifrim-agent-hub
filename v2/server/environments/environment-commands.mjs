import { HubError } from "../core/errors.mjs";
import { ENV_POLICY_TEXT } from "../policy/isolation.mjs";
import { workspaceResource } from "../runtime/runs.mjs";

/**
 * Commands of the execution environments (M05). None of them starts a model: inspection, the account check (no thread, no
 * turn), the attestation canary, warm-up and workspace cleanup. The owner's decisions — the route of a project and the
 * policy approval (b) — are UI-only, with an exact confirmation text for (b). Local scripts may run the inference-free checks
 * on the "cli" channel, so the record shows who asked (never "user/ui" for something the owner did not click).
 */
const CHECKS = ["ui", "test", "cli"];
// M10.2: the automatic readiness runner (actor readiness:<id>) may run the inference-free inspection and account check. The
// attestation accepts it too, but only as a pre-step of a plan the owner confirmed, re-checked in the handler (owner decision 3).
const READINESS = [...CHECKS, "automation"];
// M08: "owner" = the authenticated owner session (WebAuthn), strictly stronger than "ui"; a package decision (B1) runs on it.
const OWNER = ["ui", "owner", "test"];
const FAILSAFE = ["ui", "test", "voice", "companion"];

export function registerEnvironmentCommands(reg, hub) {
  const { settings, projects, bus, config, leases } = hub;
  const clock = config.now;
  const service = (id) => {
    const s = hub.environments.get(id);
    if (!s) throw new HubError("not_found", `Mediu necunoscut: ${id}`);
    return s;
  };
  const ENV = { environmentId: { enum: ["wsl-runner"], default: "wsl-runner" } };

  reg("environment.inspect", { describe: "Inspectează mediul izolat (versiuni, hash-uri, granița; fără conținut de fișiere, fără model)", async: true, channels: READINESS, schema: ENV,
    execute: async (input, ctx) => {
      const state = await service(input.environmentId).inspect();
      bus.emit({ type: "environment.inspected", scopeType: "environment", scopeId: input.environmentId, source: ctx.actor,
        payload: { ok: state.ok, installed: state.installed, fingerprintHash: state.fingerprint?.hash || null, problems: (state.problems || []).map((p) => p.code), durationMs: state.durationMs } });
      return { ok: state.ok, installed: state.installed, fingerprint: state.fingerprint || null, problems: state.problems || [], error: state.error || null, durationMs: state.durationMs };
    } });

  reg("environment.probe", { describe: "Verifică contul prin clientul din mediu (C16: handshake, cont, limite, profiluri, model/list; fără thread și fără turn) și, dacă e instalat, reviewer-ul Claude (auth status în sandbox-ul lui, fără model)", async: true, channels: READINESS, schema: ENV,
    execute: async (input, ctx) => {
      const svc = service(input.environmentId);
      const result = await svc.probeAccount();
      bus.emit({ type: result.ok ? "environment.probed" : "environment.probe_failed", scopeType: "environment", scopeId: input.environmentId, source: ctx.actor,
        payload: { ok: result.ok, accountType: result.auth?.accountType || null, planType: result.auth?.planType || null, models: Array.isArray(result.models) ? result.models.length : 0, c16: result.c16.map((l) => l.split(" ").slice(0, 2).join(" ")) } });
      // M07: the reviewer's account check through the same environment, only when Claude Code is installed there.
      let reviewer = null;
      if (svc.probeReviewer && svc.state()?.facts?.claude_cli) {
        const r = await svc.probeReviewer().catch((error) => ({ ok: false, error: String(error.message).slice(0, 300), lines: [] }));
        reviewer = { ok: Boolean(r.ok), lines: r.lines || [], error: r.error || null };
        bus.emit({ type: r.ok ? "environment.reviewer_probed" : "environment.reviewer_probe_failed", scopeType: "environment", scopeId: input.environmentId, source: ctx.actor,
          payload: { ok: Boolean(r.ok), authMethod: r.auth?.authMethod || null, subscriptionType: r.auth?.subscriptionType || null, lines: (r.lines || []).map((l) => l.split(" ").slice(0, 2).join(" ")) } });
      }
      return { ok: result.ok, c16: result.c16, error: result.error || null, reviewer };
    } });

  reg("environment.attest", { describe: "Atestă mediul: canary C1–C17 pe amprenta curentă, plus C18–C20 (preview doar-local, Chromium E2E, reviewer) ca acoperire opțională (fișiere fictive, fără model)", async: true, channels: READINESS,
    schema: { ...ENV, allowRestart: { type: "boolean", default: true }, readinessFor: { max: 120 }, expectFingerprint: { max: 64, pattern: /^[0-9a-f]{8,64}$/i } },
    execute: async (input, ctx) => {
      const svc = service(input.environmentId);
      // M10.2 review #35: the fingerprint the automatic guard below approved is the only one attest() may attest on this channel.
      // 2.12.1 (D21): a caller on another channel (the setup's automatic step) may pin the fingerprint it decided on; attest() then
      // refuses before the canary if a fresh inspection differs, so a race never attests a new configuration.
      let expectFingerprint = ctx.channel === "automation" ? null : (input.expectFingerprint ? String(input.expectFingerprint).toLowerCase() : null);
      if (ctx.channel === "automation") {
        // Owner decision 3: the Hub re-attests by itself only as a pre-step of a plan the owner confirmed (checked in the database
        // through the readiness service, never inferred from the channel), only on the fingerprint the owner approved in (b) and
        // that the latest PASS attestation covers. A new fingerprint is never attested (nor approved) automatically.
        const allowed = String(ctx.actor || "").startsWith("readiness:") && input.readinessFor ? hub.readiness?.reattestAllowed?.(input.readinessFor, input.environmentId) : null;
        if (!allowed?.ok) throw new HubError("policy", `Re-atestarea automată rulează doar ca pas de pregătire după confirmarea unui plan${allowed?.why ? ` (${allowed.why})` : ""}`);
        const st = svc.state();
        const pol = settings.get("environmentPolicy")?.[input.environmentId];
        const latest = svc.latestAttestation();
        if (!st?.fingerprint?.hash || !pol?.fingerprintHash || pol.text !== ENV_POLICY_TEXT || st.fingerprint.hash !== pol.fingerprintHash) throw new HubError("policy", "Re-atestarea automată cere aceeași amprentă ca aprobarea ta (b); amprenta inspectată diferă");
        if (!latest || latest.fingerprintHash !== st.fingerprint.hash || !(latest.status === "PASS_LOCAL" || (config.testMode && latest.status === "PASS_SIMULATED"))) throw new HubError("policy", "Re-atestarea automată cere o atestare anterioară trecută pe aceeași amprentă");
        if (!input.allowRestart) throw new HubError("validation", "Re-atestarea automată rulează complet (C15 inclus) sau deloc");
        if (input.expectFingerprint && String(input.expectFingerprint).toLowerCase() !== String(st.fingerprint.hash).toLowerCase()) throw new HubError("policy", "Re-atestarea automată cere amprenta decisă de pasul de pregătire; amprenta inspectată diferă");
        expectFingerprint = st.fingerprint.hash;
      }
      // C15 restarts the distro: never while a run, a runner command or a workspace of this environment is active.
      if (input.allowRestart && (hub.runs.activeRuns().some((r) => r.environment === input.environmentId) || svc.inUse().length)) {
        throw new HubError("conflict", "Mediul este folosit acum; atestarea (care repornește distribuția la C15) așteaptă terminarea execuțiilor");
      }
      const att = await svc.attest({ actor: ctx.actor, channel: ctx.channel, allowRestart: input.allowRestart, expectFingerprint });
      return { id: att.id, status: att.status, summary: att.summary, fingerprintHash: att.fingerprintHash, byId: att.checks.byId };
    } });

  reg("environment.policy.approve", { describe: "Aprobarea ta (b): host_isolation = environment pentru proiecte reale, legată de amprenta afișată", channels: OWNER,
    schema: { ...ENV, confirmText: { required: true, max: 1200 }, fingerprintHash: { required: true, max: 32 } },
    execute: (input, ctx) => {
      if (input.confirmText !== ENV_POLICY_TEXT) throw new HubError("validation", "Textul de confirmare nu corespunde");
      const svc = service(input.environmentId);
      const state = svc.state();
      // The approval names the fingerprint the owner saw; a stale page cannot approve another environment.
      if (!state?.fingerprint?.hash || input.fingerprintHash !== state.fingerprint.hash) throw new HubError("conflict", "Amprenta mediului s-a schimbat; reîncarcă pagina și verifică din nou");
      const attestation = svc.attestationStatus(clock());
      if (!attestation.valid) throw new HubError("validation", `Mediul nu are o atestare validă: ${attestation.reason}`);
      const value = { ...settings.get("environmentPolicy"), [input.environmentId]: { approvedAt: clock().toISOString(), text: ENV_POLICY_TEXT, fingerprintHash: state.fingerprint.hash,
        attestationId: attestation.latest.id, approvedBy: ctx.actor } };
      settings.set("environmentPolicy", value, ctx.actor, `host_isolation = environment approved for ${input.environmentId} (${state.fingerprint.hash})`);
      return { policy: value[input.environmentId] };
    } });

  reg("environment.policy.revoke", { describe: "Retrage aprobarea (b): proiectele reale nu mai folosesc mediul", channels: FAILSAFE, schema: ENV,
    execute: (input, ctx) => {
      const value = { ...settings.get("environmentPolicy") }; delete value[input.environmentId];
      settings.set("environmentPolicy", value, ctx.actor, `host_isolation = environment withdrawn for ${input.environmentId}`);
      return { revoked: input.environmentId };
    } });

  reg("project.environment.set", { describe: "Alegi ruta de execuție Codex a unui proiect (Windows sau un mediu izolat); nu slăbește poarta", channels: OWNER,
    schema: { projectId: { required: true, max: 80 }, environment: { enum: ["windows", "wsl-runner"], required: true } },
    execute: (input, ctx) => {
      const project = projects.get(input.projectId);
      if (!project) throw new HubError("not_found", "Proiect necunoscut");
      const lease = leases.current(workspaceResource(project.path));
      if (lease) throw new HubError("conflict", `Workspace-ul proiectului e folosit acum (${lease.holder}); schimbă ruta după ce se termină`);
      const value = { ...settings.get("projectEnvironments") };
      if (input.environment === "windows") delete value[project.id];
      else value[project.id] = { environment: input.environment, setAt: clock().toISOString(), setBy: ctx.actor };
      settings.set("projectEnvironments", value, ctx.actor, `Codex route of ${project.name}: ${input.environment}`);
      return { projectId: project.id, environment: input.environment };
    } });

  reg("environment.warmup", { describe: "Pregătește sandbox-ul (o comandă banală într-un folder gol; fără model, fără cod de proiect)", async: true, channels: CHECKS,
    schema: { route: { enum: ["windows", "wsl-runner"], default: "windows" } },
    execute: async (input, ctx) => {
      const result = await hub.factoryRunner.preflight(input.route);
      bus.emit({ type: "environment.warmup", scopeType: "environment", scopeId: input.route, source: ctx.actor,
        payload: { trigger: "manual", ok: result.ok, sandboxMs: result.sandboxMs ?? null, durationMs: result.durationMs ?? null, reason: result.reason || null } });
      return result;
    } });

  reg("environment.warmup.configure", { describe: "Încălzirea sandbox-ului la pornirea Hub-ului (implicit oprită)", channels: OWNER, schema: { onBoot: { type: "boolean", required: true } },
    execute: (input, ctx) => {
      settings.set("environmentWarmup", { onBoot: input.onBoot }, ctx.actor, `Sandbox warm-up on boot ${input.onBoot ? "enabled" : "disabled"}`);
      return { onBoot: input.onBoot };
    } });

  reg("environment.reconcile", { describe: "Oprește procesele rămase în workspace-urile orfane ale mediului (fișierele rămân pentru inspecție)", async: true, channels: CHECKS, schema: ENV,
    execute: async (input) => {
      const svc = service(input.environmentId);
      const orphans = svc.listWorkspaces(100).filter((w) => ["orphaned", "retained"].includes(w.status));
      const results = [];
      for (const w of orphans) results.push({ id: w.id, ...(await svc.reap(w.id, { marker: w.id }).catch((error) => ({ ok: false, error: error.message }))) });
      return { reconciled: results.length, results };
    } });

  reg("environment.workspace.release", { describe: "Șterge un workspace orfan sau reținut din mediu (după ce procesele lui s-au oprit)", async: true, channels: OWNER,
    schema: { ...ENV, workspaceId: { required: true, max: 80 } },
    execute: async (input) => {
      const svc = service(input.environmentId);
      const ws = svc.getWorkspace(input.workspaceId);
      if (!ws) throw new HubError("not_found", "Workspace necunoscut");
      if (["preparing", "prepared", "running"].includes(ws.status) && svc.inUse().some((u) => u.id === ws.id)) throw new HubError("conflict", "Workspace-ul este folosit acum");
      return svc.release(ws.id);
    } });
}
