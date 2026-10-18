import fs from "node:fs";
import path from "node:path";

/**
 * R-SUP (closure of the M11 corrections) — the explicit contract behind retiring an earlier Hub-written test.
 *
 * planners/criteria.mjs conflictingHubTests() only PROPOSES candidates (a test/hub file whose assert reads the field from a GET answer).
 * A candidate is retired only with a contract built here from the test's own cases and the earlier mission's spec, and checked again by
 * the factory on the server right before the move (factory.mjs verifySupersedes):
 *   - a case CONFLICTS only when it reads the field from an anonymous GET on a route the project's public page itself reads (the public
 *     client in public/ — what any visitor's browser receives); a GET with credentials, on a route the public page never reads, or whose
 *     route the Hub cannot read from the test, is not proof of a conflict (an internal authorized read stays compatible);
 *   - every OTHER case of the file keeps its coverage: it is classified (the required value refused, a valid request accepted) and must
 *     name the new criterion of the same kind that covers it, else the file is not retired (the old test stays active, said on the card);
 *   - each case maps to the earlier spec's criterion of the same id (AC-n) bound to that test file.
 * Pure functions over texts, plus readPublicClient (read-only). No model, nothing executed.
 */

const VAR = String.raw`[A-Za-z_$][\w$]*`;
const CASE_RE = /\btest\s*\(\s*(["'`])(AC-\d{1,3})\b([^"'`]*)\1/g;
const CLIENT_FILE_RE = /\.(?:m?js|html?)$/i;
const CLIENT_MAX_FILES = 50;
const CLIENT_MAX_BYTES = 256 * 1024;
const ROUTE_RE = /^\/[A-Za-z0-9_\-/.]*$/;
const WRITE_METHOD_RE = /\bmethod\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`]/i;
const CREDENTIAL_RE = /\b(?:headers\s*:|authorization|cookie|credentials\s*:|x-[a-z-]*(?:token|key|auth)\b|bearer\b)/i;
/** The new criteria kinds a hide_public request derives (planners/criteria.mjs deriveCriteria → `kind`). */
export const HIDE_PUBLIC_KINDS = Object.freeze(["public_omits", "anon_params", "required_refusal", "internal_persistence", "valid_accepted"]);
/** What replaces a conflicting read: the new contract splits „kept and readable” into kept internally + not exposed publicly. */
const REPLACES_CONFLICT = Object.freeze(["public_omits", "anon_params", "internal_persistence"]);

/** The pathname of the first URL path in a call's arguments: "/api/x" from `${base}/api/x?d=1`, "http://h:1/api/x", "/api/x". */
function routeOfArgs(args) {
  const m = /(?:\$\{[^}]*\}|https?:\/\/[^/"'`\s]*|["'`])(\/[A-Za-z0-9_\-/.]*)/.exec(String(args || ""));
  const route = m ? m[1].replace(/\/+$/, "") || "/" : null;
  return route && ROUTE_RE.test(route) ? route : null;
}

/** The top-level arguments of a call's argument text (commas inside (), {}, [], strings and template literals are not separators). */
function topLevelArgs(args) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  const s = String(args || "");
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === "\\") { cur += s[i + 1] || ""; i += 1; } else if (ch === quote) quote = null; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The body of a helper the test file defines (function NAME(…) { … } or const NAME = …), up to the next top-level declaration. */
function helperBody(src, name) {
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const m = new RegExp(String.raw`(?:^|\n)\s*(?:async\s+)?function\s+${name.replace(/\$/g, "\\$")}\s*\(|(?:^|\n)\s*(?:const|let|var)\s+${name.replace(/\$/g, "\\$")}\s*=`).exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + 1);
  const end = rest.search(/\n(?:async\s+)?function\s|\n(?:const|let|var)\s|\ntest\s*\(/);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The GET reads the project's public page makes: pathnames of string / template literals passed to a call (fetch(…), api(…), get(…))
 * without a write method, in the public client files. A static asset (a path with a file extension) is not a data route. → sorted [route]
 */
export function publicReadRoutes(files = []) {
  const out = new Set();
  for (const { text } of Array.isArray(files) ? files : []) {
    const src = String(text || "");
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$.]*)\s*\(\s*(["'`])(\/[A-Za-z0-9_\-/.]*)/g)) {
      const route = m[3].replace(/\/+$/, "");
      if (!route || /\.[a-z0-9]{1,5}$/i.test(route) || !ROUTE_RE.test(route)) continue;
      const tail = src.slice(m.index, m.index + 400).split(/;\s*\n|\)\s*;/)[0];
      if (WRITE_METHOD_RE.test(tail)) continue;
      out.add(route);
    }
  }
  return [...out].sort();
}

/** The project's public client (public/**: .js, .mjs, .html; at most 50 files of ≤ 256 KiB; links never followed). Read-only. */
export function readPublicClient(projectPath) {
  const root = path.join(String(projectPath || ""), "public");
  const files = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= CLIENT_MAX_FILES) return;
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(abs, `${rel}${e.name}/`); continue; }
      if (!e.isFile() || !CLIENT_FILE_RE.test(e.name)) continue;
      try { const st = fs.lstatSync(abs); if (st.size <= CLIENT_MAX_BYTES) files.push({ rel: `public/${rel}${e.name}`, text: fs.readFileSync(abs, "utf8") }); } catch { /* unreadable: not read */ }
    }
  };
  walk(root, "");
  return files;
}

