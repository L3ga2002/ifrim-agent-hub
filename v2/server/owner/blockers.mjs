import { hashCanonical } from "../core/canonical.mjs";
import { STOPPED_BY } from "../policy/gate-state.mjs";

/**
 * M10.2 blocker explainer (pure). Before M10.2 a refused request reached the owner as raw gate ids ("host_isolation (...)"),
 * Lega guessed the fix ("după ce e în regulă izolarea, îl pot porni imediat") and pointed at panels that could not fix it. Here
 * the SERVER turns verified state into ONE honest explanation: what blocks, in the owner's words, and for every cause the
 * options that really exist, each tagged with who acts:
 *
 *   automatic_readiness      the Hub does it itself, inference-free, through the readiness runner (channel automation)
 *   owner_decision_inline    the owner decides here, in the conversation / plan card (one confirmation, Windows Hello if raising)
 *   owner_decision_separate  a separate owner decision in its own place (approval (b), billing declaration, capture decision)
 *   admin                    an administrative act outside plans (risk acceptance, investigating a failed attestation)
 *   refused                  never done by the Hub (e.g. the Software Factory on the Hub's own repository)
 *   rearm                    M10.2.1: the owner reopens the suspended execution gate here, with the rearm card (owner session + a
 *                            fresh Windows Hello, owner/gate-rearm.mjs); never by voice, never a typed gate command
 *
 * Gate checks an envelope resolves by itself (ENVELOPE_RESOLVES: grant, mode, lease, backup, concurrency, operational) are never
 * blockers. Texts never name LIVE_VALIDATION, grants or typed gate commands: those are not what the owner has to do. Nothing here
 * reads the database or calls a model; the facts come from readiness-runner.collectFacts().
 */
export const OPTION_KINDS = Object.freeze(["automatic_readiness", "owner_decision_inline", "owner_decision_separate", "admin", "refused", "rearm"]);
/** Gate checks a confirmed plan arranges itself (kept in sync with owner/envelopes.mjs ENVELOPE_RESOLVES; a leaf, no import cycle). */
export const PLAN_RESOLVED_CHECKS = Object.freeze(new Set(["live_grant", "mode", "workspace_lease", "backup", "operational", "concurrency"]));
export const ATTESTATION_CODES = Object.freeze(["not_attested", "failed", "canary_changed", "expired", "not_inspected", "fingerprint_changed", "inspection_problem"]);
/** Attestation causes a same-fingerprint re-attestation can clear (owner decision 3: only as a pre-step after a plan's confirmation). */
export const REATTEST_CODES = Object.freeze(new Set(["canary_changed", "expired"]));

/**
 * Machine-readable cause of an invalid attestation, in the same order as wsl-runner attestationStatus() decides (canary before
 * age before fingerprint), plus `fingerprintSame` computed separately: a canary change can hide a fingerprint change, and only an
 * unchanged fingerprint may ever be re-attested without the owner. Pure: every input is passed in.
 */
export function attestationCode({ valid = false, latest = null, currentCanary = null, currentFingerprint = null, inspectionOk = true, now = new Date(), maxAgeDays = 14, acceptSimulated = false } = {}) {
  const base = { attestationId: latest?.id || null, latestStatus: latest?.status || null, attestedCanary: latest?.canaryVersion || null, currentCanary,
    attestedFingerprint: latest?.fingerprintHash || null, currentFingerprint: currentFingerprint || null,
    fingerprintSame: Boolean(latest?.fingerprintHash) && Boolean(currentFingerprint) && latest.fingerprintHash === currentFingerprint,
    ageDays: latest ? Math.floor((now.getTime() - new Date(latest.finishedAt || latest.startedAt).getTime()) / 86400000) : null };
  if (valid) return { ...base, code: null };
  if (!latest) return { ...base, code: "not_attested" };
  const acceptable = latest.status === "PASS_LOCAL" || (acceptSimulated && latest.status === "PASS_SIMULATED");
  if (!acceptable) return { ...base, code: "failed" };
  if (currentCanary && latest.canaryVersion !== currentCanary) return { ...base, code: "canary_changed" };
  if (base.ageDays !== null && (now.getTime() - new Date(latest.finishedAt || latest.startedAt).getTime()) / 86400000 > maxAgeDays) return { ...base, code: "expired" };
  if (!currentFingerprint) return { ...base, code: "not_inspected" };
  if (!base.fingerprintSame) return { ...base, code: "fingerprint_changed" };
  if (!inspectionOk) return { ...base, code: "inspection_problem" };
  // attestationStatus said invalid for a reason this mirror does not know: report it as a failure (never as re-attestable).
  return { ...base, code: "failed" };
}

