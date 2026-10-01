// Milestone 04 §2.3 — research sources: the source registry (cache, dedup, rate limit, size / type / time limits), the fixture
// site adapter, the always-refused live adapter and the collector URL policy. Adapters and DNS are injected: no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSourceRegistry, fixtureSiteAdapter, liveHttpAdapter, validateCollectorUrl, MAX_BODY_BYTES, LIVE_COLLECTION_DISABLED, DEFAULT_FIXTURE_SITES_DIR } from "../server/sales/research.mjs";
import { auditHtml } from "../server/sales/audit.mjs";
import { tempDir } from "./helpers.mjs";

const T0 = Date.parse("2026-10-01T10:00:00.000Z");
const makeClock = () => { const state = { now: T0 }; return { state, clock: () => new Date(state.now) }; };
const HTML = "text/html; charset=utf-8";

/** An injected adapter that records its calls; `respond(target, signal)` decides the response. */
function fakeAdapter({ id = "fake", version = "1", kind = "fixture", respond = (t) => ({ status: 200, contentType: HTML, body: `<title>${t}</title>`, url: `https://${t}/` }) } = {}) {
  const calls = [];
  return { calls, adapter: { id, version, kind, async fetch(target, options) { calls.push(target); return respond(target, options?.signal); } } };
}
const isHubError = (category, code) => (error) => error?.name === "HubError" && error.category === category && (!code || error.code === code);

test("M04-RES-01 registry: cache keyed by adapter@version|target, cached flag, TTL from the injected clock", async () => {
  const { state, clock } = makeClock();
  const cache = new Map();
  const fake = fakeAdapter();
  const registry = createSourceRegistry({ adapters: [fake.adapter], clock, cache });
  const first = await registry.fetch("fake", "alfa.test");
  assert.deepEqual({ ...first, body: undefined }, { adapterId: "fake", adapterVersion: "1", sourceKind: "fixture", target: "alfa.test", finalUrl: "https://alfa.test/",
    contentType: HTML, body: undefined, bytes: Buffer.byteLength("<title>alfa.test</title>"), fetchedAt: "2026-10-01T10:00:00.000Z", cached: false });
  assert.equal(first.body, "<title>alfa.test</title>");
  assert.deepEqual([...cache.keys()], ["fake@1|alfa.test"]);
  state.now += 60_000;
  const second = await registry.fetch("fake", "  alfa.test ");
  assert.equal(second.cached, true);
  assert.equal(second.fetchedAt, "2026-10-01T10:00:00.000Z"); // the cached read keeps its original time
  assert.equal(fake.calls.length, 1);
  // A new adapter version is a different cache key (shared Map): the source is read again.
  const v2 = fakeAdapter({ version: "2" });
  const registry2 = createSourceRegistry({ adapters: { fake: v2.adapter }, clock, cache });
  assert.equal((await registry2.fetch("fake", "alfa.test")).cached, false);
  assert.equal(v2.calls.length, 1);
  assert.ok(cache.has("fake@2|alfa.test"));
  // After the TTL the entry is stale.
  state.now += 7 * 60 * 60 * 1000;
  assert.equal((await registry.fetch("fake", "alfa.test")).cached, false);
  assert.equal(fake.calls.length, 2);
  // A bounded cache evicts the oldest entries.
  const small = new Map();
  const bounded = createSourceRegistry({ adapters: [fakeAdapter().adapter], clock, cache: small, maxCacheEntries: 2 });
  for (const host of ["a.test", "b.test", "c.test"]) await bounded.fetch("fake", host);
  assert.deepEqual([...small.keys()], ["fake@1|b.test", "fake@1|c.test"]);
});

test("M04-RES-02 registry: simultaneous requests for the same target share one read", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fake = fakeAdapter({ respond: async (t) => { await gate; return { contentType: HTML, body: `<p>${t}</p>` }; } });
  const registry = createSourceRegistry({ adapters: [fake.adapter], clock: makeClock().clock });
  const pending = [registry.fetch("fake", "beta.test"), registry.fetch("fake", "beta.test"), registry.fetch("fake", "beta.test"), registry.fetch("fake", "gamma.test")];
  release();
  const results = await Promise.all(pending);
  assert.deepEqual(fake.calls, ["beta.test", "gamma.test"]);
  assert.ok(results.slice(0, 3).every((r) => r.body === "<p>beta.test</p>"));
  assert.equal((await registry.fetch("fake", "beta.test")).cached, true);
});

