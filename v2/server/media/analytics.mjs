import { HubError } from "../core/errors.mjs";
import { newId, nowIso } from "../core/ids.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { parseCsv } from "../sales/tabular.mjs";

/**
 * M09 Analytics — measured results only.
 * - Missing is not zero: an empty / "N/A" / non-numeric cell is stored as value NULL with `unavailable_reason`.
 * - Definitions are per platform and never mixed: a metric key belongs to one platform's registry; there are no cross-platform
 *   totals; fixture values are labelled and kept apart from real values.
 * - Manual CSV import reuses the bounded Sales CSV reader (BOM, quotes, `,`/`;`/tab delimiters); the decimal separator follows
 *   the file (`;` files use a decimal comma).
 * - Experiments are pre-registered (canonical sha, immutable) and INCONCLUSIVE below `minSamplePerArm` or with missing data;
 *   an observational design is labelled association only.
 * - Insights have statuses with rules; a number needs a base (n) and a definition. Scene diagnostics are hypotheses only.
 */

const m = (label, unit, extra = {}) => Object.freeze({ label, unit, granularity: "day", latency: "de verificat", sourceRef: "de verificat", availability: "unknown", ...extra });
const yt = (label, unit, definition) => m(label, unit, { latency: "24–72 h (estimare)", sourceRef: "S15", availability: "documented", definition });
export const METRIC_REGISTRY = Object.freeze({
  version: 1,
  note: "Definițiile YouTube vin din documentația YouTube Analytics (S15); celelalte platforme sunt „de verificat” până la o sursă oficială.",
  platforms: Object.freeze({
    youtube: Object.freeze({
      views: yt("Vizualizări", "count", "Metrica `views` din YouTube Analytics"),
      estimatedMinutesWatched: yt("Minute vizionate (estimat)", "minutes", "Metrica `estimatedMinutesWatched`"),
      averageViewDuration: yt("Durată medie de vizionare", "seconds", "Metrica `averageViewDuration` (secunde)"),
      averageViewPercentage: yt("Procent mediu vizionat", "percent", "Metrica `averageViewPercentage`"),
      likes: yt("Aprecieri", "count", "Metrica `likes`"),
      comments: yt("Comentarii", "count", "Metrica `comments`"),
      shares: yt("Distribuiri", "count", "Metrica `shares`"),
      subscribersGained: yt("Abonați câștigați", "count", "Metrica `subscribersGained`"),
    }),
    instagram: Object.freeze({
      views: m("Vizualizări", "count", { definition: "Vizualizări Reels (definiția Meta, de verificat)" }),
      reach: m("Conturi atinse", "count", { definition: "Reach (de verificat)" }),
      likes: m("Aprecieri", "count", { definition: "Aprecieri" }),
      comments: m("Comentarii", "count", { definition: "Comentarii" }),
      shares: m("Distribuiri", "count", { definition: "Distribuiri" }),
      saves: m("Salvări", "count", { definition: "Salvări" }),
    }),
    tiktok: Object.freeze({
      views: m("Vizualizări", "count", { definition: "Vizualizări video (definiția TikTok, de verificat)" }),
      likes: m("Aprecieri", "count", { definition: "Aprecieri" }),
      comments: m("Comentarii", "count", { definition: "Comentarii" }),
      shares: m("Distribuiri", "count", { definition: "Distribuiri" }),
      averageWatchTimeSeconds: m("Timp mediu de vizionare", "seconds", { definition: "Timp mediu de vizionare (de verificat)" }),
      fullVideoWatchedRate: m("Vizionat integral", "percent", { definition: "Procent vizionat integral (de verificat)" }),
    }),
    x: Object.freeze({
      impressions: m("Afișări", "count", { definition: "Impressions (de verificat)" }),
      videoViews: m("Vizualizări video", "count", { definition: "Video views (de verificat)" }),
      likes: m("Aprecieri", "count", { definition: "Likes" }),
      reposts: m("Repostări", "count", { definition: "Reposts" }),
      replies: m("Răspunsuri", "count", { definition: "Replies" }),
    }),
    linkedin: Object.freeze({
      impressions: m("Afișări", "count", { definition: "Impressions (de verificat)" }),
      videoViews: m("Vizualizări video", "count", { definition: "Video views (de verificat)" }),
      reactions: m("Reacții", "count", { definition: "Reacții" }),
      comments: m("Comentarii", "count", { definition: "Comentarii" }),
      reposts: m("Redistribuiri", "count", { definition: "Reposts" }),
    }),
  }),
});
/** Due times after publication — orientation, not a guarantee (platforms report late). */
export const SNAPSHOT_TARGETS = Object.freeze([["1h", 1], ["6h", 6], ["24h", 24], ["72h", 72], ["7d", 168], ["30d", 720]]);
const TARGET_HOURS = Object.freeze(Object.fromEntries(SNAPSHOT_TARGETS));
export const EXPERIMENT_DESIGNS = Object.freeze(["randomized_native", "observational"]);
export const INSIGHT_STATUSES = Object.freeze(["HYPOTHESIS", "OBSERVED_ASSOCIATION", "EXPERIMENT_SUPPORTED", "INCONCLUSIVE", "RETIRED"]);
const FIXTURE_LABEL = "DATE DE TEST (fixture)";
const MISSING_TOKENS = new Set(["", "-", "—", "–", "n/a", "na", "n.a.", "null", "none", "nan", "indisponibil", "?"]);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (v) => String(v ?? "").replace(CONTROL, "").trim();
const clip = (v, max) => { const s = clean(v); return s.length > max ? s.slice(0, max) : s; };
const bad = (message, code = "VALIDATION", data) => new HubError("validation", message, { code, data });
const conflict = (message, code = "CONFLICT", data) => new HubError("conflict", message, { code, data });
const normalizeRo = (text) => String(text ?? "").replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț");
const shown = (v) => clip(String(v ?? "").replace(/[\r\n\t]/g, " "), 40);

