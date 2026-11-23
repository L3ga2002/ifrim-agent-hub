import crypto from "node:crypto";
import { apiKeyIdentity, API_KEY_PROVIDERS } from "./api-keys.mjs";

/**
 * 2.20 — the optional API-key route of ONE Hub instance ("pay with my own API key"), next to the default subscription route.
 *
 * Off by default, per provider. It is on only when ALL hold: a key is stored in this instance's vault (DPAPI, api-keys.mjs), the
 * owner gave the exact consent text in the owner session, and a budget is set. Every run on it is admitted against the budget
 * (daily, monthly, per run), its cost is measured while it runs (Claude: the CLI's own cost and its --max-budget-usd hard stop;
 * Codex: the token usage the app-server reports, priced with the table below) and the run is stopped at its limit. A run that
 * ends without a cost report is charged its whole per-run allowance (never zero). The subscription route keeps every rule it
 * had; turning the API route off returns the provider to it.
 *
 * Settings (no secret): apiRoutes = { [provider]: { enabled, consent, budget, enabledAt, enabledBy, disabledAt, disabledReason } },
 * apiSpend = { days: { "YYYY-MM-DD": { codex, claude } } (last 62), runs: [≤ 100 { runId, provider, model, usd, estimated, at, source }] }.
 */

export const API_CONSENT_TEXT = Object.freeze({
  codex: "Accept ca rulările Codex din acest Hub să folosească cheia mea API OpenAI, facturată de OpenAI contului meu, în limita plafoanelor setate aici. Știu că Hub-ul estimează costul din tokeni și că limita sigură se setează și în contul OpenAI (Billing → Limits).",
  claude: "Accept ca rulările Claude Code din acest Hub să folosească cheia mea API Anthropic, facturată de Anthropic contului meu, în limita plafoanelor setate aici. Știu că Hub-ul folosește costul raportat de Claude Code și că limita sigură se setează și în consola Anthropic (Limits).",
});

export const textVersion = (text) => `t-${crypto.createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 12)}`;

export const BUDGET_LIMITS = Object.freeze({ monthlyUsd: [1, 1000], dailyUsd: [0.5, 200], perRunUsd: [0.1, 50] });
export const DEFAULT_BUDGET = Object.freeze({ monthlyUsd: 20, dailyUsd: 5, perRunUsd: 2 });
/** Below this the route is "exhausted": a run could not do useful work and would only add a cut-off charge. */
export const MIN_RUN_USD = 0.05;
const MAX_DAYS = 62;
const MAX_RUNS = 100;

/**
 * OpenAI API prices, USD per 1M tokens (input, cached input, output; reasoning tokens bill as output). A Hub estimate: the
 * provider's invoice is the truth. Exact model ids first, then families; an unknown model uses the conservative fallback (it
 * over-estimates, so the Hub stops earlier, never later). "pro" models are refused (their prices are many times higher).
 * Sources checked 2026-11-23: OpenAI model pages and list prices (gpt-5-codex 1.25/10, gpt-5.3-codex 1.75/14, gpt-5.5 5/30).
 */
export const CODEX_API_PRICES = Object.freeze({
  checkedAt: "2026-11-23",
  models: Object.freeze([
    { match: /^gpt-5(\.1)?-codex(-mini)?$/i, input: 1.25, cached: 0.125, output: 10, label: "gpt-5/5.1-codex" },
    { match: /^gpt-5\.[23]-codex/i, input: 1.75, cached: 0.175, output: 14, label: "gpt-5.2/5.3-codex" },
    { match: /^codex-mini/i, input: 1.5, cached: 0.375, output: 6, label: "codex-mini" },
  ]),
  fallback: Object.freeze({ input: 5, cached: 0.5, output: 40, label: "estimare prudentă (model fără preț cunoscut)" }),
  refused: /(^|[-_.])pro($|[-_.])/i,
});

export function codexPriceFor(model) {
  const id = String(model || "").trim();
  if (CODEX_API_PRICES.refused.test(id)) return { refused: true, reason: `Modelul ${id} (pro) nu e permis pe ruta API: prețul lui e de multe ori mai mare` };
  const hit = CODEX_API_PRICES.models.find((m) => m.match.test(id));
  return hit ? { ...hit, exact: true } : { ...CODEX_API_PRICES.fallback, exact: false };
}