/**
 * Whether a same-fingerprint re-attestation may run as an automatic readiness step (owner decision 3, D3). Every condition is
 * named when it fails, so the explanation says why it is the owner's step instead. `afterConfirmation` is decided by the caller
 * from the database (a plan confirmed in the owner session, or a work request the owner confirmed), never from a channel label.
 */
export function reattestEligibility(env = {}, { decisionOn = true } = {}) {
  const att = env.attestation || {};
  const why = [];
  if (!decisionOn) why.push("re-atestarea automată este oprită (decizia 3)");
  if (!REATTEST_CODES.has(att.code)) why.push("cauza nu e o versiune nouă a verificărilor sau vechimea atestării");
  if (!att.fingerprintSame) why.push("amprenta inspectată diferă de cea atestată");
  if (!env.policyB?.approved) why.push("nu există aprobarea ta (b) pentru acest mediu");
  else if (!env.policyB.fingerprintSame) why.push("amprenta inspectată diferă de amprenta aprobării tale (b)");
  if (env.attesting) why.push("o atestare rulează deja");
  return { eligible: why.length === 0, why };
}

const ENV_WORDS = { "wsl-runner": "mediul izolat ifrim-runner" };
const envName = (id) => ENV_WORDS[id] || `mediul ${id}`;
const opt = (kind, code, label, extra = {}) => ({ kind, code, label, ...extra });