test("M04-RES-03 registry: per-source rate limit per minute; cache hits do not count; the window slides with the clock", async () => {
  const { state, clock } = makeClock();
  const fake = fakeAdapter();
  const other = fakeAdapter({ id: "other" });
  const registry = createSourceRegistry({ adapters: [fake.adapter, other.adapter], clock, rateLimitPerMinute: 2 });
  await registry.fetch("fake", "a.test");
  state.now += 10_000;
  await registry.fetch("fake", "b.test");
  await assert.rejects(registry.fetch("fake", "c.test"), isHubError("quota", "RATE_LIMITED"));
  assert.equal((await registry.fetch("fake", "a.test")).cached, true); // cached: allowed, no slot used
  assert.equal((await registry.fetch("other", "c.test")).cached, false); // limits are per source
  state.now += 50_001; // the first read left the 60 s window
  assert.equal((await registry.fetch("fake", "c.test")).target, "c.test");
  await assert.rejects(registry.fetch("fake", "d.test"), isHubError("quota"));
  assert.deepEqual(fake.calls, ["a.test", "b.test", "c.test"]);
});

test("M04-RES-04 registry: 2 MB body cap (declared or real), text/html only, charset honoured", async () => {
  const respondWith = (response) => createSourceRegistry({ adapters: [fakeAdapter({ respond: () => response }).adapter], clock: makeClock().clock });
  await assert.rejects(respondWith({ contentType: HTML, body: Buffer.alloc(MAX_BODY_BYTES + 1, 0x61) }).fetch("fake", "mare.test"), isHubError("validation", "BODY_TOO_LARGE"));
  let touched = false;
  const lazy = { contentType: HTML, contentLength: MAX_BODY_BYTES + 1, get body() { touched = true; return "<p>x</p>"; } };
  await assert.rejects(respondWith(lazy).fetch("fake", "declarat.test"), isHubError("validation", "BODY_TOO_LARGE"));
  assert.equal(touched, false, "a declared oversize body is refused before it is read");
  const exact = await respondWith({ contentType: HTML, body: Buffer.alloc(MAX_BODY_BYTES, 0x61) }).fetch("fake", "exact.test");
  assert.equal(exact.bytes, MAX_BODY_BYTES);
  assert.equal(MAX_BODY_BYTES, 2 * 1024 * 1024);
  for (const contentType of ["application/json", "text/plain; charset=utf-8", "", undefined, "application/xhtml+xml", "text/html-sandboxed"]) {
    await assert.rejects(respondWith({ contentType, body: "<p>x</p>" }).fetch("fake", "tip.test"), isHubError("validation", "UNSUPPORTED_CONTENT_TYPE"), String(contentType));
  }
  const cp1250 = Buffer.concat([Buffer.from("<p>"), Buffer.from([0xba, 0xfe, 0xe3]), Buffer.from("</p>")]); // ş ţ ă in windows-1250
  assert.equal((await respondWith({ contentType: "TEXT/HTML; Charset=windows-1250", body: cp1250 }).fetch("fake", "cp.test")).body, "<p>şţă</p>");
  assert.equal((await respondWith({ contentType: "text/html; charset=nu-exista", body: Buffer.from("<p>ă</p>") }).fetch("fake", "x.test")).body, "<p>ă</p>");
  await assert.rejects(respondWith({ contentType: HTML, body: 42 }).fetch("fake", "gol.test"), isHubError("transport", "SOURCE_EMPTY_BODY"));
  await assert.rejects(respondWith(null).fetch("fake", "nul.test"), isHubError("transport"));
});

test("M04-RES-05 registry: timeout aborts the adapter; HTTP errors and failures are not cached", async () => {
  let seenSignal = null;
  const hanging = fakeAdapter({ respond: (_t, signal) => { seenSignal = signal; return new Promise(() => {}); } });
  const slow = createSourceRegistry({ adapters: [hanging.adapter], clock: makeClock().clock, timeoutMs: 30 });
  await assert.rejects(slow.fetch("fake", "lent.test"), isHubError("transport", "SOURCE_TIMEOUT"));
  assert.equal(seenSignal.aborted, true);

  let attempt = 0;
  const flaky = fakeAdapter({ respond: () => (++attempt === 1 ? { status: 503, contentType: HTML, body: "" } : { status: 200, contentType: HTML, body: "<p>ok</p>" }) });
  const registry = createSourceRegistry({ adapters: [flaky.adapter], clock: makeClock().clock });
  await assert.rejects(registry.fetch("fake", "f.test"), isHubError("transport", "SOURCE_HTTP_STATUS"));
  const retry = await registry.fetch("fake", "f.test");
  assert.equal(retry.cached, false);
  assert.equal(flaky.calls.length, 2);
  const throwing = fakeAdapter({ respond: () => { throw new Error("boom"); } });
  const reg2 = createSourceRegistry({ adapters: [throwing.adapter], clock: makeClock().clock });
  await assert.rejects(reg2.fetch("fake", "t.test"), /boom/);
  await assert.rejects(reg2.fetch("fake", "t.test"), /boom/);
  assert.equal(throwing.calls.length, 2);
});