/** USD for one usage breakdown ({ inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens? }). */
export function codexCostUsd(breakdown, price) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const input = n(breakdown?.inputTokens ?? breakdown?.input_tokens);
  const cached = Math.min(input, n(breakdown?.cachedInputTokens ?? breakdown?.cached_input_tokens));
  // Reasoning tokens are part of the output count in the OpenAI usage object; counted once.
  const output = n(breakdown?.outputTokens ?? breakdown?.output_tokens);
  return ((input - cached) * price.input + cached * price.cached + output * price.output) / 1e6;
}

const round = (usd) => Math.round(Number(usd || 0) * 10000) / 10000;
// Calendar days and months of THIS computer (the owner's local time), not UTC.
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const monthOf = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

export function normalizeBudget(input = {}) {
  const out = {};
  for (const [name, [min, max]] of Object.entries(BUDGET_LIMITS)) {
    const v = Number(input[name] ?? DEFAULT_BUDGET[name]);
    if (!Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`${name} trebuie să fie între ${min} și ${max} USD`), { category: "validation" });
    out[name] = round(v);
  }
  if (out.dailyUsd > out.monthlyUsd) throw Object.assign(new Error("Plafonul zilnic nu poate depăși plafonul lunar"), { category: "validation" });
  if (out.perRunUsd > out.dailyUsd) throw Object.assign(new Error("Plafonul pe rulare nu poate depăși plafonul zilnic"), { category: "validation" });
  return out;
}