export function metricDefinition(platform, key) {
  return METRIC_REGISTRY.platforms[platform]?.[key] || null;
}

/**
 * Parses a numeric cell. `decimal` is "," or "."; thousands separators (space, NBSP, the other mark) are removed.
 * Returns { value } or { value: null, reason }. An explicit 0 stays 0.
 */
export function parseMetricValue(raw, { decimal = ".", unit = "count" } = {}) {
  const text = clean(raw).replace(/ | /g, " ");
  if (MISSING_TOKENS.has(text.toLowerCase())) return { value: null, reason: text ? `valoare indisponibilă în fișier („${shown(text)}”)` : "celulă goală în fișier" };
  let s = text.replace(/%$/, "").trim();
  if (/%$/.test(text) && unit !== "percent") return { value: null, reason: `procent („${shown(text)}”) pentru o metrică de tip ${unit}` };
  const thousands = decimal === "," ? "." : ",";
  s = s.replace(/[\s']/g, "");
  if (!/^[+-]?[\d.,]+$/.test(s)) return { value: null, reason: `valoare nenumerică („${shown(text)}”)` };
  const parts = s.split(decimal);
  if (parts.length > 2) return { value: null, reason: `separator zecimal ambiguu („${shown(text)}”)` };
  let intPart = parts[0];
  const frac = parts[1];
  if (frac !== undefined && !/^\d+$/.test(frac)) return { value: null, reason: `valoare nenumerică („${shown(text)}”)` };
  if (intPart.includes(thousands)) {
    const grouped = thousands === "." ? /^[+-]?\d{1,3}(\.\d{3})+$/ : /^[+-]?\d{1,3}(,\d{3})+$/;
    if (!grouped.test(intPart)) return { value: null, reason: `separator de mii invalid („${shown(text)}”)` };
    intPart = intPart.split(thousands).join("");
  }
  if (!/^[+-]?\d+$/.test(intPart)) return { value: null, reason: `valoare nenumerică („${shown(text)}”)` };
  const value = Number(`${intPart}${frac !== undefined ? `.${frac}` : ""}`);
  if (!Number.isFinite(value)) return { value: null, reason: `valoare nenumerică („${shown(text)}”)` };
  if (unit === "count" && (!Number.isInteger(value) || value < 0)) return { value: null, reason: `o metrică de tip număr trebuie să fie un întreg ≥ 0 („${shown(text)}”)` };
  if (value < 0) return { value: null, reason: `valoare negativă („${shown(text)}”)` };
  if (unit === "percent" && value > 100) return { value: null, reason: `procent peste 100 („${shown(text)}”)` };
  return { value };
}

/** Date cell → "YYYY-MM-DD" (ISO, DD.MM.YYYY, DD/MM/YYYY) or null. */
export function parseDateCell(raw) {
  const t = clean(raw);
  let y; let mo; let d;
  let mm = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (mm) [y, mo, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) [d, mo, y] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// ---------- statistics (Welch t-test with an exact Student t tail via the regularized incomplete beta) ----------
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const k of c) { y += 1; ser += k / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const MAXIT = 200; const EPS = 3e-12; const FPMIN = 1e-300;
  const qab = a + b; const qap = a + 1; const qam = a - 1; let c = 1; let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let mi = 1; mi <= MAXIT; mi += 1) {
    const m2 = 2 * mi;
    let aa = (mi * (b - mi) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + mi) * (qab + mi) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value of Student t with `df` degrees of freedom. */
export function studentTwoSidedP(t, df) {
  if (!Number.isFinite(t) || !(df > 0)) return null;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs) => { const mu = mean(xs); return xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1); };
export function welch(a, b) {
  const va = variance(a); const vb = variance(b);
  const se2 = va / a.length + vb / b.length;
  const diff = mean(b) - mean(a);
  if (se2 === 0) return { diff, t: null, df: null, p: diff === 0 ? 1 : null, note: "varianță zero în ambele brațe" };
  const t = diff / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  return { diff, t, df, p: studentTwoSidedP(t, df) };
}

export function createAnalytics({ db, bus, clock = () => new Date() }) {
  const now = () => nowIso(clock);
  const emit = (type, scopeId, payload, source = "analytics") => bus.append({ type, scopeType: "content", scopeId, source, payload });
  const rowToMetric = (r) => r && ({ id: r.id, releaseAttemptId: r.release_attempt_id, contentProjectId: r.content_project_id, platform: r.platform, metricKey: r.metric_key,
    value: r.value, unit: r.unit, observedAt: r.observed_at, dataThrough: r.data_through, window: r.window, source: r.source, unavailableReason: r.unavailable_reason,
    fixture: r.source === "fixture", label: r.source === "fixture" ? FIXTURE_LABEL : null, createdBy: r.created_by, createdAt: r.created_at });
  const rowToExperiment = (r) => r && ({ id: r.id, title: r.title, variable: r.variable, arms: parse(r.arms_json, []), audience: r.audience, primaryMetric: r.primary_metric,
    window: parse(r.window_json, {}), analysisRule: parse(r.analysis_rule_json, {}), design: r.design, simultaneousChanges: parse(r.simultaneous_changes_json, []),
    status: r.status, registeredSha256: r.registered_sha256, result: parse(r.result_json, {}), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToInsight = (r) => r && ({ id: r.id, hypothesis: r.hypothesis, cohort: parse(r.cohort_json, {}), sample: parse(r.sample_json, {}), units: r.units,
    dataRefs: parse(r.data_refs_json, []), confounders: parse(r.confounders_json, []), result: parse(r.result_json, {}), status: r.status, experimentId: r.experiment_id,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

  function resolveTarget({ platform, attemptId = null, contentProjectId = null }) {
    if (!METRIC_REGISTRY.platforms[platform]) throw bad(`Platformă necunoscută pentru metrici: ${platform}`);
    if (!attemptId && !contentProjectId) throw bad("Metricile trebuie legate de o încercare de publicare sau de un proiect de conținut");
    let projectId = contentProjectId || null;
    if (attemptId) {
      const a = db.prepare("SELECT a.platform, a.status, m.content_project_id FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id WHERE a.id = ?").get(attemptId);
      if (!a) throw new HubError("not_found", "Încercarea de publicare nu există");
      if (a.platform !== platform) throw bad(`Încercarea e pentru ${a.platform}, nu pentru ${platform}: definițiile nu se amestecă`, "PLATFORM_MISMATCH");
      if (projectId && projectId !== a.content_project_id) throw bad("Încercarea aparține altui proiect de conținut");
      projectId = a.content_project_id;
    } else if (!db.prepare("SELECT 1 FROM content_projects WHERE id = ?").get(projectId)) throw new HubError("not_found", "Proiectul de conținut nu există");
    return { attemptId, contentProjectId: projectId };
  }

  const insertMetric = db.prepare(`INSERT INTO content_metrics (id, release_attempt_id, content_project_id, platform, metric_key, value, unit, observed_at, data_through, window, source, unavailable_reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  /**
   * Manual CSV import. `mapping` = { "<header in file>": "<metric key>" | "@date" | "@ignore" }. Unknown metric keys for the
   * platform are refused (no silent mixing). Re-importing the same file for the same target is a no-op (dedupe).
   */
  function importManual({ platform, csvText, mapping, attemptId = null, contentProjectId = null, actor = "owner", observedAt = null, window = "", decimal = null } = {}) {
    const target = resolveTarget({ platform, attemptId, contentProjectId });
    if (typeof csvText !== "string" || !csvText.trim()) throw bad("Conținutul CSV lipsește");
    if (!mapping || typeof mapping !== "object" || !Object.keys(mapping).length) throw bad("Maparea coloanelor lipsește");
    const parsed = parseCsv(csvText, { maxBytes: 5 * 1024 * 1024, maxRows: 5000 });
    const dec = decimal || (parsed.delimiter === ";" ? "," : ".");
    if (![",", "."].includes(dec)) throw bad("Separatorul zecimal trebuie să fie „,” sau „.”");
    const headerIndex = new Map(parsed.headers.map((h, i) => [h.toLocaleLowerCase("ro"), i]));
    const defs = METRIC_REGISTRY.platforms[platform];
    const metricCols = []; let dateCol = -1;
    for (const [header, targetKey] of Object.entries(mapping)) {
      const idx = headerIndex.get(clean(header).replace(/\s+/g, " ").toLocaleLowerCase("ro"));
      if (idx === undefined) throw bad(`Coloana „${shown(header)}” din mapare nu există în fișier (coloane: ${parsed.headers.map(shown).join(", ")})`, "MAPPING_COLUMN_MISSING");
      if (targetKey === "@ignore") continue;
      if (targetKey === "@date") { dateCol = idx; continue; }
      if (!defs[targetKey]) throw bad(`Metrica „${shown(targetKey)}” nu e definită pentru ${platform}; definițiile nu se amestecă între platforme`, "METRIC_UNKNOWN");
      if (metricCols.some((c) => c.key === targetKey)) throw bad(`Metrica ${targetKey} e mapată de două ori`);
      metricCols.push({ idx, key: targetKey, def: defs[targetKey] });
    }
    if (!metricCols.length) throw bad("Maparea nu conține nicio coloană de metrică");
    const obs = observedAt ? new Date(observedAt) : clock();
    if (!Number.isFinite(obs.getTime())) throw bad("Momentul observației nu e valid");
    const win = clip(window || (dateCol >= 0 ? "day" : ""), 20);
    const importKey = sha256(JSON.stringify([platform, target.attemptId, target.contentProjectId, mapping, csvText]));
    const dedupeKey = `content.metrics.import:${importKey}`;
    const prior = db.prepare("SELECT payload_json FROM events WHERE dedupe_key = ?").get(dedupeKey);
    if (prior) return { importId: importKey.slice(0, 16), duplicate: true, ...parse(prior.payload_json, {}) };
    const warnings = [...parsed.warnings];
    let values = 0; let unavailable = 0; let rows = 0;
    return bus.transaction(() => {
      const at = now();
      for (const [r, row] of parsed.rows.entries()) {
        let dataThrough = null;
        if (dateCol >= 0) {
          dataThrough = parseDateCell(row[dateCol]);
          if (!dataThrough) { warnings.push(`Rândul ${r + 2}: data „${shown(row[dateCol])}” nu e recunoscută; rândul e importat fără dată`); }
        }
        rows += 1;
        for (const col of metricCols) {
          const res = parseMetricValue(row[col.idx], { decimal: dec, unit: col.def.unit });
          if (res.value === null) unavailable += 1; else values += 1;
          insertMetric.run(newId("cmt"), target.attemptId, target.contentProjectId, platform, col.key, res.value, col.def.unit, obs.toISOString(), dataThrough, win, "manual_import",
            res.value === null ? res.reason : null, actor, at);
        }
      }
      const summary = { rows, values, unavailable, delimiter: parsed.delimiter, decimal: dec, metrics: metricCols.map((c) => c.key), warnings: warnings.slice(0, 50) };
      bus.append({ type: "content.metrics.imported", scopeType: "content", scopeId: target.contentProjectId, source: actor, dedupeKey,
        payload: { ...summary, platform, attemptId: target.attemptId, importId: importKey.slice(0, 16) } });
      return { importId: importKey.slice(0, 16), duplicate: false, ...summary };
    });
  }

  /** Test/demo values: source `fixture`, always labelled, never merged with real values. */
  function recordFixture({ platform, metrics, attemptId = null, contentProjectId = null, observedAt = null, dataThrough = null, window = "", actor = "test" } = {}) {
    const target = resolveTarget({ platform, attemptId, contentProjectId });
    if (!metrics || typeof metrics !== "object" || !Object.keys(metrics).length) throw bad("Fixture-ul nu are metrici");
    const defs = METRIC_REGISTRY.platforms[platform];
    const obs = observedAt ? new Date(observedAt) : clock();
    if (!Number.isFinite(obs.getTime())) throw bad("Momentul observației nu e valid");
    return bus.transaction(() => {
      const ids = [];
      for (const [key, value] of Object.entries(metrics)) {
        const def = defs[key];
        if (!def) throw bad(`Metrica „${shown(key)}” nu e definită pentru ${platform}`, "METRIC_UNKNOWN");
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw bad(`Valoare invalidă pentru ${key}`);
        const id = newId("cmt");
        insertMetric.run(id, target.attemptId, target.contentProjectId, platform, key, value, def.unit, obs.toISOString(), dataThrough, clip(window, 20), "fixture",
          value === null ? "fixture: valoare lipsă" : null, actor, now());
        ids.push(id);
      }
      emit("content.metrics.fixture_recorded", target.contentProjectId, { platform, attemptId: target.attemptId, metrics: Object.keys(metrics), label: FIXTURE_LABEL }, actor);
      return { ids, label: FIXTURE_LABEL };
    });
  }

  function projectMetricRows(contentProjectId) {
    return db.prepare(`SELECT * FROM content_metrics WHERE content_project_id = ? OR release_attempt_id IN
      (SELECT a.id FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id WHERE m.content_project_id = ?) ORDER BY observed_at, COALESCE(data_through, ''), created_at, rowid`).all(contentProjectId, contentProjectId).map(rowToMetric);
  }

  function snapshots({ attemptId = null, contentProjectId = null, platform = null, metricKey = null, includeFixtures = true, limit = 500 } = {}) {
    const where = []; const args = [];
    if (attemptId) { where.push("release_attempt_id = ?"); args.push(attemptId); }
    if (contentProjectId) { where.push("content_project_id = ?"); args.push(contentProjectId); }
    if (platform) { where.push("platform = ?"); args.push(platform); }
    if (metricKey) { where.push("metric_key = ?"); args.push(metricKey); }
    if (!includeFixtures) where.push("source <> 'fixture'");
    if (!where.length) throw bad("Indică o încercare de publicare, un proiect sau o platformă");
    return db.prepare(`SELECT * FROM content_metrics WHERE ${where.join(" AND ")} ORDER BY observed_at DESC, created_at DESC LIMIT ?`).all(...args, Math.min(Math.max(Number(limit) || 500, 1), 5000)).map(rowToMetric);
  }

  function entryOf(list, platform, key) {
    const latest = list[list.length - 1];
    const def = metricDefinition(platform, key);
    const ageH = (clock().getTime() - Date.parse(latest.observedAt)) / 3600000;
    return {
      value: latest.value, unit: latest.unit, unavailableReason: latest.unavailableReason, observedAt: latest.observedAt, dataThrough: latest.dataThrough, window: latest.window,
      source: latest.source, fixture: latest.fixture, label: latest.label, observations: list.length,
      definition: def ? { label: def.label, unit: def.unit, definition: def.definition, availability: def.availability, sourceRef: def.sourceRef, latency: def.latency } : null,
      uncertainty: { missing: latest.value === null, availability: def?.availability || "unknown", latency: def?.latency || "necunoscută", stale: ageH > 48,
        unitMismatch: Boolean(def && latest.unit !== def.unit), note: def?.availability === "documented" ? "definiție documentată; valorile pot fi revizuite de platformă" : "definiție de verificat" },
    };
  }

  /** Latest value per (platform, attempt, metric). Real and fixture values in separate groups; no cross-platform totals. */
  function summary(contentProjectId) {
    if (!db.prepare("SELECT 1 FROM content_projects WHERE id = ?").get(contentProjectId)) throw new HubError("not_found", "Proiectul de conținut nu există");
    const groups = new Map();
    for (const r of projectMetricRows(contentProjectId)) {
      const gk = `${r.platform}|${r.releaseAttemptId || ""}`;
      if (!groups.has(gk)) groups.set(gk, { platform: r.platform, attemptId: r.releaseAttemptId, real: new Map(), fixture: new Map() });
      const bucket = r.fixture ? groups.get(gk).fixture : groups.get(gk).real;
      if (!bucket.has(r.metricKey)) bucket.set(r.metricKey, []);
      bucket.get(r.metricKey).push(r);
    }
    const items = [...groups.values()].map((g) => ({
      platform: g.platform, attemptId: g.attemptId,
      metrics: Object.fromEntries([...g.real].map(([k, list]) => [k, entryOf(list, g.platform, k)])),
      fixtureMetrics: Object.fromEntries([...g.fixture].map(([k, list]) => [k, entryOf(list, g.platform, k)])),
    }));
    return { contentProjectId, items, registryVersion: METRIC_REGISTRY.version,
      note: "Valorile lipsă rămân lipsă (nu zero). Totalurile între platforme nu se calculează: definițiile diferă. Datele de test sunt etichetate separat." };
  }

  /** Snapshot due times after the recorded publication time; RECORDED when a real observation exists in the window. */
  function snapshotPlan(attemptId) {
    const a = db.prepare("SELECT id, platform, status, external_json FROM content_release_attempts WHERE id = ?").get(attemptId);
    if (!a) throw new HubError("not_found", "Încercarea de publicare nu există");
    const postedAt = parse(a.external_json, {}).postedAt;
    if (a.status !== "PUBLISHED" || !postedAt) return { attemptId, targets: [], note: "Planul de măsurători începe după o publicare înregistrată." };
    const t0 = Date.parse(postedAt);
    const obs = db.prepare("SELECT observed_at FROM content_metrics WHERE release_attempt_id = ? AND source <> 'fixture'").all(attemptId).map((r) => Date.parse(r.observed_at));
    const nowMs = clock().getTime();
    const targets = SNAPSHOT_TARGETS.map(([key, hours], i) => {
      const due = t0 + hours * 3600000;
      const until = i + 1 < SNAPSHOT_TARGETS.length ? t0 + SNAPSHOT_TARGETS[i + 1][1] * 3600000 : due + 30 * 86400000;
      const recorded = obs.some((o) => o >= due && o < until);
      return { target: key, dueAt: new Date(due).toISOString(), status: recorded ? "RECORDED" : nowMs >= due ? "DUE" : "UPCOMING" };
    });
    return { attemptId, postedAt, targets, note: "Ținte orientative, nu garanții: platformele raportează cu întârziere." };
  }

  // ---------- experiments ----------
  const protocolOf = (e) => ({ title: e.title, variable: e.variable, arms: e.arms, audience: e.audience, primaryMetric: e.primaryMetric, window: e.window,
    analysisRule: e.analysisRule, design: e.design, simultaneousChanges: e.simultaneousChanges });
  const getExperiment = (id) => rowToExperiment(db.prepare("SELECT * FROM content_experiments WHERE id = ?").get(id));
  const needExperiment = (id) => { const e = getExperiment(id); if (!e) throw new HubError("not_found", "Experimentul nu există"); return e; };
  const verifyRegistration = (e) => Boolean(e.registeredSha256) && hashCanonical(protocolOf(e)) === e.registeredSha256;

  /** Pre-registration: the protocol (arms, metric, window, rule, design) is hashed and never edited afterwards. */
  function registerExperiment({ title, variable, arms, audience = "", primaryMetric, window = { target: "72h" }, analysisRule = {}, design = "observational", simultaneousChanges = [], actor = "owner" } = {}) {
    const t = normalizeRo(clip(title, 200));
    if (t.length < 3) throw bad("Titlul experimentului: minimum 3 caractere");
    const v = normalizeRo(clip(variable, 200));
    if (v.length < 2) throw bad("Variabila testată lipsește");
    if (!EXPERIMENT_DESIGNS.includes(design)) throw bad(`Design necunoscut: ${design}`);
    const platform = clean(primaryMetric?.platform); const key = clean(primaryMetric?.key);
    if (!metricDefinition(platform, key)) throw bad(`Metrica principală ${platform}:${key} nu e definită în registru`, "METRIC_UNKNOWN");
    if (!window || !TARGET_HOURS[window.target]) throw bad(`Fereastra trebuie să fie una dintre ${SNAPSHOT_TARGETS.map(([k]) => k).join(", ")}`);
    const minSamplePerArm = analysisRule.minSamplePerArm;
    if (!Number.isInteger(minSamplePerArm) || minSamplePerArm < 2 || minSamplePerArm > 100000) throw bad("Regula de analiză cere minSamplePerArm explicit (întreg ≥ 2)", "MIN_SAMPLE_REQUIRED");
    const alpha = analysisRule.alpha ?? 0.05;
    if (!(typeof alpha === "number" && alpha > 0 && alpha <= 0.2)) throw bad("alpha trebuie să fie între 0 și 0,2");
    if (!Array.isArray(arms) || arms.length < 2 || arms.length > 6) throw bad("Experimentul are între 2 și 6 brațe");
    const seenArm = new Set(); const seenAttempt = new Set();
    const normArms = arms.map((a, i) => {
      const id = clean(a?.id || `arm${i + 1}`);
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id) || seenArm.has(id)) throw bad(`Braț invalid sau duplicat: ${id}`);
      seenArm.add(id);
      const attemptIds = [...new Set((a.attemptIds || []).map(clean))].sort();
      for (const aid of attemptIds) {
        const row = db.prepare("SELECT platform FROM content_release_attempts WHERE id = ?").get(aid);
        if (!row) throw new HubError("not_found", `Încercarea ${aid} nu există`);
        if (row.platform !== platform) throw bad(`Încercarea ${aid} e pe ${row.platform}; experimentul măsoară ${platform}`, "PLATFORM_MISMATCH");
        if (seenAttempt.has(aid)) throw bad(`Încercarea ${aid} apare în două brațe`);
        seenAttempt.add(aid);
      }
      return { id, label: normalizeRo(clip(a.label || id, 80)), description: normalizeRo(clip(a.description, 300)), attemptIds };
    });
    const exp = { title: t, variable: v, arms: normArms, audience: normalizeRo(clip(audience, 200)), primaryMetric: `${platform}:${key}`, window: { target: window.target },
      analysisRule: { minSamplePerArm, alpha, test: "welch_t", comparison: "fiecare braț față de primul (control)" }, design,
      simultaneousChanges: (Array.isArray(simultaneousChanges) ? simultaneousChanges : []).slice(0, 20).map((s) => normalizeRo(clip(s, 200))).filter(Boolean) };
    const sha = hashCanonical(protocolOf(exp));
    return bus.transaction(() => {
      const id = newId("cex");
      const at = now();
      db.prepare(`INSERT INTO content_experiments (id, title, variable, arms_json, audience, primary_metric, window_json, analysis_rule_json, design, simultaneous_changes_json, status, registered_sha256, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?, ?)`).run(id, exp.title, exp.variable, json(exp.arms), exp.audience, exp.primaryMetric, json(exp.window),
        json(exp.analysisRule), exp.design, json(exp.simultaneousChanges), sha, actor, at, at);
      emit("content.experiment.registered", id, { sha256: sha, design, primaryMetric: exp.primaryMetric, arms: normArms.length }, actor);
      return getExperiment(id);
    });
  }

  function valueAtWindow(attemptId, metricKey, hours, includeFixtures) {
    const a = db.prepare("SELECT status, external_json FROM content_release_attempts WHERE id = ?").get(attemptId);
    if (!a || a.status !== "PUBLISHED") return { missing: "încercarea nu e publicată" };
    const postedAt = parse(a.external_json, {}).postedAt;
    if (!postedAt) return { missing: "momentul publicării lipsește" };
    const from = new Date(Date.parse(postedAt) + hours * 3600000).toISOString();
    const rows = db.prepare(`SELECT * FROM content_metrics WHERE release_attempt_id = ? AND metric_key = ? AND observed_at >= ? ${includeFixtures ? "" : "AND source <> 'fixture'"} ORDER BY observed_at, created_at LIMIT 1`).all(attemptId, metricKey, from);
    const r = rows[0];
    if (!r) return { missing: `nicio observație după fereastra de ${hours} h` };
    if (r.value === null) return { missing: r.unavailable_reason || "valoare indisponibilă" };
    return { value: r.value, fixture: r.source === "fixture", observedAt: r.observed_at };
  }

  /** INCONCLUSIVE below minSamplePerArm or with any missing data; otherwise CLOSED with a Welch test per arm vs control. */
  function analyzeExperiment(id, { actor = "owner", includeFixtures = false } = {}) {
    const e = needExperiment(id);
    if (!verifyRegistration(e)) throw conflict("Protocolul experimentului nu mai corespunde pre-înregistrării (hash diferit): analiza e refuzată", "EXPERIMENT_TAMPERED");
    if (e.status === "CLOSED") return e;
    if (e.status === "DRAFT") throw conflict("Experimentul nu e pre-înregistrat");
    const [platform, key] = e.primaryMetric.split(":");
    const hours = TARGET_HOURS[e.window.target];
    const { minSamplePerArm, alpha } = e.analysisRule;
    const reasons = [];
    let anyFixture = false;
    const arms = e.arms.map((arm) => {
      const values = []; const missing = [];
      for (const aid of arm.attemptIds) {
        const r = valueAtWindow(aid, key, hours, includeFixtures);
        if (r.missing) missing.push({ attemptId: aid, reason: r.missing });
        else { values.push(r.value); anyFixture ||= r.fixture; }
      }
      if (values.length < minSamplePerArm) reasons.push(`Brațul ${arm.label} are n=${values.length} (minim pre-înregistrat ${minSamplePerArm})`);
      if (missing.length) reasons.push(`Brațul ${arm.label}: ${missing.length} ${missing.length === 1 ? "valoare lipsă" : "valori lipsă"} (lipsa nu se tratează ca zero)`);
      return { id: arm.id, label: arm.label, n: values.length, missing, mean: values.length ? mean(values) : null, sd: values.length > 1 ? Math.sqrt(variance(values)) : null, values };
    });
    const interpretation = e.design === "observational"
      ? "Design observațional: rezultatul arată cel mult o asociere, nu o cauză."
      : "Test randomizat nativ al platformei: o diferență poate fi atribuită variabilei, în limitele eșantionului.";
    const base = { analyzedAt: now(), platform, metric: key, definition: metricDefinition(platform, key)?.definition || null, window: e.window.target, interpretation,
      confounders: e.simultaneousChanges, fixture: anyFixture, label: anyFixture ? FIXTURE_LABEL : null, arms: arms.map(({ values, ...a }) => a) };
    let status; let result;
    if (reasons.length) {
      status = "INCONCLUSIVE";
      result = { ...base, decision: "INCONCLUSIVE", reasons };
    } else {
      const control = arms[0];
      const k = arms.length - 1;
      const comparisons = arms.slice(1).map((arm) => {
        const w = welch(control.values, arm.values);
        const adjustedAlpha = alpha / k;
        return { arm: arm.id, vs: control.id, diff: w.diff, relative: control.mean ? w.diff / control.mean : null, t: w.t, df: w.df, p: w.p, alpha: adjustedAlpha,
          significant: w.p !== null && w.p < adjustedAlpha, note: w.note || null };
      });
      status = "CLOSED";
      result = { ...base, decision: comparisons.some((c) => c.significant) ? "DIFFERENCE_DETECTED" : "NO_DIFFERENCE_DETECTED", comparisons,
        method: `Welch t, bilateral, alpha ${alpha}${k > 1 ? ` (Bonferroni pe ${k} comparații)` : ""}` };
    }
    return bus.transaction(() => {
      db.prepare("UPDATE content_experiments SET status = ?, result_json = ?, updated_at = ? WHERE id = ? AND registered_sha256 = ?").run(status, json(result), now(), id, e.registeredSha256);
      emit("content.experiment.analyzed", id, { status, decision: result.decision, fixture: anyFixture }, actor);
      return getExperiment(id);
    });
  }

  // ---------- insights ----------
  function normalizeRefs(list) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 50) throw bad("Referințele de date trebuie să fie o listă (maximum 50)");
    return list.map((r, i) => {
      const kind = clean(r?.kind); const ref = clean(r?.ref);
      if (!["metric", "attempt", "experiment", "import", "funnel"].includes(kind) || !ref) throw bad(`Referința ${i + 1} e invalidă (tip: metric, attempt, experiment, import, funnel)`);
      return { kind, ref: clip(ref, 120) };
    });
  }
  const hasNumber = (text) => /\d/.test(String(text || ""));
  function numberRule({ hypothesis, sample, units, result }) {
    const needs = hasNumber(hypothesis) || (result && result.value !== undefined && result.value !== null);
    if (!needs) return;
    const baseOk = Number.isInteger(sample?.base) && sample.base > 0;
    const def = result?.metric ? (() => { const [p, k] = String(result.metric).split(":"); return metricDefinition(p, k); })() : null;
    const definitionOk = clean(units).length > 0 && (Boolean(def) || clean(result?.definition).length > 0);
    if (!baseOk || !definitionOk) throw bad("Un număr are nevoie de bază (n, eșantion) și de definiție (unitate + metrica sau definiția ei)", "NUMBER_NEEDS_BASE");
  }

  function proposeInsight({ hypothesis, cohort = {}, sample = {}, units = "", dataRefs = [], confounders = [], result = {}, experimentId = null, actor = "owner" } = {}) {
    const h = normalizeRo(clip(hypothesis, 500));
    if (h.length < 10) throw bad("Ipoteza: minimum 10 caractere");
    numberRule({ hypothesis: h, sample, units, result });
    if (experimentId) needExperiment(experimentId);
    return bus.transaction(() => {
      const id = newId("cin");
      const at = now();
      db.prepare(`INSERT INTO content_insights (id, hypothesis, cohort_json, sample_json, units, data_refs_json, confounders_json, result_json, status, experiment_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HYPOTHESIS', ?, ?, ?, ?)`).run(id, h, json(cohort || {}), json(sample || {}), clip(units, 60), json(normalizeRefs(dataRefs)),
        json((Array.isArray(confounders) ? confounders : []).slice(0, 20).map((c) => normalizeRo(clip(c, 200)))), json(result || {}), experimentId, actor, at, at);
      emit("content.insight.proposed", id, { experimentId }, actor);
      return rowToInsight(db.prepare("SELECT * FROM content_insights WHERE id = ?").get(id));
    });
  }

  function setInsightStatus(id, status, { experimentId = null, actor = "owner", reason = "" } = {}) {
    const ins = rowToInsight(db.prepare("SELECT * FROM content_insights WHERE id = ?").get(id));
    if (!ins) throw new HubError("not_found", "Concluzia nu există");
    if (!INSIGHT_STATUSES.includes(status)) throw bad(`Stare necunoscută: ${status}`);
    if (ins.status === status) return ins;
    if (ins.status === "RETIRED") throw conflict("Concluzia e retrasă (RETIRED) și nu se mai modifică");
    let expId = experimentId || ins.experimentId;
    if (status === "OBSERVED_ASSOCIATION") {
      if (!ins.dataRefs.length) throw conflict("O asociere observată are nevoie de referințe la date măsurate", "INSIGHT_NEEDS_DATA");
      if (!(Number.isInteger(ins.sample?.base) && ins.sample.base > 0)) throw conflict("O asociere observată are nevoie de bază (n)", "NUMBER_NEEDS_BASE");
    }
    if (status === "EXPERIMENT_SUPPORTED") {
      if (!expId) throw conflict("EXPERIMENT_SUPPORTED cere un experiment închis (CLOSED)", "INSIGHT_NEEDS_EXPERIMENT");
      const e = needExperiment(expId);
      if (e.status !== "CLOSED") throw conflict(`Experimentul are starea ${e.status}; EXPERIMENT_SUPPORTED cere CLOSED`, "INSIGHT_NEEDS_EXPERIMENT");
      if (!verifyRegistration(e)) throw conflict("Protocolul experimentului nu corespunde pre-înregistrării", "EXPERIMENT_TAMPERED");
      if (e.design !== "randomized_native") throw conflict("Un experiment observațional susține cel mult o asociere (OBSERVED_ASSOCIATION)", "OBSERVATIONAL_ONLY");
      if (e.result.fixture) throw conflict("Experimentul a folosit date de test (fixture): nu susține o concluzie reală", "FIXTURE_DATA");
      if (e.result.decision !== "DIFFERENCE_DETECTED") throw conflict("Experimentul nu a detectat o diferență: concluzia nu e susținută", "NO_EFFECT");
    } else if (status !== "INCONCLUSIVE" && status !== "RETIRED") expId = ins.experimentId;
    return bus.transaction(() => {
      db.prepare("UPDATE content_insights SET status = ?, experiment_id = ?, updated_at = ? WHERE id = ?").run(status, expId, now(), id);
      emit("content.insight.status", id, { from: ins.status, to: status, experimentId: expId, reason: clip(reason, 300) }, actor);
      return rowToInsight(db.prepare("SELECT * FROM content_insights WHERE id = ?").get(id));
    });
  }

  // ---------- scene diagnostics (hypotheses only) ----------
  function sceneDiagnostics({ attemptId, editVersionId = null } = {}) {
    const a = db.prepare("SELECT a.id, a.platform, a.manifest_id, a.variant_id, m.body_json FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id WHERE a.id = ?").get(attemptId);
    if (!a) throw new HubError("not_found", "Încercarea de publicare nu există");
    const evId = editVersionId || parse(a.body_json, {}).variants?.find((v) => v.platform === a.platform)?.editVersionId || null;
    const ev = evId ? db.prepare("SELECT ir_json FROM media_edit_versions WHERE id = ?").get(evId) : null;
    const disclaimer = "Ipoteze, nu concluzii: fără date de retenție pe secundă nu se poate atribui abandonul unei scene. Verifică printr-un experiment pre-înregistrat.";
    if (!ev) return { attemptId, editVersionId: evId, kind: "hypotheses", status: "HYPOTHESIS", items: [], reason: "Versiunea de montaj nu e disponibilă", disclaimer };
    const ir = parse(ev.ir_json, {});
    const fps = ir.fps?.num && ir.fps?.den ? ir.fps.num / ir.fps.den : 30;
    const primary = (ir.tracks || []).find((t) => t.kind === "video");
    const clips = (primary?.clips || []).map((c) => {
      const durFrames = (Number(c.sourceOut) - Number(c.sourceIn)) / (Number(c.speed) || 1);
      return { id: c.id, shotId: c.shotId || null, label: c.label || null, fromMs: Math.round((Number(c.start) / fps) * 1000), toMs: Math.round(((Number(c.start) + durFrames) / fps) * 1000) };
    });
    const durationKey = a.platform === "youtube" ? "averageViewDuration" : a.platform === "tiktok" ? "averageWatchTimeSeconds" : null;
    const metric = durationKey ? db.prepare("SELECT * FROM content_metrics WHERE release_attempt_id = ? AND metric_key = ? ORDER BY CASE source WHEN 'fixture' THEN 1 ELSE 0 END, observed_at DESC LIMIT 1").get(attemptId, durationKey) : null;
    if (!metric || metric.value === null) {
      return { attemptId, editVersionId: evId, kind: "hypotheses", status: "HYPOTHESIS", items: [], clips,
        reason: durationKey ? "Nu există o durată medie de vizionare măsurată pentru această publicare" : `Registrul nu are o metrică de durată pentru ${a.platform}`, disclaimer };
    }
    const atMs = Math.round(metric.value * 1000);
    const at = clips.find((c) => atMs >= c.fromMs && atMs < c.toMs) || null;
    const items = [];
    if (at) {
      items.push({ status: "HYPOTHESIS", confidence: "scăzută", clipId: at.id, shotId: at.shotId, atMs,
        text: `Durata medie de vizionare (~${(metric.value).toFixed(1).replace(".", ",")} s) cade în cadrul ${at.id}${at.shotId ? ` (${at.shotId})` : ""}, între ${(at.fromMs / 1000).toFixed(1).replace(".", ",")} s și ${(at.toMs / 1000).toFixed(1).replace(".", ",")} s. Ipoteză: începutul acestui cadru poate pierde atenția.` });
      if (clips[0] && at.id === clips[0].id) items.push({ status: "HYPOTHESIS", confidence: "scăzută", clipId: at.id, atMs, text: "Media se oprește în primul cadru. Ipoteză: deschiderea (hook-ul) nu reține; de testat cu o variantă de hook." });
    } else if (clips.length && atMs >= clips[clips.length - 1].toMs) {
      items.push({ status: "HYPOTHESIS", confidence: "scăzută", atMs, text: "Durata medie depășește lungimea montajului (vizionări repetate sau definiție diferită). Nicio scenă nu poate fi indicată." });
    }
    return { attemptId, editVersionId: evId, kind: "hypotheses", status: "HYPOTHESIS", items, clips,
      basis: { metric: durationKey, value: metric.value, unit: metric.unit, observedAt: metric.observed_at, source: metric.source, label: metric.source === "fixture" ? FIXTURE_LABEL : null }, disclaimer };
  }

  return {
    METRIC_REGISTRY, importManual, recordFixture, snapshots, summary, snapshotPlan,
    registerExperiment, analyzeExperiment, getExperiment: needExperiment, verifyExperiment: (id) => verifyRegistration(needExperiment(id)),
    listExperiments: () => db.prepare("SELECT * FROM content_experiments ORDER BY created_at DESC LIMIT 200").all().map(rowToExperiment),
    proposeInsight, setInsightStatus, getInsight: (id) => { const r = rowToInsight(db.prepare("SELECT * FROM content_insights WHERE id = ?").get(id)); if (!r) throw new HubError("not_found", "Concluzia nu există"); return r; },
    listInsights: ({ status = null } = {}) => (status ? db.prepare("SELECT * FROM content_insights WHERE status = ? ORDER BY created_at DESC").all(status) : db.prepare("SELECT * FROM content_insights ORDER BY created_at DESC LIMIT 200").all()).map(rowToInsight),
    sceneDiagnostics,
  };
}