/** One cause → { code, title, detail, options }. `f` is the whole fact object (some causes read the project or the decisions). */
function causesFrom(f) {
  const out = [];
  const add = (code, title, detail, options) => out.push({ code, title, detail, options });
  const project = f.project || null;
  const route = project?.route || "windows";
  const isReal = project && project.source !== "hub-test";
  const env = f.environment || null;
  const failing = (f.checks || []).filter((c) => !c.ok && !PLAN_RESOLVED_CHECKS.has(c.id));
  const has = (id, role = null) => failing.find((c) => c.id === id && (!role || c.role === role));
  const engineering = f.intent === "engineering";

  // ---- the Hub's own repository (D10): refused, said once, with the honest note about content work.
  if (engineering && project?.isHub && f.hubSelfRefused !== false) {
    add("HUB_SELF_TARGET", "Hub-ul nu se modifică singur",
      "Depozitul Hub-ului este supraveghetorul tău: Software Factory nu lucrează pe Hub-ul însuși, iar un agent Codex cu drept de scriere pe el ar fi blocat oricum pe Windows, unde ar putea citi celelalte proiecte ale clienților. Nu e o setare pe care ai ratat-o; panoul de izolare nu schimbă asta. Un video promo nu are nevoie de Codex: e o lucrare de Content Studio, cu randare locală și fără model.",
      [opt("refused", "HUB_SELF_TARGET", "Software Factory pe Hub-ul însuși: refuzat (Hub-ul nu își modifică singur codul)")]);
  }

  // ---- host isolation: a real project on the Windows route can never be a plan step (stage map: every code stage outside).
  if (engineering && isReal && route === "windows") {
    add("HOST_R2_OPEN", "Izolarea pe Windows (R2) e deschisă",
      `Pe ruta Windows, comenzile Codex ar putea citi prin cale absolută alte proiecte de pe calculator; un proiect real rulează în plan doar într-un mediu izolat atestat.`,
      [opt("owner_decision_separate", "HOST_R2_OPEN", "Mută proiectul pe ruta wsl-runner (Sistem → Medii); cere o atestare validă și aprobarea ta (b)", { where: "#/system?tab=environments" }),
        opt("admin", "HOST_R2_OPEN", "Acceptarea riscului R2 pentru cel mult 7 zile (risc acceptat, nu izolare; nu face proiectul eligibil pentru planuri)", { where: "#/integrations?panel=isolation" })]);
  }

  // ---- the isolated environment (only when the project is routed to it).
  if (env && route !== "windows") {
    const att = env.attestation || {};
    const reattest = reattestEligibility(env, { decisionOn: f.decisions?.reattestAfterConfirmation !== false });
    const sameFp = "aceeași amprentă";
    if (env.unavailable) add("ENV_UNAVAILABLE", `${envName(env.id)} nu e disponibil`, env.unavailable, [opt("admin", "ENV_UNAVAILABLE", "Verifică instalarea mediului (Sistem → Medii); execuția nu trece pe Windows")]);
    else if (env.attesting) add("ENV_ATTESTING", "Atestarea mediului rulează acum", "Atestarea repornește distribuția; nimic nu pornește în mediu până se termină (~2 min).", [opt("automatic_readiness", "ENV_ATTESTING", "Aștept terminarea atestării", { step: null })]);
    else if (att.code === "canary_changed" || att.code === "expired") {
      const cause = att.code === "canary_changed"
        ? `Verificările Hub-ului s-au schimbat de la ultima atestare (${att.attestedCanary || "—"} → ${att.currentCanary || "—"})`
        : `Atestarea are ${att.ageDays ?? "—"} zile (maxim 14)`;
      add(att.code === "canary_changed" ? "ENV_NOT_ATTESTED_CANARY" : "ENV_ATTESTATION_EXPIRED", att.code === "canary_changed" ? "Atestarea mediului e de la o versiune mai veche a verificărilor" : "Atestarea mediului a expirat",
        `${cause}; ${att.fingerprintSame ? `mediul în sine e neschimbat (${sameFp} ${att.currentFingerprint || ""})`.trim() : "amprenta mediului trebuie verificată din nou"}.`,
        reattest.eligible
          ? [opt("automatic_readiness", att.code === "canary_changed" ? "ENV_NOT_ATTESTED_CANARY" : "ENV_ATTESTATION_EXPIRED", "Re-atestez automat după ce confirmi planul: aceeași amprentă, fără model, ~2 min, repornește distribuția", { step: { command: "environment.attest", payload: { environmentId: env.id, allowRestart: true }, afterConfirmation: true } })]
          : [opt("owner_decision_separate", att.code === "canary_changed" ? "ENV_NOT_ATTESTED_CANARY" : "ENV_ATTESTATION_EXPIRED", `Rulează atestarea din Sistem → Medii (fără model, ~2 min); nu o fac singur: ${reattest.why.join("; ")}`, { where: "#/system?tab=environments" })]);
    } else if (att.code === "fingerprint_changed") {
      add("ENV_FINGERPRINT_CHANGED", "Mediul izolat s-a schimbat", `Amprenta mediului s-a schimbat (${att.attestedFingerprint || "—"} → ${att.currentFingerprint || "—"}); o atestare veche nu acoperă mediul nou.`,
        [opt("owner_decision_separate", "ENV_FINGERPRINT_CHANGED", isReal ? "Re-atestarea și o aprobare (b) nouă pentru amprenta nouă, decise de tine (Sistem → Medii)" : "Re-atestarea pe amprenta nouă, decisă de tine (Sistem → Medii)", { where: "#/system?tab=environments" })]);
    } else if (att.code === "not_attested") {
      add("ENV_NOT_ATTESTED", "Mediul izolat nu a fost atestat", "Canary-ul C1–C17 nu a rulat încă pe acest mediu.", [opt("owner_decision_separate", "ENV_NOT_ATTESTED", "Prima atestare, pornită de tine din Sistem → Medii (fără model)", { where: "#/system?tab=environments" })]);
    } else if (att.code === "failed") {
      add("ENV_ATTESTATION_FAILED", "Ultima atestare a mediului nu a trecut", `Starea ultimei atestări: ${att.latestStatus || "—"}.`, [opt("admin", "ENV_ATTESTATION_FAILED", "Cauza trebuie investigată în Sistem → Medii înainte de o nouă atestare (nu reîncerc singur)", { where: "#/system?tab=environments" })]);
    } else if (att.code === "not_inspected") {
      add("ENV_NOT_INSPECTED", "Mediul nu a fost inspectat", "Nu există o inspecție a mediului pe care atestarea să o acopere.", [opt("automatic_readiness", "ENV_NOT_INSPECTED", "Inspectez mediul (versiuni și hash-uri, fără conținut de fișiere, fără model)", { step: { command: "environment.inspect", payload: { environmentId: env.id } } })]);
    } else if (att.code === "inspection_problem") {
      add("ENV_BOUNDARY", "Inspecția mediului raportează probleme de graniță", env.boundaryDetail || "granița mediului nu e cea atestată", [opt("admin", "ENV_BOUNDARY", "Granița mediului trebuie reparată în mediu (Sistem → Medii); nu o ocolesc", { where: "#/system?tab=environments" })]);
    }
    // The account check (C16) and the reviewer's check expire after 24 h: refreshed by the Hub, inference-free.
    const stale = [env.probes?.codex?.problem ? `Codex: ${env.probes.codex.problem}` : null, env.probes?.reviewer?.applicable && env.probes.reviewer.problem ? `reviewer-ul Claude: ${env.probes.reviewer.problem}` : null].filter(Boolean);
    if (stale.length && !env.unavailable) {
      add("ACCOUNT_CHECK_STALE", "Verificarea contului prin mediu trebuie refăcută", `${stale.join("; ")}.`,
        [opt("automatic_readiness", "ACCOUNT_CHECK_STALE", "Verific din nou contul prin mediu (C16 și reviewer-ul; handshake fără thread, fără model)", { step: { command: "environment.probe", payload: { environmentId: env.id } } })]);
    }
    if (isReal && att.code === null && !env.unavailable && (!env.policyB?.approved || !env.policyB.fingerprintSame)) {
      add("ENV_POLICY_B_NEEDED", "Proiectele reale cer aprobarea ta (b)", env.policyB?.approved ? "Aprobarea (b) a fost dată pentru altă amprentă a mediului." : "Nu ai aprobat încă rularea proiectelor reale în mediul izolat.",
        [opt("owner_decision_separate", "ENV_POLICY_B_NEEDED", "Aprobarea (b) pentru amprenta afișată, în Sistem → Medii", { where: "#/system?tab=environments" })]);
    }
    // Stage coverage (C18–C20): every code-executing stage of a real project must be inside the environment.
    if (isReal && engineering && f.stage && f.stage.realProjectEligible === false && !out.some((c) => c.code.startsWith("ENV_") || c.code === "ACCOUNT_CHECK_STALE")) {
      add("ENV_STAGES_OUTSIDE", "Unele etape ar rula în afara mediului izolat", (f.stage.blockers || []).slice(0, 3).join(" · ") || "harta etapelor indisponibilă",
        [opt("admin", "ENV_STAGES_OUTSIDE", "Etapele lipsă (preview, E2E, review) se mută în mediu după o atestare care le verifică (C18–C20); vezi Sistem → Medii", { where: "#/system?tab=environments" })]);
    }
  }

  // ---- the remaining gate checks, from the structured gate result (never the raw id as the explanation).
  const account = failing.filter((c) => c.id === "billing_route" && route === "windows" && (c.billing || []).some((b) => b.id === "identity" && b.status === "unverified"));
  if (account.length && !out.some((c) => c.code === "ACCOUNT_CHECK_STALE")) {
    const providers = [...new Set(account.map((c) => c.provider))];
    add("ACCOUNT_CHECK_STALE", "Verificarea contului trebuie refăcută", `Verificarea contului ${providers.map((p) => (p === "claude" ? "Claude" : "Codex")).join(" și ")} e mai veche de 24 h sau lipsește.`,
      providers.map((p) => opt("automatic_readiness", "ACCOUNT_CHECK_STALE", `Verific din nou contul ${p === "claude" ? "Claude" : "Codex"} (fără inferență)`, { step: { command: "provider.probe", payload: { provider: p, withModels: true } } })));
  }
  const declaration = failing.find((c) => c.id === "billing_route" && (c.billing || []).some((b) => b.id === "provider_side_overage_setting" && b.status !== "verified"));
  // A stale account check also makes the declaration unverifiable (no identity to bind it to): the refresh comes first, and the
  // re-explanation after it names the declaration only if it is still missing (new signature → said in full).
  if (declaration && !out.some((c) => c.code === "ACCOUNT_CHECK_STALE")) add("BILLING_DECLARATION", "Lipsește declarația ta de facturare", "Hub-ul nu poate citi setarea de consum peste plan a contului; o execuție are nevoie de declarația ta, legată de contul verificat.",
    [opt("owner_decision_separate", "BILLING_DECLARATION", "Declarația ta în sesiunea de proprietar (Integrări → Declară din nou)", { where: "#/integrations" })]);
  const paidRoute = failing.find((c) => c.id === "billing_route" && (c.billing || []).some((b) => b.status === "failed"));
  if (paidRoute) add("BILLING_ROUTE", "Ruta de facturare nu e abonamentul inclus", (paidRoute.billing || []).filter((b) => b.status === "failed").map((b) => b.detail).slice(0, 2).join(" · "),
    [opt("refused", "BILLING_ROUTE", "Nu rulez pe o rută facturată separat (doar abonamentele incluse)")]);
  // M10.2 review #36: evaluateRoute blocks on EVERY failed or unverified entry except allowance/credits (billing.mjs), but the three
  // branches above name only a stale identity (Windows), the declaration and a paid route. A plan "unverified" or a config never
  // inspected was dropped: billing_route is in `known`, so GATE_OTHER skipped it too, explain() said blocked:false, the planners
  // proposed a plan the envelope refused, and a preserved request re-planned in a loop without ever saying why. Whatever blocking
  // entry no branch explained is named here with its own detail, and only a config re-read is automatic (the probe re-reads it).
  const explained = (b) => (b.id === "identity" && out.some((c) => c.code === "ACCOUNT_CHECK_STALE"))
    || (b.id === "provider_side_overage_setting" && out.some((c) => c.code === "BILLING_DECLARATION" || c.code === "ACCOUNT_CHECK_STALE"))
    || (b.status === "failed" && out.some((c) => c.code === "BILLING_ROUTE"));
  for (const c of failing.filter((x) => x.id === "billing_route")) {
    const rest = (c.billing || []).filter((b) => (b.status === "failed" || (b.status === "unverified" && b.id !== "allowance" && b.id !== "credits")) && !explained(b));
    if (!rest.length) continue;
    const who = c.provider === "claude" ? "Claude" : "Codex";
    const configOnly = rest.every((b) => b.id === "config" && b.status === "unverified");
    const step = route === "windows" ? { command: "provider.probe", payload: { provider: c.provider, withModels: true } } : { command: "environment.probe", payload: { environmentId: route } };
    add("BILLING_UNVERIFIED", "Ruta de facturare nu e verificată complet", `${who}: ${rest.map((b) => b.detail).slice(0, 3).join(" · ")}`,
      configOnly
        ? [opt("automatic_readiness", "BILLING_UNVERIFIED", `Recitesc configurația ${who} (verificarea contului, fără inferență)`, { step })]
        // An unknown plan type (or anything else the Hub cannot read) is never assumed included: the owner's account has to say it.
        : [opt("admin", "BILLING_UNVERIFIED", `Contul ${who} trebuie să raporteze un abonament inclus (Integrări → Verifică contul); nu presupun că un plan necunoscut e inclus`, { where: "#/integrations" })]);
  }

  // The execution gate decides model runs only: a Studio plan (local render/QA/import, no model) never passes it, so a suspended
  // gate is not a blocker for intent studio (it would keep a promo request blocked forever).
  const g = f.intent === "studio" ? {} : f.gate || {};
  if (g.status && g.status !== "open") {
    // M10.2.1 (D14): after the owner's OWN pause „Continuă” reopens the gate; every other suspension is reopened HERE, by the rearm card
    // (owner session + a fresh Windows Hello, bound to that exact suspension) once the stop is confirmed (g.rearm: gate-rearm.mjs
    // eligibility). Never an administration pointer (no #/system, no typed gate command).
    const cause = g.suspendedBy === "owner_pause" ? "Ai pus Hub-ul pe pauză: nimic nou nu pornește până spui „Continuă”."
      : `Poarta e oprită ${STOPPED_BY[g.suspendedBy] || STOPPED_BY.legacy_unknown}: nimic nou nu pornește până o redeschizi.`;
    const rearmable = g.suspendedBy !== "owner_pause" && Boolean(g.rearm?.eligible) && (g.rearm.code === "ELIGIBLE" || g.rearm.code === "SECURITY");
    const security = rearmable && g.rearm.code === "SECURITY" ? " În jurul opririi au avut loc evenimente de securitate: cardul de redeschidere ți le arată și îți cere să confirmi că le-ai văzut." : "";
    add("GATE_SUSPENDED", "Execuțiile noi sunt oprite", `${cause}${security}`,
      g.suspendedBy === "owner_pause"
        ? [opt("owner_decision_inline", "GATE_SUSPENDED", "Spune „Continuă”: redeschid poarta după pauza ta")]
        : rearmable
          ? [opt("rearm", "GATE_SUSPENDED", "Redeschide poarta aici (Windows Hello)", { security: g.rearm.code === "SECURITY" })]
          : [opt("admin", "GATE_SUSPENDED", g.rearm?.reason && g.rearm.code !== "OPEN" ? String(g.rearm.reason) : "Poarta se redeschide aici, în cockpit, cu Windows Hello, în sesiunea ta de proprietar, după ce oprirea e confirmată")]);
  }
  if (f.frozen || has("project_frozen")) add("PROJECT_FROZEN", "Proiectul e înghețat", "Ai înghețat proiectul: niciun pas nou nu pornește pe el.", [opt("owner_decision_inline", "PROJECT_FROZEN", "Spune „Dezgheață”")]);
  const scope = has("project_scope");
  if (scope && !project?.isHub) add("PROJECT_SCOPE", "Proiectul nu e activat pentru execuții", scope.detail, [opt("admin", "PROJECT_SCOPE", "Activarea proiectului pentru execuții se face din Proiecte (administrare)", { where: "#/projects" })]);
  const breaker = has("circuit_breaker");
  if (breaker) add("BREAKER_OPEN", "Execuțiile sunt oprite temporar după erori de infrastructură", breaker.detail, [opt("admin", "BREAKER_OPEN", "Se închide singur la ora afișată; nu forțez")]);

  // ---- autonomy and the plan itself.
  if (engineering && f.autonomy === "OBSERVE") {
    add("AUTONOMY_OBSERVE", "Proiectul e pe nivelul Observ", "Pe nivelul Observ citesc, navighez și fac planuri, dar nu pornesc execuții.",
      [opt("owner_decision_inline", "AUTONOMY_OBSERVE", "Ridică autonomia la Asistat cu Windows Hello (o singură dată, pentru acest proiect)")]);
  }
  for (const t of f.plan?.started || []) add("PLAN_STARTED", "Misiunea a început deja", `„${t}” a trecut de specificație; nu primește un plan nou (continuarea e un plan separat).`, [opt("refused", "PLAN_STARTED", "Nu pun un plan nou peste o misiune pornită")]);
  for (const t of f.plan?.specProblems || []) add("PLAN_SPEC_PROBLEMS", "Specificația are probleme", t, [opt("owner_decision_inline", "PLAN_SPEC_PROBLEMS", "Completăm specificația (îmi spui ce lipsește)")]);
  if ((f.plan?.incompleteModels || []).length) {
    const d = f.plan.defaults ? ` (writer ${f.plan.defaults.writer}; reviewer ${f.plan.defaults.reviewer})` : "";
    add("PLAN_INCOMPLETE_MODELS", "Modelele planului nu sunt fixate", `${f.plan.incompleteModels.map((t) => `„${t}”`).join(", ")}: fără modele explicite planul e incomplet (nu folosesc implicitul contului).`,
      [opt("owner_decision_inline", "PLAN_INCOMPLETE_MODELS", `Folosesc modelele implicite ale rolurilor, afișate și legate în plan${d}; le confirmi odată cu planul`)]);
  }

  // ---- Content Studio (D5: no generated plates, no media AI role in this milestone).
  if (f.intent === "studio") {
    const m = f.media || {};
    if ((m.assets || 0) === 0 && (m.editProjects || 0) === 0) {
      add("STUDIO_NO_MATERIAL", "Biblioteca media e goală", "Nu am niciun material din care să montez un clip, iar în acest milestone nu generez imagini și nu folosesc un model media. Cererea ta rămâne păstrată.",
        [opt("owner_decision_inline", "STUDIO_NO_MATERIAL", "Import dintr-un folder pe care îl numești tu (un plan de import, o confirmare)"),
          opt("owner_decision_separate", "STUDIO_NO_MATERIAL", "Captură de ecran după decizia ta MB1 (captura live e oprită până atunci)")]);
    }
    if (m.tools === "UNPINNED") add("MEDIA_TOOLS_UNPINNED", "Uneltele de randare nu sunt fixate", "ffmpeg/ffprobe nu au încă o identitate fixată (versiune + sha256).",
      [opt("automatic_readiness", "MEDIA_TOOLS_UNPINNED", "Fixez ffmpeg/ffprobe ca pas al planului confirmat", { step: { command: "media.tools.pin", inPlan: true } })]);
    else if (m.tools === "CHANGED") add("MEDIA_TOOLS_CHANGED", "Un binar de randare s-a schimbat", "ffmpeg sau ffprobe nu mai e binarul fixat.", [opt("owner_decision_separate", "MEDIA_TOOLS_CHANGED", "Confirmă binarul nou în Studio → Unelte („Confirmă schimbarea”, o decizie a ta, nu un pas automat)", { where: "#/studio?panel=tools" })]);
    else if (m.tools === "MISSING") add("MEDIA_TOOLS_MISSING", "ffmpeg nu e instalat", "Randarea locală are nevoie de ffmpeg și ffprobe.", [opt("admin", "MEDIA_TOOLS_MISSING", "Instalarea ffmpeg se face în afara Hub-ului (nu instalez nimic singur)")]);
  }
  if ((f.skills?.stale || 0) > 0) add("SKILLS_STALE", "Registrul de skill-uri nu e la zi", `${f.skills.stale} skill-uri diferă de folderul v2/skills.`,
    [opt("automatic_readiness", "SKILLS_STALE", "Reconciliez registrul cu v2/skills (nu aprob nimic)", { step: { command: "skill.reconcile", payload: {} } })]);

  // ---- anything else the gate refuses is still named (never dropped), as an administrative cause with the gate's own words.
  const known = new Set(["host_isolation", "isolation", "environment_route", "billing_route", "execution_gate", "project_frozen", "project_scope", "circuit_breaker", "run_plan"]);
  for (const c of failing.filter((x) => !known.has(x.id))) add("GATE_OTHER", "O verificare a porții nu trece", `${c.role === "reviewer" ? "Reviewer" : "Writer"}: ${c.detail}`, [opt("admin", "GATE_OTHER", "Verificarea trebuie rezolvată înainte de execuție")]);
  // Isolation details the codes above did not explain (Windows consent R3, a reviewer not ready in the environment).
  for (const c of failing.filter((x) => (x.id === "isolation" || x.id === "host_isolation") && !out.some((o) => o.code.startsWith("ENV_") || o.code === "HOST_R2_OPEN" || o.code === "ACCOUNT_CHECK_STALE"))) {
    add("ISOLATION_OTHER", "Izolarea spațiului de lucru nu e confirmată", c.detail, [opt("owner_decision_separate", "ISOLATION_OTHER", "Izolarea se confirmă în Integrări → Izolare (decizia ta)", { where: "#/integrations?panel=isolation" })]);
  }
  return out;
}