test("M04-RES-06 registry: registration and request validation", async () => {
  assert.throws(() => createSourceRegistry({ adapters: [] }), isHubError("validation"));
  assert.throws(() => createSourceRegistry({}), isHubError("validation"));
  assert.throws(() => createSourceRegistry({ adapters: { x: { id: "x" } } }), isHubError("validation"));
  assert.throws(() => createSourceRegistry({ adapters: { "../rău": fakeAdapter().adapter } }), isHubError("validation"));
  assert.throws(() => createSourceRegistry({ adapters: [fakeAdapter().adapter, fakeAdapter().adapter] }), isHubError("conflict"));
  assert.throws(() => createSourceRegistry({ adapters: [fakeAdapter().adapter], cache: {} }), isHubError("validation"));
  const registry = createSourceRegistry({ adapters: [fakeAdapter().adapter], clock: makeClock().clock });
  await assert.rejects(registry.fetch("necunoscut", "a.test"), isHubError("not_found"));
  await assert.rejects(registry.fetch("fake", "   "), isHubError("validation"));
  await assert.rejects(registry.fetch("fake", "x".repeat(3000)), isHubError("validation"));
});

test("M04-RES-07 the live adapter is always refused (LIVE_COLLECTION_DISABLED), directly and through the registry", async () => {
  const live = liveHttpAdapter();
  assert.equal(live.kind, "live");
  await assert.rejects(live.fetch("https://firma-reala.example/"), isHubError("policy", LIVE_COLLECTION_DISABLED));
  await assert.rejects(live.fetch("https://firma-reala.example/"), { message: "Colectarea live e dezactivată în M04 (LIVE_COLLECTION_DISABLED)" });
  const fixture = fakeAdapter();
  // Registered the way the Hub registers it: refused before normalization, rate slots or cache.
  const registry = createSourceRegistry({ adapters: { fixture: fixture.adapter, live }, clock: makeClock().clock, rateLimitPerMinute: 1 });
  for (let i = 0; i < 3; i += 1) await assert.rejects(registry.fetch("live", "https://firma-reala.example/"), isHubError("policy", LIVE_COLLECTION_DISABLED));
  await assert.rejects(registry.fetch("live", ""), isHubError("policy", LIVE_COLLECTION_DISABLED));
  // A custom adapter declaring kind "live" is refused the same way, without being called.
  const sneaky = fakeAdapter({ id: "colector", kind: "live" });
  const reg2 = createSourceRegistry({ adapters: [sneaky.adapter], clock: makeClock().clock });
  await assert.rejects(reg2.fetch("colector", "https://x.example/"), isHubError("policy", LIVE_COLLECTION_DISABLED));
  assert.equal(sneaky.calls.length, 0);
  // An unregistered "live…" source is a policy refusal too, not a missing source.
  await assert.rejects(createSourceRegistry({ adapters: [fixture.adapter] }).fetch("live-http", "https://x.example/"), isHubError("policy", LIVE_COLLECTION_DISABLED));
});