export function createApiAccess({ settings, vault, clock = () => new Date(), bus }) {
  const inflight = new Map(); // runId → { provider, maxUsd, observedUsd }
  const routes = () => settings.get("apiRoutes") || {};
  const spend = () => settings.get("apiSpend") || { days: {}, runs: [] };
  function writePending(update, reason) {
    bus.transaction(() => { const s = spend(); settings.set("apiSpend", { days: s.days || {}, runs: s.runs || [], pending: update(Array.isArray(s.pending) ? s.pending : []) }, "hub", reason); });
  }
  const routeOf = (provider) => (routes()[provider] && typeof routes()[provider] === "object" ? routes()[provider] : {});

  function consentValid(provider) {
    const c = routeOf(provider).consent;
    return Boolean(c && c.textVersion === textVersion(API_CONSENT_TEXT[provider]) && c.at);
  }

  function spent(provider, now = clock(), { excludeRunId = null } = {}) {
    const days = spend().days || {};
    const today = Number(days[dayOf(now)]?.[provider] || 0);
    const month = Object.entries(days).filter(([d]) => d.startsWith(monthOf(now))).reduce((s, [, v]) => s + Number(v?.[provider] || 0), 0);
    let reserved = 0;
    for (const [id, r] of inflight) if (r.provider === provider && id !== excludeRunId) reserved += Math.max(r.observedUsd, r.maxUsd);
    return { today: round(today), month: round(month), reserved: round(reserved) };
  }

  /** The budget left for ONE new run now: min(per-run, daily left, monthly left), with in-flight reservations subtracted. */
  function budgetState(provider, now = clock(), { excludeRunId = null } = {}) {
    const budget = routeOf(provider).budget || null;
    const s = spent(provider, now, { excludeRunId });
    // A run already admitted (excludeRunId) is checked against what was left WITHOUT its own reservation.
    const own = excludeRunId && inflight.get(excludeRunId)?.provider === provider ? inflight.get(excludeRunId) : null;
    if (!budget) return { ok: false, detail: "Niciun plafon setat", spent: s, budget: null, maxForRun: 0 };
    const dayLeft = budget.dailyUsd - s.today - s.reserved;
    const monthLeft = budget.monthlyUsd - s.month - s.reserved;
    const maxForRun = round(Math.max(0, Math.min(budget.perRunUsd, dayLeft, monthLeft)));
    const ok = own ? maxForRun + 1e-9 >= Math.min(own.maxUsd, MIN_RUN_USD) : maxForRun >= MIN_RUN_USD;
    const which = dayLeft <= monthLeft ? "zilnic" : "lunar";
    return { ok, maxForRun, budget, spent: s, dayLeft: round(Math.max(0, dayLeft)), monthLeft: round(Math.max(0, monthLeft)),
      detail: ok ? `Disponibil pentru o rulare: ${maxForRun.toFixed(2)} USD (azi ${s.today.toFixed(2)}/${budget.dailyUsd}, luna ${s.month.toFixed(2)}/${budget.monthlyUsd})`
        : `Plafonul ${which} este atins (azi ${s.today.toFixed(2)}/${budget.dailyUsd} USD, luna ${s.month.toFixed(2)}/${budget.monthlyUsd} USD${s.reserved ? `, rezervat ${s.reserved.toFixed(2)}` : ""})` };
  }

  /** "api_key" only when enabled + consent + key in the vault; anything else is the subscription route. */
  function mode(provider) {
    if (!API_KEY_PROVIDERS.includes(provider)) return "subscription";
    const r = routeOf(provider);
    return r.enabled === true ? "api_key" : "subscription";
  }

  /** What the billing gate reads for the API route (billing.mjs evaluateRoute). Pure facts; no secret. */
  function routeInputs(provider, now = clock(), { excludeRunId = null } = {}) {
    if (mode(provider) !== "api_key") return null;
    const key = vault.status(provider);
    return { mode: "api_key", key: key.present && key.valid ? { fingerprint: key.fingerprint, last4: key.last4 } : null, keyProblem: key.present ? key.problem || null : "Nu există o cheie API salvată",
      identity: key.valid ? apiKeyIdentity(key.fingerprint) : null, consent: consentValid(provider), budget: budgetState(provider, now, { excludeRunId }) };
  }

  /**
   * Boot: reservations left by a previous process (it stopped while a run was alive) are booked at their maximum, marked estimated.
   * Never zero: the provider may have charged up to the reservation.
   */
  function recoverPending() {
    const s = spend();
    const left = (Array.isArray(s.pending) ? s.pending : []).filter((p) => !inflight.has(p.runId));
    if (!left.length) return [];
    for (const p of left) inflight.set(p.runId, { provider: p.provider, maxUsd: Number(p.maxUsd) || 0, observedUsd: 0 });
    return left.map((p) => api.settle(p.runId, { usd: null, source: "rezervare (Hub-ul s-a oprit în timpul rulării)" }));
  }

  const api = {
    recoverPending,
    mode,
    routeInputs,
    budgetState,
    consentValid,
    /**
     * Admits one run on the API route: reserves its per-run maximum (so two concurrent runs cannot both spend the last dollars)
     * and returns the clear key for the process start. Throws (category billing) when the route is not usable.
     */
    async admit(provider, runId) {
      const inputs = routeInputs(provider);
      if (!inputs) throw Object.assign(new Error("Ruta API nu este activă"), { category: "billing" });
      if (!inputs.consent) throw Object.assign(new Error("Lipsește acordul tău pentru ruta API (Integrări → Cheie API)"), { category: "billing" });
      if (!inputs.key) throw Object.assign(new Error(inputs.keyProblem || "Cheia API lipsește"), { category: "billing" });
      if (!inputs.budget.ok) throw Object.assign(new Error(inputs.budget.detail), { category: "quota" });
      const secret = await vault.reveal(provider);
      // Re-read after the await: another run may have reserved in between.
      const state = budgetState(provider);
      if (!state.ok) throw Object.assign(new Error(state.detail), { category: "quota" });
      if (inflight.has(runId)) throw new Error(`Rularea ${runId} este deja admisă pe ruta API`);
      inflight.set(runId, { provider, maxUsd: state.maxForRun, observedUsd: 0 });
      // Persisted too: a Hub that stops while the run is alive books the whole reservation at its next start (recoverPending).
      writePending((list) => [...list, { runId, provider, maxUsd: state.maxForRun, at: clock().toISOString() }], `API reservation for ${runId}`);
      return { key: secret.key, fingerprint: secret.fingerprint, maxUsd: state.maxForRun };
    },
    /** A cost observation while the run is alive (monotonic). */
    observe(runId, usd) {
      const r = inflight.get(runId);
      if (r && Number.isFinite(Number(usd)) && Number(usd) > r.observedUsd) r.observedUsd = Number(usd);
      return r ? { observedUsd: round(r.observedUsd), maxUsd: r.maxUsd } : null;
    },
    /**
     * Ends a run's reservation and books its cost. `usd` null/undefined (no cost report: crash, kill) books the reservation's
     * maximum, marked estimated. Idempotent per run.
     */
    settle(runId, { usd = null, model = null, source = "provider" } = {}) {
      const r = inflight.get(runId);
      if (!r) return null;
      inflight.delete(runId);
      const reported = Number.isFinite(Number(usd)) && usd !== null ? Math.max(Number(usd), r.observedUsd) : null;
      const amount = round(reported ?? Math.max(r.observedUsd, r.maxUsd));
      const now = clock();
      const s = spend();
      const days = { ...(s.days || {}) };
      const day = dayOf(now);
      days[day] = { ...(days[day] || {}), [r.provider]: round(Number(days[day]?.[r.provider] || 0) + amount) };
      const kept = Object.keys(days).sort().slice(-MAX_DAYS);
      const pending = (s.pending || []).filter((p) => p.runId !== runId);
      const entry = { runId, provider: r.provider, model: model ? String(model).slice(0, 80) : null, usd: amount, estimated: reported === null, source: reported === null ? (source !== "provider" ? source : "rezervare (fără raport de cost)") : source, at: now.toISOString() };
      bus.transaction(() => {
        settings.set("apiSpend", { days: Object.fromEntries(kept.map((d) => [d, days[d]])), runs: [...(s.runs || []), entry].slice(-MAX_RUNS), pending }, "hub", `API spend booked for ${r.provider} (${runId})`);
        bus.append({ type: "api.spend", scopeType: "provider", scopeId: r.provider, source: "hub", runId, payload: { provider: r.provider, usd: amount, estimated: entry.estimated, model: entry.model } });
      });
      return entry;
    },
    /** Ends a reservation WITHOUT booking: only for a start that provably never reached the model. */
    release(runId) {
      if (!inflight.has(runId)) return false;
      inflight.delete(runId);
      writePending((list) => list.filter((p) => p.runId !== runId), `API reservation released for ${runId} (nothing reached the model)`);
      return true;
    },
    inflightOf: (runId) => (inflight.has(runId) ? { ...inflight.get(runId) } : null),
    /** What the UI shows (no secret). */
    summary(now = clock()) {
      const out = {};
      for (const provider of API_KEY_PROVIDERS) {
        const r = routeOf(provider);
        const key = vault.status(provider);
        out[provider] = { mode: mode(provider), enabled: r.enabled === true, key: key.present ? { valid: key.valid !== false && !key.problem, last4: key.last4 || null, setAt: key.setAt || null, problem: key.problem || null } : null,
          consent: consentValid(provider), consentText: API_CONSENT_TEXT[provider], consentAt: r.consent?.at || null, budget: r.budget || null, defaults: DEFAULT_BUDGET, limits: BUDGET_LIMITS,
          state: budgetState(provider, now), enabledAt: r.enabledAt || null, disabledAt: r.disabledAt || null, disabledReason: r.disabledReason || null,
          runs: (spend().runs || []).filter((x) => x.provider === provider).slice(-10).reverse() };
      }
      return { providers: out, minRunUsd: MIN_RUN_USD, codexPrices: { checkedAt: CODEX_API_PRICES.checkedAt, models: CODEX_API_PRICES.models.map((m) => ({ label: m.label, input: m.input, cached: m.cached, output: m.output })), fallback: CODEX_API_PRICES.fallback } };
    },
    // ---------- owner changes (the commands check the owner session; these only write settings) ----------
    setRoute(provider, patch, actor, reason) {
      const all = routes();
      const next = { ...all, [provider]: { ...(all[provider] || {}), ...patch } };
      bus.transaction(() => settings.set("apiRoutes", next, actor, reason));
      return next[provider];
    },
  };
  return api;
}
