import { PRE_INFERENCE_CATEGORIES } from "../core/errors.mjs";

/**
 * Codex through the wsl-runner environment (M05 §08–§10, §16–§17). Same provider, same guards (subscription account, rate
 * limits, plugins off, MCP disabled by name and verified, exact model and effort, approvals to the Hub), another process
 * boundary. Around the provider turn:
 *   before: fresh inspection — the fingerprint must equal the attested one (checked again here, at dispatch);
 *           the project is copied into a new workspace in the distro (nothing mounted);
 *   after:  the app-server is stopped and the workspace's processes are reaped BEFORE anything is read back;
 *           the workspace is exported as tar and validated (C14); only a completed turn with a clean export is applied to
 *           the project, after a conflict check against the transfer baseline. An interrupted or failed turn is validated
 *           and kept in staging (quarantine), never applied.
 * There is no fallback: when the environment cannot be used the run stops before the model, it never moves to Windows.
 */
export function createWslCodexAdapter({ environment }) {
  const { codex, env } = environment;
  const id = "codex";

  async function inspectInstallation() {
    const state = environment.state() || await environment.inspect();
    return { provider: id, environment: env.id, installed: Boolean(state?.installed && state.facts?.codex_version), binary: `wsl:${env.distro}:${env.codex}`, source: env.id,
      version: state?.facts?.codex_version ? `codex-cli ${state.facts.codex_version}` : null, reason: state?.installed ? null : state?.error || "mediul nu a fost inspectat" };
  }

  function startTurn(options) {
    const { runId, cwd: projectRoot, onEvent, exportPolicy = {}, projectId = "" } = options;
    const key = `run-${runId}`;
    const phase = (name) => { try { onEvent({ type: "phase", phase: name }); } catch { /* timeline never breaks a run */ } };
    const wsId = String(runId).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    let inner = null;
    let innerDone = false;
    let interruptReason = null;
    let prepared = null;
    // A Stop while the project is still being copied in aborts the copy (wsl.exe is killed), it does not wait for it.
    const copyAbort = new AbortController();
    const base = (extra) => ({ output: "", usage: {}, threadId: "", turnId: "", ...extra });

    const done = (async () => {
      const report = { id: env.id, simulated: Boolean(environment.simulated), workspace: null, fingerprintHash: null, attestationId: null, attestationStatus: null, transfer: null, export: null, apply: null, reap: null };
      const withEnv = (result) => ({ ...result, environment: report });
      try {
        // 1. The environment as it is NOW must be the one that was attested (no stale verdict from boot).
        const inspected = await environment.inspect();
        report.fingerprintHash = inspected.fingerprint?.hash || null;
        const verdict = environment.attestationStatus();
        report.attestationId = verdict.latest?.id || null;
        report.attestationStatus = verdict.latest?.status || null;
        if (!inspected.ok || !verdict.valid) {
          return withEnv(base({ status: "failed", errorCategory: "policy", preInference: true,
            error: `Mediul ${env.id} nu poate fi folosit acum: ${!inspected.ok ? inspected.error || (inspected.problems || []).filter((p) => p.blocking).map((p) => p.detail).join("; ") : verdict.reason}; oprit înainte de model (fără trecere pe Windows)` }));
        }
        phase("environment_checked");
        if (interruptReason) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        // 2. Copy in.
        prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId, runId, purpose: "run", fingerprintHash: report.fingerprintHash, signal: copyAbort.signal });
        report.workspace = prepared.ws;
        report.transfer = prepared.stats;
        phase("workspace_prepared");
        if (interruptReason) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        // 3. The provider turn, in the workspace, with a per-run TMPDIR and a marker the reaper can find.
        inner = codex.startTurn({ ...options, cwd: prepared.repo, threadId: "", launchVars: { TMPDIR: prepared.tmp, IFRIM_RUN: wsId } });
        if (inner.pid) { try { onEvent({ type: "pid", pid: inner.pid }); } catch { /* the record never breaks a run */ } }
        const result = await inner.done;
        innerDone = true;
        // 4. Nothing is read back while a process of the run could still write: the app-server is gone (inner finally),
        //    then every remaining process of this workspace is ended.
        // Alone in the environment: every process of the runner user goes (one that left the workspace and dropped the
        // marker cannot survive into the next run). With another run active, only this workspace's processes. The
        // environment serializes reaps (M07): a Stop's interrupt-path reap (below) and this one never run at once, so the
        // "all" reaper never counts the other reaper as a process left behind.
        report.reap = await environment.reap(wsId, { marker: wsId, all: environment.inUse().length <= 1 }).catch((error) => ({ ok: false, error: error.message }));
        if (!report.reap.ok) {
          return withEnv({ ...result, status: result.status === "completed" ? "failed" : result.status, errorCategory: result.errorCategory || "environment",
            error: `Procesele workspace-ului nu au putut fi oprite (${report.reap.error || `${report.reap.remaining} rămase`}); exportul nu a fost citit` });
        }
        if (result.preInference) return withEnv(result);
        // The boundary is checked again AFTER the run, before anything is read back: a changed environment (config,
        // profile, binary) means the result is not applied (M05 security review F6).
        const post = await environment.inspect().catch((error) => ({ ok: false, error: error.message }));
        if (!post.ok || post.fingerprint?.hash !== report.fingerprintHash) {
          report.apply = { applied: 0, reason: "mediul s-a schimbat în timpul execuției" };
          return withEnv({ ...result, status: "failed", errorCategory: "export", preInference: false,
            error: `Mediul ${env.id} s-a schimbat în timpul execuției (amprenta ${report.fingerprintHash} → ${post.fingerprint?.hash || "—"}${post.ok ? "" : ", probleme de graniță"}); exportul nu a fost aplicat` });
        }
        // 5. Export and validate (C14), even for an interrupted turn (evidence), then apply only a completed one.
        // Only a writer turn may have runtime files left out by the project's ignore rules; a read-only turn keeps flagging every write.
        const validation = await environment.collectExport(wsId, { protectedPaths: exportPolicy.protectedPaths || [], projectRoot: options.access === "workspace-write" ? projectRoot : null });
        report.export = { ok: validation.ok, stats: validation.stats, refused: validation.refused.slice(0, 20), problems: validation.problems.slice(0, 10),
          changes: validation.changes.map((c) => ({ path: c.path, status: c.status })).slice(0, 200) };
        phase("export_validated");
        if (result.status !== "completed") {
          report.apply = { applied: 0, reason: `turn ${result.status}: exportul rămâne în carantină, nu se aplică` };
          return withEnv(result);
        }
        if (options.access !== "workspace-write") {
          report.apply = { applied: 0, reason: "execuție doar-citire: nimic nu se aplică" };
          if (validation.changes.length) {
            return withEnv({ ...result, status: "failed", errorCategory: "export", preInference: false,
              error: `O execuție doar-citire a produs ${validation.changes.length} schimbări în mediu; nu au fost aplicate` });
          }
          return withEnv(result);
        }
        if (!validation.ok) {
          return withEnv({ ...result, status: "failed", errorCategory: "export", preInference: false,
            error: `Exportul din ${env.id} a fost refuzat (C14)${validation.stats?.ignoreRulesError ? ` — regulile de ignorare ale proiectului nu au putut fi folosite (${validation.stats.ignoreRulesError}), deci nimic nu a fost lăsat deoparte` : ""}: ${[...validation.problems, ...validation.refused.map((r) => `${r.path}: ${r.reason}`)].slice(0, 4).join("; ")}; nimic nu a fost aplicat în proiect` });
        }
        // A Stop that arrived while the export was read: nothing is applied after it (the export stays in quarantine).
        if (interruptReason) {
          report.apply = { applied: 0, reason: `oprit înainte de aplicare (${interruptReason}): exportul rămâne în carantină` };
          return withEnv({ ...result, status: "interrupted", preInference: false, error: `interrupted (${interruptReason})` });
        }
        const applied = environment.applyExport(wsId, { projectRoot, validation });
        report.apply = applied;
        if (applied.conflicts.length) {
          return withEnv({ ...result, status: "failed", errorCategory: "export", preInference: false,
            error: `Exportul nu a fost aplicat: ${applied.conflicts.slice(0, 3).map((c) => `${c.path}: ${c.reason}`).join("; ")} (modificările tale nu au fost suprascrise)` });
        }
        phase("export_applied");
        return withEnv(result);
      } catch (error) {
        if (interruptReason && !inner) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        // After the provider process started, a failure is never reported as a pre-inference stop (the record must not
        // claim that the model did not run).
        const category = inner && PRE_INFERENCE_CATEGORIES.has(error.category) ? "environment" : error.category || "environment";
        return withEnv(base({ status: "failed", errorCategory: category, preInference: !inner, error: String(error.message || error).slice(0, 500) }));
      } finally {
        // The workspace goes when its processes are confirmed gone; a staging copy of the export stays in the Hub.
        if (prepared) await environment.release(wsId).catch(() => {});
      }
    })();

    async function interrupt(reason = "user") {
      interruptReason = reason;
      if (inner && !innerDone) {
        const result = await inner.interrupt(reason);
        if (prepared) await environment.reap(wsId, { marker: wsId }).catch(() => {});
        return result;
      }
      if (!inner) copyAbort.abort();
      // Before the provider process exists nothing can reach a model; after it ended, the export is not applied (checked
      // above). The answer waits (bounded) for the run to settle, so "interrupted" is not reported while it still copies.
      const settled = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), 30000).unref?.())]);
      return { interrupted: settled, graceful: true, reason };
    }

    return { key, pid: null, done, interrupt, environment: env.id };
  }

  return { id, environment: env.id, displayName: `Codex (ChatGPT plan) · ${env.id}`, inspectInstallation, probe: () => environment.probeAccount(), startTurn,
    inspectConfig: () => environment.launcher.inspectConfig() };
}