test("M04-RES-08 fixture adapter: .test hosts only, URL forms share one cache entry, scheme from the fixture, size limit, missing site", async () => {
  assert.ok(fs.existsSync(path.join(DEFAULT_FIXTURE_SITES_DIR, "atelierul-verde.test.html")));
  const { clock } = makeClock();
  const adapter = fixtureSiteAdapter({ dir: DEFAULT_FIXTURE_SITES_DIR });
  assert.deepEqual([adapter.id, adapter.kind], ["fixture", "fixture"]);
  const registry = createSourceRegistry({ adapters: { fixture: adapter }, clock });
  const page = await registry.fetch("fixture", "https://Atelierul-Verde.test/contact?x=1");
  assert.equal(page.target, "atelierul-verde.test");
  assert.equal(page.finalUrl, "https://atelierul-verde.test/");
  assert.match(page.body, /Atelierul Verde/);
  assert.equal((await registry.fetch("fixture", "atelierul-verde.test")).cached, true);
  assert.equal((await registry.fetch("fixture", "spicul-auriu.test")).finalUrl, "http://spicul-auriu.test/"); // fixture:scheme http
  for (const bad of ["example.com", "atelierul-verde.test.example.com", "../atelierul-verde.test", "..\\x.test", "a/b.test", "file:///C:/x.test", "https://user:p@x.test/", "https://x.test:8080/", "", "test", ".test"]) {
    await assert.rejects(registry.fetch("fixture", bad), isHubError("validation"), bad);
  }
  await assert.rejects(registry.fetch("fixture", "nu-exista.test"), isHubError("not_found"));

  const dir = tempDir("m04-sites");
  try {
    fs.writeFileSync(path.join(dir, "mare.test.html"), Buffer.alloc(MAX_BODY_BYTES + 1, 0x61));
    fs.mkdirSync(path.join(dir, "folder.test.html"));
    fs.writeFileSync(path.join(dir, "mic.test.html"), "<html lang=ro><title>Mic</title></html>");
    const local = createSourceRegistry({ adapters: [fixtureSiteAdapter({ dir })], clock });
    await assert.rejects(local.fetch("fixture", "mare.test"), isHubError("validation", "BODY_TOO_LARGE"));
    await assert.rejects(local.fetch("fixture", "folder.test"), isHubError("not_found"));
    assert.equal((await local.fetch("fixture", "mic.test")).body, "<html lang=ro><title>Mic</title></html>");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => fixtureSiteAdapter({ dir: "" }), isHubError("validation"));
});

test("M04-RES-09 pipeline: every fixture site loads through the registry and is audited", async () => {
  const registry = createSourceRegistry({ adapters: { fixture: fixtureSiteAdapter() }, clock: makeClock().clock });
  const hosts = fs.readdirSync(DEFAULT_FIXTURE_SITES_DIR).filter((f) => f.endsWith(".test.html")).map((f) => f.slice(0, -5));
  assert.ok(hosts.length >= 8 && hosts.length <= 10, `${hosts.length} fixture sites`);
  for (const host of hosts) {
    const page = await registry.fetch("fixture", host);
    const audit = auditHtml({ html: page.body, url: page.finalUrl, orgName: "", fetchedAt: page.fetchedAt, sourceKind: page.sourceKind });
    assert.equal(audit.checks.length, 14, host);
    assert.equal(audit.fetchedAt, "2026-10-01T10:00:00.000Z");
    assert.equal(audit.sourceKind, "fixture");
  }
  const good = await registry.fetch("fixture", "atelierul-verde.test");
  const audit = auditHtml({ html: good.body, url: good.finalUrl, orgName: "Atelierul Verde SRL" });
  assert.ok(audit.checks.every((c) => c.status === "PASS"));
});

/* ---------------------------------------------------------------- collector URL policy */

const PUBLIC_V4 = "45.33.12.7";
const resolverFor = (table) => async (host) => {
  if (!(host in table)) throw new Error(`ENOTFOUND ${host}`);
  return table[host];
};

test("M04-URL-01 collector URLs: only http(s), no credentials, only ports 80/443, no internal names", async () => {
  const resolve = resolverFor({ "firma-publica.example": [PUBLIC_V4] });
  assert.deepEqual(await validateCollectorUrl("https://firma-publica.example/despre", { resolve }), { ok: true, reason: "Host public; 1 adresă verificată." });
  assert.equal((await validateCollectorUrl("http://firma-publica.example:443/", { resolve })).ok, true);
  for (const url of ["ftp://firma-publica.example/", "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,<p>x</p>", "gopher://firma-publica.example/", "ws://firma-publica.example/"]) {
    const result = await validateCollectorUrl(url, { resolve });
    assert.equal(result.ok, false, url);
    assert.match(result.reason, /Schema|invalid/, url);
  }
  for (const url of ["https://user:parola@firma-publica.example/", "https://user@firma-publica.example/"]) {
    assert.match((await validateCollectorUrl(url, { resolve })).reason, /credențiale/);
  }
  assert.match((await validateCollectorUrl("https://firma-publica.example:8443/", { resolve })).reason, /Portul 8443/);
  for (const url of ["http://localhost/", "http://LOCALHOST:80/", "http://api.localhost/", "http://imprimanta.local/", "http://server.internal/", "http://router.home.arpa/", "http://intranet/", "http://localhost./"]) {
    const result = await validateCollectorUrl(url, { resolve: async () => [PUBLIC_V4] });
    assert.equal(result.ok, false, url);
  }
  for (const value of ["", "   ", null, undefined, "nu e un url", `https://${"a".repeat(2050)}.example/`]) assert.equal((await validateCollectorUrl(value, { resolve })).ok, false, String(value).slice(0, 20));
});

