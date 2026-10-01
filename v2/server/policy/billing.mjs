/**
 * BillingPolicy is enforced in code, not in prompts. These are Hub-internal rules, not provider
 * settings: they decide whether the Hub is willing to start a route. The Hub cannot change what a
 * provider bills; where a provider-side setting cannot be read, the route stays blocked until you
 * record the manual check (an attestation), and the runtime still stops before usage limits.
 */
export const BILLING_POLICY = Object.freeze({
  mode: "included_subscription_only",
  paid_api_inference: "deny",
  purchased_credits_consumption: "deny",
  automatic_topups: "deny",
  paid_fallback: "deny",
  new_paid_services: "deny",
  automatic_plan_upgrade: "deny",
});

/** Environment variables that can select a separately billed route. Only names are ever reported. */
export const BILLING_RISK_ENV = Object.freeze([
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT_ID", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
]);

const RISK_UPPER = new Set(BILLING_RISK_ENV.map((n) => n.toUpperCase()));

/** Allowlist of environment variables passed to provider child processes. Everything else is dropped. */
export const CHILD_ENV_ALLOWLIST = Object.freeze([
  "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "Path", "PATH", "TEMP", "TMP",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA", "ProgramData", "PROGRAMDATA",
  "ProgramFiles", "PROGRAMFILES", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)",
  "SystemDrive", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "USERNAME", "USERDOMAIN", "COMPUTERNAME",
  "LANG", "LC_ALL", "TZ", "NO_COLOR",
]);

export function scanEnvironment(env = process.env) {
  const keys = Object.keys(env);
  const seen = new Set();
  const present = BILLING_RISK_ENV.filter((name) => {
    const upper = name.toUpperCase();
    if (seen.has(upper)) return false;
    const hit = keys.some((k) => k.toUpperCase() === upper && typeof env[k] === "string" && env[k] !== "");
    if (hit) seen.add(upper);
    return hit;
  });
  return { riskyVariablesPresent: present, note: present.length ? "Prezente în procesul Hub; eliminate din mediul fiecărui proces provider." : "Niciuna." };
}

/** Builds the controlled child environment: allowlist only, plus explicit extras. Never inherits keys, tokens or proxies. */
export function buildChildEnv(extra = {}, env = process.env) {
  const out = {};
  for (const name of CHILD_ENV_ALLOWLIST) if (typeof env[name] === "string") out[name] = env[name];
  for (const [name, value] of Object.entries(extra)) {
    // Windows environment names are case-insensitive: openai_api_key IS OPENAI_API_KEY for a child process.
    if (RISK_UPPER.has(String(name).toUpperCase())) throw new Error(`Refusing to pass billing-risk variable ${name} to a provider`);
    out[name] = value;
  }
  out.NO_UPDATE_NOTIFIER = "1";
  return out;
}

const SUBSCRIPTION_PLANS = {
  codex: new Set(["plus", "pro", "prolite", "promax", "team", "business", "enterprise", "edu", "edu_plus", "edu_pro", "go", "free", "self_serve_business_prolite", "ent26"]),
  claude: new Set(["pro", "max", "team", "enterprise"]),
};
// Plans whose names indicate usage-based billing: allowed only with an attestation, never assumed included.
const USAGE_BASED_PLANS = new Set(["self_serve_business_usage_based", "enterprise_cbp_usage_based", "enterprise_cbp_automation"]);

const ATTESTATION_MAX_AGE_DAYS = 30;

function attestationStatus(attestations, provider, now) {
  const record = attestations?.[provider];
  if (!record?.confirmedAt) return { ok: false, reason: "missing" };
  const ageDays = (now.getTime() - new Date(record.confirmedAt).getTime()) / 86400000;
  if (!(ageDays >= 0) || ageDays > ATTESTATION_MAX_AGE_DAYS) return { ok: false, reason: "expired", confirmedAt: record.confirmedAt };
  return { ok: true, confirmedAt: record.confirmedAt };
}

export const ATTESTATION_TEXT = Object.freeze({
  codex: "Am verificat în ChatGPT Settings → Usage că soldul de credite este 0 și că reîncărcarea automată (automatic reload) este oprită.",
  claude: "Am verificat în claude.ai Settings → Usage că usage credits (fostul extra usage) sunt dezactivate și că auto-reload este oprit.",
});

/**
 * Evaluates whether a provider route is admissible under BillingPolicy. `inspection` comes from the
 * adapter (identity/auth/config facts gathered with the exact child environment used for runs).
 * Each check reports verified | unverified | failed; any failed or unverified cost check blocks.
 */