/** The text of one cause, spoken once (full) per (request, signature). */
const causeText = (c) => `${c.title}. ${c.detail}`.replace(/\.\./g, ".");
const optionText = (o) => ({ automatic_readiness: "fac eu", owner_decision_inline: "decizi aici", owner_decision_separate: "decizia ta separată", admin: "administrare", refused: "refuzat", rearm: "decizi aici" }[o.kind]);

/**
 * explain(facts) → { blocked, signature, cause, causes, text, short, options, blockers, automaticOnly, steps }.
 * `signature` is the sorted set of cause codes: the same causes give the same signature (the one-time rule keys on it).
 * `steps` are the automatic_readiness steps the runner may execute (each with its command and payload).
 */
export function explain(facts = {}) {
  const causes = causesFrom(facts);
  // One entry per code (two failing checks with the same cause are one explanation), first occurrence wins.
  const seen = new Map();
  for (const c of causes) if (!seen.has(c.code)) seen.set(c.code, c); else seen.get(c.code).options.push(...c.options.filter((o) => !seen.get(c.code).options.some((p) => p.label === o.label)));
  const blockers = [...seen.values()];
  const codes = blockers.map((b) => b.code).sort();
  const options = blockers.flatMap((b) => b.options);
  const signature = codes.join("+");
  if (!blockers.length) return { blocked: false, signature: "", cause: null, causes: [], text: "", short: "", options: [], blockers: [], automaticOnly: false, steps: [] };
  const what = facts.project?.name ? ` pe ${facts.project.name}` : "";
  const lines = blockers.map((b) => causeText(b));
  const choices = options.filter((o) => o.kind !== "refused").map((o) => `${o.label} (${optionText(o)})`);
  // The kept-request sentence goes first: a long explanation spoken by Lega is clipped at the end (speakable, 900 chars), and the
  // owner must always hear that nothing was lost.
  const text = [`Nu pot porni încă${what}; cererea ta rămâne păstrată.`, ...lines, choices.length ? `Ce se poate face: ${choices.join("; ")}.` : "Nu există o cale prin care să pornesc asta."].join(" ");
  const short = `Încă blocat de ${blockers[0].title.charAt(0).toLowerCase()}${blockers[0].title.slice(1)}${blockers.length > 1 ? ` (și încă ${blockers.length - 1})` : ""}; cererea ta e păstrată.`;
  const automaticOnly = blockers.every((b) => b.options.some((o) => o.kind === "automatic_readiness"));
  const steps = options.filter((o) => o.kind === "automatic_readiness" && o.step?.command).map((o) => ({ code: o.code, ...o.step }));
  return { blocked: true, signature, cause: blockers[0].code, causes: codes, text, short, options, blockers, automaticOnly, steps };
}

/**
 * Whether a re-proposed plan differs from the one the owner confirmed ONLY by the readiness evidence (the attestation refs after a
 * same-fingerprint re-attestation). For the plan lifecycle (U11): it may treat such a delta as covered by the confirmation of a plan
 * whose card showed the re-attestation pre-step; any other difference needs the owner again. Pure.
 */
export function readinessOnlyDelta(before = {}, after = {}) {
  const keys = ["missions", "baseSnapshot", "attestationRefs", "workspaceScope", "limits", "modeTransition", "models", "effortPolicy", "autonomyLevel", "objective", "deniedEffects", "allowedEffects"];
  const changed = keys.filter((k) => hashCanonical(before?.[k] ?? null) !== hashCanonical(after?.[k] ?? null));
  const a = (before.attestationRefs || [])[0] || {}; const b = (after.attestationRefs || [])[0] || {};
  const evidenceOnly = changed.length === 1 && changed[0] === "attestationRefs" && a.environment === b.environment && Boolean(b.valid)
    && /^PASS/.test(String(b.status || "")) && Boolean(a.fingerprintHash) && a.fingerprintHash === b.fingerprintHash;
  return { changed, readinessOnly: changed.length === 0 || evidenceOnly };
}
