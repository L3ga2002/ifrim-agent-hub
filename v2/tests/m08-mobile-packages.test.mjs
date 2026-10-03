// Milestone 08 — D10 Personal Mission Control (over HTTP, simulated phone on localhost) and the decision packages A/B.
// The phone has its own HttpOnly cookie, view + fail-safe stops only, idempotent commands built on a fresh view, revocation from
// the PC or the phone itself; it never gets the owner's session and cannot confirm a plan. Package B waits for A; "executed" is
// read from reality; B3 toggles exactly one extra verification command; nothing is deleted.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { isAllowedCommand } from "../server/factory/spec.mjs";

async function serve() {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const owner = await enrolOwner(t);
  const host = `localhost:${t.config.port}`;
  const call = (method, path, { body, cookie = "", ownerCookie = false, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const cookies = [cookie, ownerCookie ? `ifrim_owner=${owner.token}` : ""].filter(Boolean).join("; ");
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookies ? { Cookie: cookies } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, owner, call, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("M08-D10-01 pairing: owner-only code (10 min, one live), max 5 wrong attempts, HttpOnly device cookie; the phone sees state but never the owner session", async () => {
  const s = await serve();
  try {
    assert.ok([401, 403].includes((await s.call("POST", "/api/devices/pairing", { body: {} })).status), "a pairing code needs the owner's session");
    const p = await s.call("POST", "/api/devices/pairing", { body: {}, ownerCookie: true });
    assert.equal(p.status, 200);
    assert.match(p.json.code, /^\d{6}$/);
    for (let i = 0; i < 5; i += 1) {
      const bad = String((Number(p.json.code) + 1 + i) % 1000000).padStart(6, "0");
      assert.equal((await s.call("POST", "/api/m/pair", { body: { code: bad } })).status, 401);
    }
    const locked = await s.call("POST", "/api/m/pair", { body: { code: p.json.code } });
    assert.equal(locked.status, 401, "after 5 wrong codes even the right one is refused");
    assert.match(locked.json.error.message, /Prea multe/);
    const p2 = await s.call("POST", "/api/devices/pairing", { body: {}, ownerCookie: true });
    const paired = await s.call("POST", "/api/m/pair", { body: { code: p2.json.code, label: "Telefon test" } });
    assert.equal(paired.status, 200);
    const setCookie = String(paired.headers["set-cookie"]);
    assert.match(setCookie, /ifrim_device=/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Path=\/api/);
    assert.ok(!("token" in paired.json), "the device token travels only in the cookie");
    assert.equal((await s.call("POST", "/api/m/pair", { body: { code: p2.json.code } })).status, 401, "a code is single-use");
    const cookie = setCookie.split(";")[0];
    const st = await s.call("GET", "/api/m/state", { cookie });
    assert.equal(st.status, 200);
    assert.equal(st.json.viewer.kind, "device");
    assert.deepEqual(st.json.viewer.permissions.sort(), ["pause_mission", "stop_all", "stop_mission", "view"]);
    assert.equal((await s.call("GET", "/api/m/state")).status, 401, "no cookie → pairing needed");
    assert.equal((await s.call("GET", "/api/owner/status", { cookie })).json?.session ?? null, null, "the device cookie is not an owner session");
  } finally { await s.stop(); }
});

test("M08-D10-02 commands: idempotent per key, refused on a stale view, only fail-safe types; no confirmation from the phone; revocation and forget", async () => {
  const s = await serve();
  try {
    const p = await s.call("POST", "/api/devices/pairing", { body: {}, ownerCookie: true });
    const paired = await s.call("POST", "/api/m/pair", { body: { code: p.json.code } });
    const cookie = String(paired.headers["set-cookie"]).split(";")[0];
    const st = (await s.call("GET", "/api/m/state", { cookie })).json;
    const first = await s.call("POST", "/api/m/command", { cookie, body: { type: "stop_all", observedAt: st.serverTime, idempotencyKey: "tap-1-0000-aa" } });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.duplicate, false);
    const again = await s.call("POST", "/api/m/command", { cookie, body: { type: "stop_all", observedAt: st.serverTime, idempotencyKey: "tap-1-0000-aa" } });
    assert.equal(again.json.duplicate, true, "a retried tap is not executed twice");
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'system.stop_all' AND channel = 'companion'").get().n, 1);
    const stale = await s.call("POST", "/api/m/command", { cookie, body: { type: "stop_all", observedAt: new Date(Date.now() - 3 * 60000).toISOString(), idempotencyKey: "tap-2-0000-aa" } });
    assert.equal(stale.status >= 400, true);
    assert.match(stale.json.error.message, /veche|stare|reîncarcă/i);
    for (const type of ["envelope.confirm", "confirm", "grant.create", "package.decide"]) {
      const r = await s.call("POST", "/api/m/command", { cookie, body: { type, observedAt: st.serverTime, idempotencyKey: `x-${type}-0000-aa` } });
      assert.equal(r.status >= 400, true, type);
    }
    // The phone cannot reach the owner's routes either.
    assert.ok((await s.call("POST", "/api/devices/pairing", { cookie, body: {} })).status >= 400);
    // A stale UI contract never blocks the phone's stop (fail-safe), unlike a normal mutating request.
    const failsafe = await s.call("POST", "/api/m/command", { cookie, headers: { "X-Hub-UI-Contract": "1" }, body: { type: "stop_all", observedAt: (await s.call("GET", "/api/m/state", { cookie })).json.serverTime, idempotencyKey: "tap-3-0000-aa" } });
    assert.equal(failsafe.status, 200, JSON.stringify(failsafe.json));
    // Revocation from the PC: the phone loses access at once.
    const list = (await s.call("GET", "/api/devices", { ownerCookie: true })).json.devices;
    await s.call("POST", `/api/devices/${list[0].id}/revoke`, { ownerCookie: true, body: {} });
    assert.equal((await s.call("GET", "/api/m/state", { cookie })).status, 401);
    assert.equal((await s.call("POST", "/api/m/command", { cookie, body: { type: "stop_all", observedAt: new Date().toISOString(), idempotencyKey: "tap-4-0000-aa" } })).status, 401);
    // Forget from the phone itself (a second device).
    const p3 = await s.call("POST", "/api/devices/pairing", { body: {}, ownerCookie: true });
    const c2 = String((await s.call("POST", "/api/m/pair", { body: { code: p3.json.code } })).headers["set-cookie"]).split(";")[0];
    const f = await s.call("POST", "/api/m/forget", { cookie: c2, body: {} });
    assert.equal(f.json.forgotten, true);
    assert.match(String(f.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await s.call("GET", "/api/m/state", { cookie: c2 })).status, 401);
  } finally { await s.stop(); }
});

test("M08-PK-01 packages: A then B; B blocked until A is decided and executed; decisions need a fresh owner session; B3 toggles exactly python3 -m unittest; nothing is deleted", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const d = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);
    const a = await d("package.present", { kind: "A" });
    assert.deepEqual(a.options.map((o) => o.key), ["A1", "A2", "A3"]);
    assert.equal(a.options.find((o) => o.key === "A1").state, "UNDECIDED");
    assert.ok(a.body.parts.every((p) => typeof p.synced === "boolean"));
    assert.match(a.options.find((o) => o.key === "A3").title, /nu le șterg/);
    const same = await d("package.present", { kind: "A" });
    assert.equal(same.id, a.id, "an unchanged inventory is the same package (hash)");
    const b = await d("package.present", { kind: "B" });
    assert.ok(b.blockedBy.length > 0);
    await assert.rejects(d("package.decide", { packageId: b.id, decisions: {} }, { ownerSession: owner.session }), /protecția datelor|nu e decisă/);
    await assert.rejects(d("package.decide", { packageId: a.id, decisions: { A1: "approve" } }), /sesiunea/);
    // Approving A1 records the decision; "executed" stays false until the relocation really happened (read from config).
    const decided = await d("package.decide", { packageId: a.id, decisions: { A1: "approve", A2: "reject", A3: "approve" } }, { ownerSession: owner.reauth() });
    const va = t.hub.packages.view(decided.package?.id || a.id);
    assert.equal(va.options.find((o) => o.key === "A1").state, "APPROVED_PENDING_EXECUTION");
    assert.ok(t.hub.packages.view(b.id).blockedBy.some((x) => /A1 e aprobată, dar nu e executată/.test(x)));
    assert.equal(t.hub.settings.get("factoryExtraCommands").length, 0);
    // B3 directly (as the package does on approval): the one extra command is allowed; anything wider stays refused.
    assert.equal(isAllowedCommand("python3 -m unittest backend/tests/test_driver_ranking_unit.py"), false);
    t.hub.bus.transaction(() => t.hub.settings.set("factoryExtraCommands", ["python-unittest"], "test"));
    assert.equal(isAllowedCommand("python3 -m unittest backend/tests/test_driver_ranking_unit.py"), true);
    assert.equal(isAllowedCommand("python3 -m unittest ../x.py"), false);
    assert.equal(isAllowedCommand("python3 -m unittest a.py; rm -rf /"), false);
    assert.equal(isAllowedCommand("python3 -c 'print(1)'"), false);
    t.hub.bus.transaction(() => t.hub.settings.set("factoryExtraCommands", [], "test"));
    assert.equal(isAllowedCommand("python3 -m unittest backend/tests/test_driver_ranking_unit.py"), false);
  } finally { await t.cleanup(); }
});