test("M04-URL-02 collector URLs: private, loopback, link-local, CGNAT, metadata and reserved IPv4 are refused (also in shorthand forms)", async () => {
  const resolve = async () => { throw new Error("an IP literal is never resolved"); };
  const refused = ["127.0.0.1", "127.8.9.10", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1", "169.254.169.254", "169.254.1.1",
    "100.64.0.1", "100.127.255.254", "0.0.0.0", "192.0.2.10", "198.51.100.1", "203.0.113.5", "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1"];
  for (const ip of refused) {
    const result = await validateCollectorUrl(`http://${ip}/`, { resolve });
    assert.equal(result.ok, false, ip);
  }
  assert.match((await validateCollectorUrl("http://169.254.169.254/latest/meta-data/", { resolve })).reason, /metadate/);
  assert.match((await validateCollectorUrl("http://100.64.0.1/", { resolve })).reason, /CGNAT/);
  // The URL parser normalizes decimal / hex / short IPv4 forms; they are checked as the address they really are.
  for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0x7f.1/", "http://127.1/", "http://017700000001/", "http://0xA9FEA9FE/"]) {
    assert.equal((await validateCollectorUrl(url, { resolve })).ok, false, url);
  }
  for (const ip of ["172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", PUBLIC_V4]) {
    assert.equal((await validateCollectorUrl(`http://${ip}/`, { resolve })).ok, true, ip);
  }
});

test("M04-URL-03 collector URLs: IPv6 loopback, unique-local, link-local, mapped and embedded private IPv4 are refused", async () => {
  const resolve = async () => [];
  const refused = ["::1", "::", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:7f00:1", "64:ff9b::a00:1", "2002:c0a8:101::1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "::127.0.0.1", "100::1"];
  for (const ip of refused) assert.equal((await validateCollectorUrl(`http://[${ip}]/`, { resolve })).ok, false, ip);
  for (const ip of ["2a00:1450:4001:800::200e", "2606:4700::6810:84e5", "::ffff:45.33.12.7"]) assert.equal((await validateCollectorUrl(`https://[${ip}]/`, { resolve })).ok, true, ip);
});

test("M04-URL-04 collector URLs: a public name resolving to a private address is refused (DNS rebinding); DNS is always injected", async () => {
  const resolve = resolverFor({
    "rebind.example": ["10.0.0.5"],
    "mixt.example": [PUBLIC_V4, "192.168.0.10"],
    "metadate.example": [{ address: "169.254.169.254", family: 4 }],
    "v6-local.example": ["fd00::5"],
    "v6-mapped.example": ["::ffff:127.0.0.1"],
    "gol.example": [],
    "gresit.example": ["nu-e-ip"],
    "bun.example": [{ address: PUBLIC_V4, family: 4 }, { address: "2a00:1450:4001:800::200e", family: 6 }],
  });
  const rebind = await validateCollectorUrl("https://rebind.example/", { resolve });
  assert.equal(rebind.ok, false);
  assert.match(rebind.reason, /10\.0\.0\.5.*DNS rebinding/);
  for (const host of ["mixt.example", "metadate.example", "v6-local.example", "v6-mapped.example", "gol.example", "gresit.example", "nu-exista.example"]) {
    assert.equal((await validateCollectorUrl(`https://${host}/`, { resolve })).ok, false, host);
  }
  assert.deepEqual(await validateCollectorUrl("https://bun.example/", { resolve }), { ok: true, reason: "Host public; 2 adrese verificate." });
  // Without an injected resolver nothing is looked up and the URL is refused.
  const noResolver = await validateCollectorUrl("https://bun.example/");
  assert.equal(noResolver.ok, false);
  assert.match(noResolver.reason, /DNS/);
  // The resolver sees only the bare host (no brackets, no trailing dot, lowercase).
  const seen = [];
  await validateCollectorUrl("https://BUN.Example./cale", { resolve: async (host) => { seen.push(host); return [PUBLIC_V4]; } });
  assert.deepEqual(seen, ["bun.example"]);
});
