import { PRE_INFERENCE_CATEGORIES } from "../core/errors.mjs";
import { createClaudeAdapter, inspectWorkspaceStartup, CLAUDE_REFUSED_MODELS, CLAUDE_MODEL_ALLOWLIST, refusedModelReason } from "./claude.mjs";
import { claudeLinuxDeniedReads } from "../policy/isolation.mjs";
import { resolveWsl, wslArgs } from "../environments/wsl.mjs";
import { BWRAP, reviewerArgs, CLAUDE_IN_SANDBOX } from "../environments/sandbox-profiles.mjs";
import { reviewerConfigFacts } from "../environments/wsl-runner.mjs";

/**
 * A model the reviewer in the environment may be asked for: an alias or a dated id of Sonnet, Opus or Haiku — the shared
 * allowlist (providers/claude.mjs) the factory, the envelopes and manual runs apply. M09: an empty model is refused (it would
 * leave the choice to the CLI's account default); the model reported at init is compared with the bound one by the run manager.
 */
export const REVIEWER_MODEL_ALLOWLIST = CLAUDE_MODEL_ALLOWLIST;

/**
 * Claude Code launcher for the wsl-runner environment (M07): the same argv as the Windows reviewer (claudeTurnArgs), started
 * as `wsl.exe --exec env -i … bwrap <reviewerArgs> /opt/claude/…/claude.exe <args>`. The deny rules carry the sandbox's
 * Linux paths; the startup files are checked on the ORIGINAL project by the adapter before the copy (the copy holds the
 * same files, and --setting-sources user never loads them); the reviewer's own settings come from the fresh inspection.
 */
export function wslClaudeLauncher({ config, env, state }) {
  return {
    environment: env.id,
    label: `claude -p @${env.id} (bwrap, doar citire)`,
    resolve: () => (state()?.facts?.claude_cli ? { executable: CLAUDE_IN_SANDBOX, prefixArgs: [] } : null),
    deniedReads: () => claudeLinuxDeniedReads("/work"),
    startupProblem: () => null,
    fallbackModelSet: () => state()?.facts?.reviewer_fallback === "yes",
    spawn: ({ args, cwd, launchVars = {} }) => {
      const invocation = resolveWsl(config);
      if (!invocation) throw Object.assign(new Error("wsl.exe nu este disponibil"), { category: "transport" });
      const marker = launchVars.IFRIM_RUN;
      return { executable: invocation.executable, cwd: config.hubRoot, env: {},
        args: [...invocation.prefixArgs, ...wslArgs(env, { cwd, vars: { IFRIM_RUN: marker }, argv: [BWRAP, ...reviewerArgs({ repo: cwd, marker }), CLAUDE_IN_SANDBOX, ...args] })] };
    },
  };
}

/**
 * Claude Code as the READ-ONLY reviewer inside the wsl-runner environment (M07, `claude@wsl-runner`). Same provider, same
 * guards (subscription login, refused models and flags, no MCP, init refusals, billing retry and model-fallback stops), a
 * process boundary instead of a tool boundary. Around the provider turn:
 *   before: read-only access only; the project's startup files checked on the original; a fresh inspection — the
 *           environment must be the attested one and the reviewer ready (C20); the project is copied into a new workspace
 *           (the copy IS the reviewed version: the factory checks that the files did not change during the review);
 *   turn:   claude -p inside bwrap with the copy read-only at /work and a dedicated config dir;
 *   after:  the client is gone, the workspace's processes are reaped, the session's files are deleted from the reviewer's
 *           config dir (they hold excerpts of the code), the workspace is removed. Nothing is ever exported or applied.
 * There is no fallback: a reviewer routed here that cannot run stops before the model; it never moves to Windows by itself.
 */