export function evaluateRoute(provider, inspection, { attestations = {}, now = new Date(), usage = null, reservePercent = 20 } = {}) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  if (!inspection || inspection.installed === false) {
    add("installation", "failed", "Clientul oficial nu a fost găsit sau neinspectat");
  } else {
    add("installation", "verified", `${inspection.binary || ""} ${inspection.version || ""}`.trim());
  }

  const auth = inspection?.auth || null;
  if (provider === "codex") {
    if (!auth) add("identity", "unverified", "Rulează „Verifică contul” (account/read) din Integrări");
    else if (auth.accountType === "apiKey" || auth.accountType === "apikey") add("identity", "failed", "Codex este autentificat cu API key: facturarea API plătită este refuzată");
    else if (auth.accountType !== "chatgpt") add("identity", "failed", `Tip de cont Codex nesuportat: ${auth.accountType || "niciunul"}`);
    else add("identity", "verified", "Cont ChatGPT (autentificare prin abonament)");
    if (auth?.planType) {
      if (USAGE_BASED_PLANS.has(auth.planType)) add("plan", "failed", `Planul ${auth.planType} este facturat după consum`);
      else if (SUBSCRIPTION_PLANS.codex.has(auth.planType)) add("plan", "verified", `Plan raportat: ${auth.planType}`);
      else add("plan", "unverified", `Plan raportat, necunoscut: ${auth.planType}`);
    } else if (auth) add("plan", "unverified", "Tipul planului nu este raportat");
    if (inspection?.config?.customProvider) add("config", "failed", `config.toml selectează model_provider=${inspection.config.customProvider}`);
    else if (inspection?.config?.apiKeyAuthPreferred) add("config", "failed", "config.toml preferă autentificarea cu API key");
    else if (inspection?.config) add("config", "verified", "Fără provider personalizat sau preferință API key în configurația Codex");
    else add("config", "unverified", "Configurația Codex nu a fost inspectată");
  } else if (provider === "claude") {
    if (!auth) add("identity", "unverified", "Rulează „Verifică contul” (claude auth status) din Integrări");
    else if (!auth.loggedIn) add("identity", "failed", "Claude Code nu este autentificat");
    else if (auth.authMethod !== "claude.ai" || auth.apiProvider !== "firstParty") add("identity", "failed", `Metoda ${auth.authMethod}/${auth.apiProvider} nu este ruta de abonament claude.ai`);
    else add("identity", "verified", "Autentificare claude.ai, first-party");
    if (auth?.subscriptionType) {
      if (SUBSCRIPTION_PLANS.claude.has(auth.subscriptionType)) add("plan", "verified", `Abonament: ${auth.subscriptionType}`);
      else add("plan", "failed", `Tipul ${auth.subscriptionType} nu este un plan Claude cu utilizare inclusă`);
    } else if (auth) add("plan", "unverified", "Tipul abonamentului nu este raportat");
    if (inspection?.config?.apiKeyHelper) add("config", "failed", "Un apiKeyHelper este configurat în setările Claude");
    else if (inspection?.config?.riskyEnvInSettings?.length) add("config", "failed", `Setările Claude definesc ${inspection.config.riskyEnvInSettings.join(", ")}`);
    else if (inspection?.config?.fallbackModelSet) add("config", "failed", "Setările Claude definesc fallbackModel (comutare automată pe alt model, posibil facturată); scoate cheia din setări");
    else if (inspection?.config) add("config", "verified", "Fără apiKeyHelper sau variabile de facturare în setările Claude");
    else add("config", "unverified", "Setările Claude nu au fost inspectate");
  } else {
    add("provider", "failed", `Unknown provider ${provider}`);
  }

  const attestation = attestationStatus(attestations, provider, now);
  add("provider_side_overage_setting", attestation.ok ? "verified" : "unverified",
    attestation.ok ? `Verificare manuală înregistrată ${attestation.confirmedAt}` : `Hub-ul nu poate citi setarea. Necesar: ${ATTESTATION_TEXT[provider] || "verificare manuală"}`);

  const credits = usage?.creditsReported || null;
  if (credits) {
    // null/undefined/"" is an unknown balance, not 0 (Number(null) === 0).
    const raw = credits.balance;
    const balance = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    if (credits.unlimited) add("credits", "failed", "Providerul raportează credite nelimitate: consumul peste plan nu ar avea plafon");
    else if (credits.hasCredits && Number.isFinite(balance) && balance > 0) add("credits", "failed", `Sold de credite ${balance}: după epuizarea alocării, Codex le consumă automat (nu există comutator); purchased_credits_consumption: deny`);
    else if (credits.hasCredits && !Number.isFinite(balance)) add("credits", "unverified", "Providerul raportează credite, dar nu și soldul");
    else add("credits", "verified", "Fără sold de credite raportat");
  }

  if (usage) {
    const ceiling = 100 - reservePercent;
    const worst = Math.max(...(usage.windows || []).map((w) => Number(w.usedPercent) || 0), 0);
    if (usage.ordinaryUsageAllowed === false || usage.limitReached) add("allowance", "failed", "Providerul raportează allowance-ul inclus epuizat");
    else if (worst >= ceiling) add("allowance", "failed", `Utilizarea ${worst}% a atins plafonul Hub ${ceiling}% (ceiling; rezervă ${reservePercent}% pentru munca interactivă)`);
    else add("allowance", "verified", `Cea mai încărcată fereastră ${worst}% (plafon ${ceiling}%)`);
  } else {
    add("allowance", "unverified", "Nicio măsurătoare încă; runtime-ul o citește înainte de fiecare turn când providerul o expune");
  }

  const blocking = checks.filter((c) => c.status === "failed" || (c.status === "unverified" && c.id !== "allowance" && c.id !== "credits"));
  return { provider, policy: BILLING_POLICY, allowed: blocking.length === 0, checks, blockingReasons: blocking.map((c) => `${c.id}: ${c.detail}`) };
}