/**
 * The cases of a Hub-written test (test("AC-n …", …)) and what each one does with `key`:
 *   public_read      an assert reads `.key` / ["key"] from a variable bound to an anonymous GET on a route in `publicRoutes`;
 *   unproven_read    the same read on a GET whose route cannot be read from the test (a variable URL) — not proof either way;
 *   required_refusal the case checks the refusal of a missing value (errors.<key> / errors["key"]);
 *   valid_accepted   the case checks a creation answered 201;
 *   other            anything else.
 * A read on a GET with credentials or on a route the public page never reads is recorded in `internalReads` and is compatible.
 * → [{ id, name, kind, routes: [route], internalReads: [route] }]
 */
export function analyzeHubTestCases(text, key, publicRoutes = []) {
  const src = String(text || "");
  if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(String(key || ""))) return [];
  const pub = new Set(publicRoutes);
  const starts = [...src.matchAll(CASE_RE)].map((m) => ({ at: m.index, id: m[2], name: `${m[2]}${m[3]}`.trim().slice(0, 160) }));
  return starts.map((c, i) => {
    const body = src.slice(c.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
    const gets = new Map();
    for (const m of body.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(?:\{[^}]*\}|(${VAR}))\s*=\s*await\s+(${VAR}(?:\.${VAR})*)\(([^;]*?)\)\s*;`, "g"))) {
      const callee = m[2], args = m[3] || "";
      const isGet = /httpGet|(?:^|\.)get$/i.test(callee) || (/fetch|request/i.test(callee) && !WRITE_METHOD_RE.test(args) && !/["'`](?:POST|PUT|PATCH|DELETE)["'`]/i.test(args) && (/fetch/i.test(callee) || /["'`]GET["'`]/i.test(args)));
      if (!isGet) continue;
      // Review (closure) #2: anonymous only when it is PROVEN: no credentials in the call, no options passed through a variable (its
      // headers are not visible here), and the file's own helper of that name adds none. Otherwise the read is not proof of a conflict.
      const extra = topLevelArgs(args).slice(1);
      const hiddenOptions = extra.some((a) => !/^\s*\{[\s\S]*\}\s*$/.test(a) && !/^\s*["'`][^"'`]*["'`]\s*$/.test(a));
      const helper = helperBody(src, callee.split(".").pop());
      const anonymous = !CREDENTIAL_RE.test(args) && !(helper && CREDENTIAL_RE.test(helper)) ? (hiddenOptions ? null : true) : false;
      const read = { route: routeOfArgs(args), anonymous };
      if (m[1]) gets.set(m[1], read);
      else for (const d of m[0].match(/\{([^}]*)\}/)[1].split(",")) { const n = d.split(":").pop().trim(); if (new RegExp(`^${VAR}$`).test(n)) gets.set(n, read); }
    }
    const statements = body.split(";").map((st) => st.replace(/\berrors?\??\.\w+/g, " ").replace(/\berrors?\s*\[[^\]]*\]/g, " "));
    const routes = new Set(), internalReads = new Set();
    let unproven = false;
    for (const [name, read] of gets) {
      const re = new RegExp(String.raw`\b${name.replace(/\$/g, "\\$")}\b[\w$.?\[\]"'\x60\s]*?(?:\.${key}\b|\[["'\x60]${key}["'\x60]\])`);
      if (!statements.some((st) => /\bassert\b/.test(st) && re.test(st))) continue;
      if (!read.route || read.anonymous === null) unproven = true;
      else if (read.anonymous && pub.has(read.route)) routes.add(read.route);
      else internalReads.add(read.route);
    }
    const refusal = new RegExp(String.raw`\berrors?\??\.${key}\b|\berrors?\s*\[\s*["'\x60]${key}["'\x60]\s*\]`).test(body);
    const accepted = /\.status\s*,\s*201\b|\b201\s*,\s*[\w$.]*status\b|status\s*===?\s*201\b/.test(body);
    const kind = routes.size ? "public_read" : unproven ? "unproven_read" : refusal ? "required_refusal" : accepted ? "valid_accepted" : "other";
    return { id: c.id, name: c.name, kind, routes: [...routes].sort(), internalReads: [...internalReads].sort() };
  });
}