export function createWslClaudeAdapter({ environment, config, supervisor }) {
  const { env } = environment;
  const id = "claude";
  const launcher = wslClaudeLauncher({ config, env, state: () => environment.state() });
  const claude = createClaudeAdapter({ config, supervisor, launcher });

  async function inspectInstallation() {
    const state = environment.state() || await environment.inspect();
    const facts = state?.facts || {};
    return { provider: id, environment: env.id, installed: Boolean(state?.installed && facts.claude_cli && facts.claude_sha), binary: `wsl:${env.distro}:${CLAUDE_IN_SANDBOX}`, source: env.id,
      version: facts.claude_cli ? `${facts.claude_cli} (Claude Code)` : null, reason: state?.installed ? (facts.claude_cli ? null : "Claude Code nu este instalat în mediu") : state?.error || "mediul nu a fost inspectat" };
  }

  function startTurn(options) {
    const { runId, cwd: projectRoot, onEvent, projectId = "", access = "read-only", model = "", trustedWorkspace = false } = options;
    const key = `run-${runId}`;
    const phase = (name) => { try { onEvent({ type: "phase", phase: name }); } catch { /* timeline never breaks a run */ } };
    const wsId = String(runId).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    let inner = null;
    let innerDone = false;
    let interruptReason = null;
    let prepared = null;
    const copyAbort = new AbortController();
    const base = (extra) => ({ output: "", usage: {}, sessionId: "", ...extra });

    const done = (async () => {
      const report = { id: env.id, role: "reviewer", simulated: Boolean(environment.simulated), workspace: null, fingerprintHash: null, attestationId: null, attestationStatus: null,
        transfer: null, reap: null, sessionCleanup: null, export: null, apply: { applied: 0, reason: "review doar-citire: nimic nu se exportă și nimic nu se aplică în proiect" } };
      const withEnv = (result) => ({ ...result, environment: report });
      const refuse = (category, error) => withEnv(base({ status: "failed", errorCategory: category, preInference: true, error }));
      try {
        // 1. Only the read-only reviewer runs here; a model outside the allowlist never reaches the CLI.
        if (access !== "read-only") return refuse("policy", `În ${env.id} Claude rulează doar ca reviewer, doar în citire (cerut: ${access}); oprit înainte de model`);
        if (!String(model || "").trim()) return refuse("policy", `Reviewer-ul din ${env.id} pornește doar cu un model explicit (sonnet, opus, haiku sau un id claude-…); modelul implicit al contului nu se folosește; oprit înainte de model`);
        if (CLAUDE_REFUSED_MODELS.test(model) || !REVIEWER_MODEL_ALLOWLIST.test(model)) {
          return refuse("billing", `Modelul ${String(model).slice(0, 60)} nu e permis reviewer-ului din ${env.id}${CLAUDE_REFUSED_MODELS.test(model) ? `: ${refusedModelReason(model)}` : " (permise: sonnet, opus, haiku sau un id claude-sonnet/opus/haiku-…)"}`);
        }
        const startup = inspectWorkspaceStartup(projectRoot);
        if (!trustedWorkspace && startup.some((item) => item.kind !== "definitions")) {
          return refuse("policy", `Workspace defines startup hooks/MCP (${startup.map((s) => s.file).join(", ")}); mark the project trusted after review`);
        }
        // 2. The environment as it is NOW must be the attested one, with the reviewer ready (no stale verdict from boot).
        const inspected = await environment.inspect();
        report.fingerprintHash = inspected.fingerprint?.hash || null;
        const verdict = environment.attestationStatus();
        report.attestationId = verdict.latest?.id || null;
        report.attestationStatus = verdict.latest?.status || null;
        const ready = environment.reviewerReadiness(null);
        if (!inspected.ok || !ready.ok) {
          return refuse("policy", `Reviewer-ul din ${env.id} nu poate rula acum: ${!inspected.ok ? inspected.error || (inspected.problems || []).filter((p) => p.blocking).map((p) => p.detail).join("; ") : ready.detail}; oprit înainte de model (fără trecere pe Windows)`);
        }
        phase("environment_checked");
        if (interruptReason) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        // 3. Copy in: the reviewed version.
        prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId, runId: runId || null, purpose: "review", fingerprintHash: report.fingerprintHash, signal: copyAbort.signal });
        report.workspace = prepared.ws;
        report.transfer = prepared.stats;
        phase("workspace_prepared");
        if (interruptReason) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        // 4. The provider turn, read-only, in the copy; a fresh session every time (environment sessions are never resumed).
        inner = claude.startTurn({ ...options, access: "read-only", cwd: prepared.repo, sessionId: "", trustedWorkspace: true, launchVars: { IFRIM_RUN: wsId } });
        if (inner.pid) { try { onEvent({ type: "pid", pid: inner.pid }); } catch { /* the record never breaks a run */ } }
        const result = await inner.done;
        innerDone = true;
        // 2.12.2 (review R3-F5): the reviewer's turn has settled — the run manager ends the turn's deadline here (the reap and the session
        // cleanup below are not the turn and are never cut as a timeout).
        try { onEvent({ type: "turn_settled" }); } catch { /* the deadline then falls back to the supervisor record */ }
        // 5. Nothing of the run may outlive it: the client is gone (supervisor), then every process of this workspace.
        report.reap = await environment.reap(wsId, { marker: wsId, all: environment.inUse().length <= 1 }).catch((error) => ({ ok: false, error: error.message }));
        // 6. The session's files (transcript, per-session state) hold excerpts of the reviewed code: deleted from the config dir.
        if (inner.nativeSessionId) report.sessionCleanup = await environment.cleanupReviewerSession(inner.nativeSessionId).catch((error) => ({ ok: false, error: error.message }));
        if (!report.reap.ok) {
          return withEnv({ ...result, status: result.status === "completed" ? "failed" : result.status, errorCategory: result.errorCategory || "environment",
            error: `Procesele reviewer-ului din ${env.id} nu au putut fi oprite (${report.reap.error || `${report.reap.remaining} rămase`})` });
        }
        return withEnv(result);
      } catch (error) {
        if (interruptReason && !inner) return withEnv(base({ status: "interrupted", preInference: true, error: `interrupted (${interruptReason})` }));
        const category = inner && PRE_INFERENCE_CATEGORIES.has(error.category) ? "environment" : error.category || "environment";
        return withEnv(base({ status: "failed", errorCategory: category, preInference: !inner, error: String(error.message || error).slice(0, 500) }));
      } finally {
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
      const settled = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), 30000).unref?.())]);
      return { interrupted: settled, graceful: true, reason };
    }

    return { key, pid: null, done, interrupt, environment: env.id };
  }

  return { id, environment: env.id, displayName: `Claude Code (Claude plan) · ${env.id} · reviewer`, inspectInstallation, probe: () => environment.probeReviewer(), startTurn,
    inspectConfig: () => reviewerConfigFacts(environment.state()?.facts || {}) };
}