/**
 * The explicit contract difference that allows retiring one candidate (R-SUP-02):
 *   `candidate`   { testRef, sha256, missionId, specVersion } (conflictingHubTests + the protected-sha owner);
 *   `text`        the test's exact text; `key` the field; `publicRoutes` publicReadRoutes(readPublicClient(project));
 *   `previous`    the earlier mission's approved spec ({ acceptance }) — its criteria bound to `testRef`;
 *   `next`        [{ id, kind }] the new spec's test criteria with their kinds (HIDE_PUBLIC_KINDS).
 * → { ok: true, contract } | { ok: false, problem } (a reason in Romanian, shown on the card; the test then stays active).
 * contract = { field, previous: { missionId, specVersion }, publicRoutes, conflicts: [{ case, criterion, routes, replacedBy }],
 *   kept: [{ case, kind, criterion, coveredBy }], internalReads: [route] } — hashed with the spec, checked again before the move.
 */
export function retirementContract({ candidate, text, key, publicRoutes = [], previous = null, next = [] } = {}) {
  const no = (problem) => ({ ok: false, problem });
  if (!candidate?.missionId || !Number.isInteger(candidate?.specVersion)) return no("Hub-ul nu găsește misiunea și versiunea care au protejat exact acești octeți (proveniență lipsă)");
  if (!previous || !Array.isArray(previous.acceptance)) return no("specificația misiunii originale lipsește");
  if (!publicRoutes.length) return no("Hub-ul nu găsește rutele citite de pagina publică a proiectului (public/), deci nu poate dovedi că testul citește lista publică");
  const cases = analyzeHubTestCases(text, key, publicRoutes);
  if (!cases.length) return no("testul nu are cazuri AC-n recunoscute");
  const byKind = (k) => next.filter((c) => c.kind === k).map((c) => c.id);
  const oldCriterion = (id) => previous.acceptance.find((a) => a.id === id && a.verify === "test" && a.testRef === candidate.testRef) || null;
  const conflicts = [], kept = [];
  const internalReads = new Set();
  for (const c of cases) {
    c.internalReads.forEach((r) => internalReads.add(r));
    const criterion = oldCriterion(c.id);
    if (!criterion) return no(`cazul ${c.id} nu corespunde unui criteriu al specificației v${candidate.specVersion} legat de acest test`);
    if (c.kind === "unproven_read") return no(`cazul ${c.id} citește câmpul dintr-un GET a cărui rută nu se vede în test (nu se poate dovedi că e lista publică)`);
    if (c.kind === "public_read") {
      const replacedBy = REPLACES_CONFLICT.flatMap(byKind);
      if (REPLACES_CONFLICT.some((k) => !byKind(k).length)) return no(`cazul ${c.id} nu are toate verificările care îl înlocuiesc (omiterea publică, parametrii anonimi, păstrarea internă)`);
      conflicts.push({ case: c.id, criterion: String(criterion.text).slice(0, 300), routes: c.routes, replacedBy });
      continue;
    }
    const coveredBy = HIDE_PUBLIC_KINDS.includes(c.kind) ? byKind(c.kind) : [];
    if (!coveredBy.length) return no(`cazul ${c.id} (${c.kind === "other" ? "alt comportament" : c.kind}) nu are în cererea nouă o verificare care să-l acopere; testul rămâne activ`);
    kept.push({ case: c.id, kind: c.kind, criterion: String(criterion.text).slice(0, 300), coveredBy });
  }
  if (!conflicts.length) return no("niciun caz nu citește câmpul din lista publică (o citire internă sau autorizată rămâne compatibilă)");
  return { ok: true, contract: { field: key, previous: { missionId: candidate.missionId, specVersion: candidate.specVersion }, publicRoutes: [...publicRoutes],
    conflicts, kept, internalReads: [...internalReads].sort() } };
}

/**
 * The factory's re-check right before the move (R-SUP-01): the same cases, kinds and routes from today's bytes and today's public client
 * as the confirmed contract says. → null when they agree, else the first difference (Romanian).
 */
export function contractDrift(contract, text, publicRoutes) {
  const cases = analyzeHubTestCases(text, contract?.field, publicRoutes);
  const of = (id) => cases.find((c) => c.id === id);
  for (const c of contract?.conflicts || []) {
    const now = of(c.case);
    if (!now || now.kind !== "public_read" || JSON.stringify(now.routes) !== JSON.stringify(c.routes)) return `cazul ${c.case} nu mai citește lista publică ${c.routes.join(", ")} cum spune planul`;
  }
  for (const k of contract?.kept || []) {
    const now = of(k.case);
    if (!now || now.kind !== k.kind) return `cazul ${k.case} nu mai e „${k.kind}” cum spune planul`;
  }
  const named = new Set([...(contract?.conflicts || []).map((c) => c.case), ...(contract?.kept || []).map((k) => k.case)]);
  const extra = cases.find((c) => !named.has(c.id));
  if (extra) return `cazul ${extra.id} nu apare în planul confirmat`;
  if (JSON.stringify([...(contract?.publicRoutes || [])].sort()) !== JSON.stringify([...publicRoutes].sort())) return "rutele citite de pagina publică s-au schimbat după confirmare";
  return null;
}
