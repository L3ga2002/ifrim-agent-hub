import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor } from "./helpers.mjs";
import { HubError } from "../server/core/errors.mjs";
import { rowToEvent } from "../server/events/bus.mjs";
import { parseCadence, lastSlot, nextSlot } from "../server/domain/schedules.mjs";
import { SCHEDULE_COMMANDS } from "../server/runtime/command-catalog.mjs";

// ---------- helpers ----------
const local = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0);

function mutableClock(iso) {
  let ms = Date.parse(iso);
  const clock = () => new Date(ms);
  clock.set = (value) => { ms = Date.parse(value); };
  return clock;
}

const cmd = (hub, type, payload) => hub.commands.dispatch({ type, payload, channel: "test", actor: "user" });
const create = async (hub, payload) => (await cmd(hub, "schedule.create", payload)).result;
const transition = async (hub, scheduleId, to, reason) => (await cmd(hub, "schedule.transition", { scheduleId, to, reason })).result;
// Same executor the Hub wires into its scheduler (hub.mjs extraTick).
const viaScheduleChannel = (hub) => (command) => hub.commands.dispatch({ ...command, channel: "schedule", actor: "scheduler" }).then((r) => r.result);

const isCategory = (category, pattern) => (error) => {
  assert.equal(error?.category, category, `expected ${category}, got ${error?.category}: ${error?.message}`);
  if (pattern) assert.match(error.message, pattern);
  return true;
};

const slotCounts = (hub, scheduleId) => hub.db.prepare("SELECT slot, COUNT(*) AS n FROM schedule_runs WHERE schedule_id = ? GROUP BY slot ORDER BY slot")
  .all(scheduleId).map((r) => [r.slot, Number(r.n)]);
const eventsOf = (hub, type) => hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map(rowToEvent);
const promptRuns = (t) => t.readLog("claude").filter((entry) => Array.isArray(entry.args) && entry.args.includes("-p")).length;

const USABLE = new Set(["available", "assisted"]);
const CONTROL_RANK = { structured_api: 0, dom: 1, visual: 2 };

// ---------- cadence grammar and slots ----------
test("M01-SCH01 parseCadence accepts hourly, every Nm, daily, weekdays and weekly (case and outer spaces normalized)", () => {
  // Canonical text: equivalent spellings of one cadence share one form (used by the one-owner-per-intent key).
  assert.deepEqual(parseCadence("hourly"), { kind: "every", minutes: 60, text: "every 60m" });
  assert.deepEqual(parseCadence("every 060m"), { kind: "every", minutes: 60, text: "every 60m" });
  assert.deepEqual(parseCadence("every 5m"), { kind: "every", minutes: 5, text: "every 5m" });
  assert.deepEqual(parseCadence("every 1440m"), { kind: "every", minutes: 1440, text: "every 1440m" });
  assert.deepEqual(parseCadence("  Every 15M "), { kind: "every", minutes: 15, text: "every 15m" });
  assert.deepEqual(parseCadence("daily 09:30"), { kind: "daily", hour: 9, minute: 30, text: "daily 09:30" });
  assert.deepEqual(parseCadence("daily 00:00"), { kind: "daily", hour: 0, minute: 0, text: "daily 00:00" });
  assert.deepEqual(parseCadence("weekdays 08:00"), { kind: "weekdays", hour: 8, minute: 0, text: "weekdays 08:00" });
  assert.deepEqual(parseCadence("weekly mon 07:15"), { kind: "weekly", day: 1, hour: 7, minute: 15, text: "weekly mon 07:15" });
  assert.deepEqual(parseCadence("WEEKLY Sun 23:59"), { kind: "weekly", day: 0, hour: 23, minute: 59, text: "weekly sun 23:59" });
  assert.equal(parseCadence("weekly sat 12:00").day, 6);
});

test("M01-SCH02 parseCadence rejects every other grammar with a validation error", () => {
  const rejected = ["", "   ", null, undefined, 42, {}, "every 4m", "every 0m", "every 1441m", "every 12345m", "every 5", "every 5h", "every 5 minutes",
    "every -5m", "every m", "daily", "daily 9:30", "daily 24:00", "daily 12:60", "daily 08:00 utc", "weekdays 8:00", "weekends 08:00", "weekly 07:15",
    "weekly monday 07:15", "weekly xyz 07:15", "monthly 1 10:00", "hourly 10:00", "*/5 * * * *", "0 8 * * 1-5"];
  for (const input of rejected) {
    assert.throws(() => parseCadence(input), (error) => error instanceof HubError && error.category === "validation", `must reject ${JSON.stringify(input)}`);
  }
});

test("M01-SCH03 lastSlot/nextSlot are correct for a fixed clock", () => {
  // Interval cadences are aligned on epoch multiples (UTC).
  const utc = new Date("2026-09-30T10:07:30.000Z");
  const every5 = lastSlot("every 5m", utc);
  assert.equal(every5.key, "2026-09-30T10:05:00.000Z");
  assert.equal(every5.at.toISOString(), every5.key);
  assert.equal(nextSlot("every 5m", utc).toISOString(), "2026-09-30T10:10:00.000Z");
  assert.equal(lastSlot("hourly", utc).key, "2026-09-30T10:00:00.000Z");
  assert.equal(nextSlot("hourly", utc).toISOString(), "2026-09-30T11:00:00.000Z");
  assert.equal(lastSlot("every 1440m", utc).key, "2026-09-30T00:00:00.000Z");
  assert.equal(nextSlot("every 1440m", utc).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(lastSlot(parseCadence("every 15m"), utc).key, "2026-09-30T10:00:00.000Z", "a parsed cadence is accepted too");
  const edge = new Date("2026-09-30T10:05:00.000Z");
  assert.equal(lastSlot("every 5m", edge).key, "2026-09-30T10:05:00.000Z", "a slot exactly at now is due");
  assert.equal(nextSlot("every 5m", edge).toISOString(), "2026-09-30T10:10:00.000Z", "the next slot is strictly after now");

  // Clock cadences use local machine time; Wednesday 2026-09-30 10:07:30 local.
  const wed = local(2026, 9, 30, 10, 7, 30);
  assert.equal(wed.getDay(), 3);
  const last = (cadence, now) => lastSlot(cadence, now).at.getTime();
  const next = (cadence, now) => nextSlot(cadence, now).getTime();
  assert.equal(last("daily 09:30", wed), local(2026, 9, 30, 9, 30).getTime());
  assert.equal(lastSlot("daily 09:30", wed).key, local(2026, 9, 30, 9, 30).toISOString());
  assert.equal(next("daily 09:30", wed), local(2026, 10, 1, 9, 30).getTime());
  assert.equal(last("daily 11:00", wed), local(2026, 9, 29, 11, 0).getTime());
  assert.equal(next("daily 11:00", wed), local(2026, 9, 30, 11, 0).getTime());
  assert.equal(last("weekdays 08:00", wed), local(2026, 9, 30, 8, 0).getTime());
  assert.equal(next("weekdays 08:00", wed), local(2026, 10, 1, 8, 0).getTime());
  const sat = local(2026, 10, 3, 10, 0);
  assert.equal(sat.getDay(), 6);
  assert.equal(last("weekdays 08:00", sat), local(2026, 10, 2, 8, 0).getTime(), "Saturday: last weekday slot is Friday");
  assert.equal(next("weekdays 08:00", sat), local(2026, 10, 5, 8, 0).getTime(), "Saturday: next weekday slot is Monday");
  const monEarly = local(2026, 10, 5, 7, 0);
  assert.equal(last("weekdays 08:00", monEarly), local(2026, 10, 2, 8, 0).getTime());
  assert.equal(next("weekdays 08:00", monEarly), local(2026, 10, 5, 8, 0).getTime());
  assert.equal(last("weekly mon 07:15", wed), local(2026, 9, 28, 7, 15).getTime());
  assert.equal(next("weekly mon 07:15", wed), local(2026, 10, 5, 7, 15).getTime());
  assert.equal(last("weekly wed 10:00", wed), local(2026, 9, 30, 10, 0).getTime());
  assert.equal(next("weekly wed 10:00", wed), local(2026, 10, 7, 10, 0).getTime());
  assert.equal(last("weekly wed 11:00", wed), local(2026, 9, 23, 11, 0).getTime(), "same weekday, later hour: previous week");
  assert.equal(next("weekly wed 11:00", wed), local(2026, 9, 30, 11, 0).getTime());

  // Invariants: last <= now < next, the last slot only changes at the next slot.
  const cadences = ["every 5m", "every 7m", "hourly", "every 1440m", "daily 09:30", "weekdays 08:00", "weekly mon 07:15", "weekly sun 18:45"];
  const instants = [wed, sat, monEarly, local(2026, 10, 4, 18, 45), local(2026, 9, 28, 7, 14, 59), new Date("2026-10-01T23:59:59.999Z")];
  for (const cadence of cadences) {
    for (const now of instants) {
      const l = lastSlot(cadence, now);
      const n = nextSlot(cadence, now);
      assert.ok(l && l.at <= now, `${cadence} @ ${now.toISOString()}: last slot not after now`);
      assert.ok(n > now, `${cadence} @ ${now.toISOString()}: next slot strictly after now`);
      assert.equal(lastSlot(cadence, new Date(n.getTime() - 1)).key, l.key, `${cadence}: no slot between last and next`);
      assert.equal(lastSlot(cadence, n).at.getTime(), n.getTime(), `${cadence}: next slot becomes the last slot at its time`);
    }
  }
});

// ---------- ownership ----------
test("M01-SCH04 one owner per intent: the same action and cadence on another backend is refused", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const action = { command: "briefing.generate", payload: { hours: 24 } };
    const first = await create(hub, { name: "Morning briefing", cadence: "daily 08:00", backend: "LOCAL_HUB", action });
    assert.equal(first.status, "DRAFT");
    assert.equal(first.backend, "LOCAL_HUB");
    assert.equal(first.owner, "hub");
    assert.equal(first.cadence, "daily 08:00");
    assert.ok(first.intentKey.length > 0);

    for (const [backend, cadence] of [["CLAUDE_NATIVE", "daily 08:00"], ["OPENAI_NATIVE", "DAILY 08:00"], ["OPENCLAW", "daily 08:00"], ["LOCAL_HUB", "  daily 08:00 "]]) {
      await assert.rejects(create(hub, { name: `Morning briefing on ${backend}`, cadence, backend, action }), (error) => {
        isCategory("conflict")(error);
        assert.equal(error.details?.scheduleId, first.id, "the refusal names the current owner");
        return true;
      }, `${backend} must not become a second owner`);
    }
    assert.equal(hub.schedules.list().length, 1);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM native_schedule_refs").get().n, 0, "a refused native schedule leaves no reference behind");
    assert.equal(hub.commands.list({ type: "schedule.create", status: "failed" }).length, 4, "each refusal is in the command log");

    const evening = await create(hub, { name: "Evening briefing", cadence: "daily 18:00", backend: "CLAUDE_NATIVE", action });
    assert.notEqual(evening.intentKey, first.intentKey, "another cadence is another intent");
    const longer = await create(hub, { name: "Morning briefing 48h", cadence: "daily 08:00", action: { command: "briefing.generate", payload: { hours: 48 } } });
    assert.notEqual(longer.intentKey, first.intentKey, "another payload is another intent");
    assert.equal(hub.schedules.list().length, 3);

    await assert.rejects(create(hub, { name: "Too frequent", cadence: "every 2m", action }), isCategory("validation"));
    await assert.rejects(create(hub, { name: "Unknown backend", cadence: "daily 08:00", backend: "ZAPIER", action }), isCategory("validation"));
    await assert.rejects(create(hub, { name: "No command", cadence: "daily 09:00", backend: "CLAUDE_NATIVE", action: { prompt: "x" } }), isCategory("validation"));
    assert.equal(hub.schedules.list().length, 3);
  } finally { await t.cleanup(); }
});

test("M01-SCH05 retiring a schedule releases its intent so another backend can own it", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const action = { command: "briefing.generate", payload: { hours: 168 } };
    const original = await create(hub, { name: "Weekly review", cadence: "weekly fri 16:00", action });
    const retired = await transition(hub, original.id, "RETIRED", "Moving the weekly review to a Claude scheduled task");
    assert.equal(retired.status, "RETIRED");
    // Intended (schedules.mjs create(): the clash query ignores RETIRED rows): the retired schedule no longer owns the intent.
    const moved = await create(hub, { name: "Weekly review (Claude)", cadence: "weekly fri 16:00", backend: "CLAUDE_NATIVE", action });
    assert.equal(moved.backend, "CLAUDE_NATIVE");
    assert.equal(moved.intentKey, original.intentKey);
    assert.equal(hub.schedules.get(original.id).status, "RETIRED", "history is kept");
    await assert.rejects(create(hub, { name: "Weekly review again", cadence: "weekly fri 16:00", action }), (error) => {
      isCategory("conflict")(error);
      assert.equal(error.details?.scheduleId, moved.id);
      return true;
    });
  } finally { await t.cleanup(); }
});

test("M01-SCH06 equivalent spellings of the same action and cadence are one intent", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const sameCadence = (text) => ({ ...parseCadence(text), text: "" });
    assert.deepEqual(sameCadence("every 60m"), sameCadence("hourly"), "hourly and every 60m parse to the same cadence");
    assert.deepEqual(sameCadence("every 060m"), sameCadence("hourly"));
    await create(hub, { name: "Hourly briefing", cadence: "hourly", action: { command: "briefing.generate", payload: { hours: 1 } } });
    await create(hub, { name: "Daily milestone", cadence: "daily 07:30", backend: "CLAUDE_NATIVE", action: { command: "checkpoint.create", payload: { kind: "milestone", label: "Daily" } } });
    const variants = [
      ["every 60m vs hourly", { name: "Hourly briefing (Claude)", cadence: "every 60m", backend: "CLAUDE_NATIVE", action: { command: "briefing.generate", payload: { hours: 1 } } }],
      ["every 060m vs hourly", { name: "Hourly briefing (OpenAI)", cadence: "every 060m", backend: "OPENAI_NATIVE", action: { command: "briefing.generate", payload: { hours: 1 } } }],
      ["payload key order", { name: "Daily milestone (OpenAI)", cadence: "daily 07:30", backend: "OPENAI_NATIVE", action: { command: "checkpoint.create", payload: { label: "Daily", kind: "milestone" } } }],
    ];
    const secondOwners = [];
    for (const [label, payload] of variants) {
      try { await create(hub, payload); secondOwners.push(label); } catch (error) { isCategory("conflict")(error); }
    }
    assert.deepEqual(secondOwners, [], "each variant is the same recurring work and must be refused as a second owner");
  } finally { await t.cleanup(); }
});

// ---------- LOCAL_HUB policy ----------
test("M01-SCH07 LOCAL_HUB schedules may only run commands allowed on the schedule channel", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.deepEqual([...SCHEDULE_COMMANDS].sort(), ["backup.run", "briefing.generate", "checkpoint.create", "native.mirror", "surface.refresh"]);
    const onScheduleChannel = hub.commands.catalog().filter((c) => c.channels.includes("schedule")).map((c) => c.type).sort();
    assert.deepEqual(onScheduleChannel, [...SCHEDULE_COMMANDS].sort(), "every schedulable command is registered and accepted on the schedule channel");

    await assert.rejects(create(hub, { name: "Nightly model run", cadence: "daily 02:00", action: { command: "run.start", payload: {} } }), isCategory("policy", /LOCAL_HUB/));
    await assert.rejects(create(hub, { name: "Nightly memory note", cadence: "daily 02:00", action: { command: "memory.add", payload: {} } }), isCategory("policy"));
    assert.equal(hub.schedules.list().length, 0);

    // Defense in depth: a row created through the domain API is still refused at activation.
    const sneaky = hub.bus.transaction(() => hub.schedules.create({ name: "Nightly model run", cadence: "daily 02:00", action: { command: "run.start", payload: {} } }, "test"));
    assert.equal(sneaky.status, "DRAFT");
    await assert.rejects(transition(hub, sneaky.id, "ACTIVE", "try to enable"), isCategory("policy", /run\.start/));
    assert.throws(() => hub.bus.transaction(() => hub.schedules.transition(sneaky.id, "ACTIVE", { reason: "direct activation" })), isCategory("policy"));
    assert.equal(hub.schedules.get(sneaky.id).status, "DRAFT");

    // The command bus itself refuses non-schedule commands on the schedule channel.
    await assert.rejects(hub.commands.dispatch({ type: "schedule.create", channel: "schedule", actor: "scheduler",
      payload: { name: "Self-replicating", cadence: "daily 03:00", action: { command: "briefing.generate" } } }), isCategory("policy", /schedule/));
    await assert.rejects(hub.commands.dispatch({ type: "computer.acquire", channel: "schedule", actor: "scheduler",
      payload: { envId: "anthropic.claude_computer_use", holder: "scheduler" } }), isCategory("policy"));
    assert.equal(hub.schedules.list().length, 1);
    assert.equal(hub.computer.locks().length, 0);
  } finally { await t.cleanup(); }
});

test("M01-SCH08 a LOCAL_HUB schedule that uses AI cannot be ACTIVE in BUILD_SAFE", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    const ai = await create(hub, { name: "AI digest", cadence: "daily 07:30", usesAi: true, action: { command: "briefing.generate", payload: { hours: 12 } } });
    assert.equal(ai.usesAi, true);
    await assert.rejects(transition(hub, ai.id, "ACTIVE", "enable the digest"), isCategory("policy", /BUILD_SAFE/));
    assert.equal(hub.schedules.get(ai.id).status, "DRAFT");
    assert.equal(hub.schedules.activationProblem(hub.schedules.get(ai.id), SCHEDULE_COMMANDS)?.includes("BUILD_SAFE"), true);

    const external = await create(hub, { name: "External digest", cadence: "daily 07:45", externalEffects: true, action: { command: "briefing.generate", payload: { hours: 12 } } });
    await assert.rejects(transition(hub, external.id, "ACTIVE", "enable the digest"), isCategory("policy"));

    const plain = await create(hub, { name: "Plain digest", cadence: "daily 08:15", action: { command: "briefing.generate", payload: { hours: 12 } } });
    assert.equal((await transition(hub, plain.id, "ACTIVE", "enable the digest")).status, "ACTIVE", "non-AI local schedules can be active in BUILD_SAFE");

    // The refusal is specific to BUILD_SAFE; external effects stay refused in any mode.
    hub.bus.transaction(() => hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    assert.equal((await transition(hub, ai.id, "ACTIVE", "enable the digest")).status, "ACTIVE");
    await assert.rejects(transition(hub, external.id, "ACTIVE", "enable the digest"), isCategory("policy"));
  } finally { await t.cleanup(); }
});

// ---------- native references ----------
test("M01-SCH09 CLAUDE_NATIVE schedule: PENDING_USER_SETUP, link, ACTIVE, PAUSED, DETACHED; the Hub neither creates nor runs it", async () => {
  const clock = mutableClock("2026-09-30T10:02:00.000Z");
  const t = await makeTestHub({ clock });
  try {
    const { hub } = t;
    const promptRunsBefore = promptRuns(t);
    const s = await create(hub, { name: "Daily commit digest", cadence: "daily 07:00", backend: "CLAUDE_NATIVE", description: "Digest of yesterday's commits",
      action: { command: "claude.scheduled_task", prompt: "Summarize yesterday's commits in the Agent Hub repository." } });
    assert.equal(s.status, "DRAFT");
    let refs = hub.schedules.refsOf(s.id);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].backend, "CLAUDE_NATIVE");
    assert.equal(refs[0].state, "PENDING_USER_SETUP");
    assert.equal(refs[0].nativeId, "");
    assert.match(refs[0].stateReason, /Hub-ul nu creează/);
    assert.equal(hub.schedules.list().find((x) => x.id === s.id).nativeRef.state, "PENDING_USER_SETUP");

    const setup = hub.schedules.nativeSetupInstructions(s.id);
    assert.equal(setup.scheduleId, s.id);
    assert.equal(setup.backend, "CLAUDE_NATIVE");
    const steps = setup.steps.join("\n");
    assert.match(steps, /Claude Desktop|\/schedule/, "the owner creates it in the Claude product");
    assert.match(steps, /Daily commit digest/);
    assert.match(steps, /daily 07:00/);
    assert.match(steps, /Summarize yesterday's commits/);
    assert.match(steps, /Leagă ID nativ/, "after creating it, the owner links the native id in the Hub");
    assert.match(setup.usageNote, /Hub-ul nu/, "the Hub does not start the native run");
    assert.equal(hub.schedules.refsOf(s.id).length, 1, "reading the instructions creates nothing");

    await assert.rejects(transition(hub, s.id, "ACTIVE", "turn on the digest"), isCategory("policy", /ID nativ/));
    assert.equal(hub.schedules.get(s.id).status, "DRAFT");
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "PENDING_USER_SETUP");

    await assert.rejects(cmd(hub, "schedule.link_native", { scheduleId: s.id, nativeId: "ab" }), isCategory("validation"));
    const linked = (await cmd(hub, "schedule.link_native", { scheduleId: s.id, nativeId: "  claude-task-7f3a  ", nativeLabel: "Daily commit digest" })).result;
    assert.equal(linked.state, "LINKED");
    assert.equal(linked.nativeId, "claude-task-7f3a");
    assert.equal(linked.nativeLabel, "Daily commit digest");
    assert.equal(linked.lastSeenAt, "2026-09-30T10:02:00.000Z");
    assert.equal(hub.schedules.get(s.id).status, "DRAFT", "linking alone does not activate");
    await assert.rejects(cmd(hub, "schedule.link_native", { scheduleId: s.id, nativeId: "claude-task-other" }), isCategory("conflict"));

    assert.equal((await transition(hub, s.id, "ACTIVE", "turn on the digest")).status, "ACTIVE");
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "ACTIVE");

    clock.set("2026-10-01T07:30:00.000Z");
    assert.deepEqual(await hub.schedules.tick(viaScheduleChannel(hub)), [], "the local runner never executes native schedules");
    assert.equal(hub.schedules.runs(s.id).length, 0);

    assert.equal((await transition(hub, s.id, "PAUSED", "vacation")).status, "PAUSED");
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "PAUSED");
    assert.equal((await transition(hub, s.id, "RETIRED", "digest no longer needed")).status, "RETIRED");
    refs = hub.schedules.refsOf(s.id);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].state, "DETACHED");
    assert.equal(refs[0].nativeId, "claude-task-7f3a", "the native id is kept for the record");
    assert.equal(hub.schedules.list().find((x) => x.id === s.id).nativeRef ?? null, null);
    await assert.rejects(cmd(hub, "schedule.link_native", { scheduleId: s.id, nativeId: "claude-task-late" }), isCategory("conflict"));

    const refPath = eventsOf(hub, "schedule.native_ref").filter((e) => e.scopeId === s.id).map((e) => `${e.payload.from}->${e.payload.to}`);
    assert.deepEqual(refPath, ["PROPOSED->PENDING_USER_SETUP", "PENDING_USER_SETUP->LINKED", "LINKED->ACTIVE", "ACTIVE->PAUSED", "PAUSED->DETACHED"]);
    assert.equal(promptRuns(t), promptRunsBefore, "no Claude prompt run was started");
  } finally { await t.cleanup(); }
});

test("M01-SCH10 an OPENCLAW schedule can never be activated, even with a linked native id", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const s = await create(hub, { name: "Legacy OpenClaw sweep", cadence: "weekdays 09:00", backend: "OPENCLAW", action: { command: "openclaw.sweep" } });
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "PENDING_USER_SETUP");
    await assert.rejects(transition(hub, s.id, "ACTIVE", "enable the sweep"), isCategory("policy", /OpenClaw/));

    await cmd(hub, "schedule.link_native", { scheduleId: s.id, nativeId: "openclaw-job-42" });
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "LINKED");
    await assert.rejects(transition(hub, s.id, "ACTIVE", "enable the sweep"), isCategory("policy", /OpenClaw/));
    assert.equal(hub.schedules.get(s.id).status, "DRAFT");
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "LINKED", "the reference is not promoted either");

    const setup = hub.schedules.nativeSetupInstructions(s.id);
    assert.equal(setup.backend, "OPENCLAW");
    assert.match(setup.steps.join(" "), /retras/);

    assert.equal((await transition(hub, s.id, "RETIRED", "OpenClaw is retired in V2")).status, "RETIRED");
    assert.equal(hub.schedules.refsOf(s.id)[0].state, "DETACHED");
    await assert.rejects(transition(hub, s.id, "ACTIVE", "enable the sweep"), isCategory("task"), "RETIRED is terminal");
  } finally { await t.cleanup(); }
});

// ---------- local runner ----------
test("M01-SCH11 local runner: one run per slot, no catch-up on activation, one catch-up after a gap", async () => {
  const clock = mutableClock("2026-09-30T10:02:00.000Z");
  const t = await makeTestHub({ clock });
  try {
    const { hub } = t;
    const exec = viaScheduleChannel(hub);
    const s = await create(hub, { name: "Briefing every five minutes", cadence: "every 5m", action: { command: "briefing.generate", payload: { hours: 24 } } });
    assert.equal(s.nextRunAt, "2026-09-30T10:05:00.000Z");

    clock.set("2026-09-30T10:13:00.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [], "DRAFT schedules never run");

    const active = await transition(hub, s.id, "ACTIVE", "start the briefing routine");
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.lastRunAt, "2026-09-30T10:10:00.000Z", "activation marks the current slot as handled");
    assert.equal(active.nextRunAt, "2026-09-30T10:15:00.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [], "activation does not fire an immediate catch-up");
    assert.equal(hub.schedules.runs(s.id).length, 0);

    clock.set("2026-09-30T10:15:30.000Z");
    const [a, b] = await Promise.all([hub.schedules.tick(exec), hub.schedules.tick(exec)]);
    assert.deepEqual([...a, ...b], [{ scheduleId: s.id, slot: "2026-09-30T10:15:00.000Z", status: "completed" }], "overlapping ticks claim the slot once");
    assert.deepEqual(await hub.schedules.tick(exec), [], "a second tick in the same slot does nothing");
    assert.deepEqual(slotCounts(hub, s.id), [["2026-09-30T10:15:00.000Z", 1]]);

    const [run] = hub.schedules.runs(s.id);
    assert.equal(run.status, "completed");
    assert.equal(run.backend, "LOCAL_HUB");
    assert.equal(run.startedAt, "2026-09-30T10:15:30.000Z");
    assert.ok(run.finishedAt);
    assert.match(run.result.file, /briefing-.*\.md$/);
    assert.ok(fs.existsSync(path.resolve(t.projectDir, run.result.file)), "the briefing was written");
    const correlationId = `sch:${s.id}:2026-09-30T10:15:00.000Z`;
    const logged = hub.commands.list({ type: "briefing.generate" });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, "executed");
    assert.equal(logged[0].channel, "schedule");
    assert.equal(logged[0].actor, "scheduler");
    assert.equal(logged[0].correlationId, correlationId);
    assert.equal(eventsOf(hub, "briefing.generated").filter((e) => e.correlationId === correlationId).length, 1);
    assert.equal(eventsOf(hub, "schedule.ran").filter((e) => e.scopeId === s.id).length, 1);

    clock.set("2026-09-30T10:47:10.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [{ scheduleId: s.id, slot: "2026-09-30T10:45:00.000Z", status: "completed" }], "six missed slots: one catch-up for the latest");
    assert.deepEqual(await hub.schedules.tick(exec), []);
    assert.deepEqual(slotCounts(hub, s.id), [["2026-09-30T10:15:00.000Z", 1], ["2026-09-30T10:45:00.000Z", 1]]);
    assert.equal(hub.commands.list({ type: "briefing.generate" }).length, 2, "no burst of missed runs");
    const after = hub.schedules.get(s.id);
    assert.equal(after.lastRunAt, "2026-09-30T10:45:00.000Z");
    assert.equal(after.lastResult, "completed");
    assert.equal(after.nextRunAt, "2026-09-30T10:50:00.000Z");

    // The Hub's own scheduler wiring (hub.mjs extraTick) dispatches on the schedule channel, one pass at a time.
    clock.set("2026-09-30T10:50:30.000Z");
    hub.scheduler.tick();
    hub.scheduler.tick();
    await waitFor(() => hub.schedules.get(s.id).lastRunAt === "2026-09-30T10:50:00.000Z", 10000);
    assert.deepEqual(slotCounts(hub, s.id).at(-1), ["2026-09-30T10:50:00.000Z", 1]);
    assert.equal(hub.commands.list({ type: "briefing.generate" }).filter((c) => c.channel === "schedule" && c.actor === "scheduler").length, 3);
  } finally { await t.cleanup(); }
});

test("M01-SCH12 a failing scheduled command records status failed; pausing stops runs and resuming does not replay missed slots", async () => {
  const clock = mutableClock("2026-09-30T09:58:00.000Z");
  const t = await makeTestHub({ clock });
  try {
    const { hub } = t;
    const exec = viaScheduleChannel(hub);
    const s = await create(hub, { name: "Backup of a removed project", cadence: "every 10m", action: { command: "backup.run", payload: { projectId: "prj_missing_for_schedule_test" } } });
    await transition(hub, s.id, "ACTIVE", "enable the backup routine");

    clock.set("2026-09-30T10:00:05.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [{ scheduleId: s.id, slot: "2026-09-30T10:00:00.000Z", status: "failed" }]);
    const [run] = hub.schedules.runs(s.id);
    assert.equal(run.status, "failed");
    assert.equal(run.result.category, "not_found");
    assert.match(run.result.error, /Project not found/);
    assert.ok(run.finishedAt);
    const failed = hub.schedules.get(s.id);
    assert.equal(failed.lastResult, "failed");
    assert.equal(failed.lastRunAt, "2026-09-30T10:00:00.000Z");
    assert.equal(failed.status, "ACTIVE", "a failed run does not change the schedule status");
    const logged = hub.commands.list({ type: "backup.run" });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, "failed");
    assert.equal(logged[0].channel, "schedule");
    assert.equal(logged[0].actor, "scheduler");
    assert.match(logged[0].error, /Project not found/);
    assert.equal(logged[0].correlationId, `sch:${s.id}:2026-09-30T10:00:00.000Z`);
    assert.equal(eventsOf(hub, "schedule.run_failed").filter((e) => e.scopeId === s.id).length, 1);
    assert.deepEqual(await hub.schedules.tick(exec), [], "a failed slot is not retried in a loop");

    await transition(hub, s.id, "PAUSED", "investigate the failure");
    clock.set("2026-09-30T10:31:00.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [], "paused schedules do not run");
    const resumed = await transition(hub, s.id, "ACTIVE", "resume after the fix");
    assert.equal(resumed.lastRunAt, "2026-09-30T10:30:00.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [], "resuming does not replay the slots missed while paused");

    clock.set("2026-09-30T10:40:00.000Z");
    assert.deepEqual(await hub.schedules.tick(exec), [{ scheduleId: s.id, slot: "2026-09-30T10:40:00.000Z", status: "failed" }]);

    clock.set("2026-09-30T10:50:01.000Z");
    const crashed = await hub.schedules.tick(() => { throw new Error("executor crashed"); });
    assert.deepEqual(crashed, [{ scheduleId: s.id, slot: "2026-09-30T10:50:00.000Z", status: "failed" }]);
    const latest = hub.schedules.runs(s.id).find((r) => r.slot === "2026-09-30T10:50:00.000Z");
    assert.deepEqual(latest.result, { error: "executor crashed", category: "internal" });
    assert.deepEqual(slotCounts(hub, s.id).map(([slot, n]) => `${slot}x${n}`),
      ["2026-09-30T10:00:00.000Zx1", "2026-09-30T10:40:00.000Zx1", "2026-09-30T10:50:00.000Zx1"]);
  } finally { await t.cleanup(); }
});

// ---------- computer runtime ----------
test("M01-CMP01 computer plan: primary is the first usable env; order is structured_api, dom, visual; unusable envs are excluded", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const plan = hub.computer.plan("desktop-app-task");
    assert.equal(plan.useCase.id, "desktop-app-task");
    assert.equal(plan.primary.id, "anthropic.claude_computer_use");
    assert.equal(plan.primary.status, "assisted");
    assert.deepEqual(plan.fallbacks.map((e) => e.id), ["openai.codex_computer_use"]);
    assert.deepEqual(plan.excluded.map((e) => [e.id, e.status]),
      [["hub.desktop_bridge", "planned"], ["openai.dots_cloud_computer", "planned"], ["agent_zero.docker", "blocked"]]);
    for (const e of plan.excluded) assert.ok(e.reason.length > 0, `${e.id} has a reason`);
    assert.match(plan.rule, /API/);

    for (const useCase of hub.computer.useCases()) {
      const p = hub.computer.plan(useCase.id);
      const chosen = [p.primary, ...p.fallbacks].filter(Boolean);
      const pref = (id) => useCase.preference.indexOf(id);
      for (const env of chosen) assert.ok(USABLE.has(env.status), `${useCase.id}: ${env.id} is usable`);
      for (const env of p.excluded) assert.ok(!USABLE.has(env.status), `${useCase.id}: ${env.id} is excluded`);
      for (let i = 1; i < chosen.length; i += 1) {
        const [x, y] = [chosen[i - 1], chosen[i]];
        assert.ok(CONTROL_RANK[x.controlMode] < CONTROL_RANK[y.controlMode] || (x.controlMode === y.controlMode && pref(x.id) < pref(y.id)),
          `${useCase.id}: ${x.id} (${x.controlMode}) must precede ${y.id} (${y.controlMode})`);
      }
      const known = useCase.preference.filter((id) => hub.computer.get(id));
      assert.deepEqual([...chosen.map((e) => e.id), ...p.excluded.map((e) => e.id)].sort(), [...known].sort(), `${useCase.id}: every env is either chosen or excluded`);
    }
    assert.equal(hub.computer.plan("local-preview-check").primary.id, "hub.preview_http", "a structured API beats the browser");
    assert.ok(hub.computer.plan("web-app-e2e-test").excluded.some((e) => e.id === "hub.playwright" && e.status === "blocked"));
    assert.throws(() => hub.computer.plan("no-such-use-case"), isCategory("not_found"));

    // Control mode outranks the configured preference order.
    hub.db.prepare("UPDATE computer_environments SET control_mode = 'dom' WHERE id = 'openai.codex_computer_use'").run();
    assert.equal(hub.computer.plan("desktop-app-task").primary.id, "openai.codex_computer_use");
    hub.db.prepare("UPDATE computer_environments SET status = 'available', control_mode = 'structured_api' WHERE id = 'hub.desktop_bridge'").run();
    const reordered = hub.computer.plan("desktop-app-task");
    assert.deepEqual([reordered.primary, ...reordered.fallbacks].map((e) => `${e.id}:${e.controlMode}`),
      ["hub.desktop_bridge:structured_api", "openai.codex_computer_use:dom", "anthropic.claude_computer_use:visual"]);
    assert.deepEqual(reordered.excluded.map((e) => e.id), ["openai.dots_cloud_computer", "agent_zero.docker"]);
    hub.computer.seed();
    assert.equal(hub.computer.plan("desktop-app-task").primary.id, "anthropic.claude_computer_use", "re-seeding restores the configured registry");
  } finally { await t.cleanup(); }
});

test("M01-CMP02 computer locks: one controller per environment and per window; release frees both", async () => {
  const clock = mutableClock("2026-09-30T10:02:00.000Z");
  const t = await makeTestHub({ clock });
  try {
    const { hub } = t;
    const first = (await cmd(hub, "computer.acquire", { envId: "anthropic.claude_computer_use", holder: "claude:desktop-session", windowRef: "Notepad - Notes.txt", ttlSeconds: 600 })).result;
    assert.equal(first.mode, "assisted");
    assert.equal(first.envLease.resource, "computer:anthropic.claude_computer_use");
    assert.equal(first.envLease.holder, "claude:desktop-session");
    assert.equal(first.envLease.status, "active");
    assert.equal(first.envLease.expires_at, "2026-09-30T10:12:00.000Z");
    assert.equal(first.windowLease.resource, "window:notepad - notes.txt");
    assert.deepEqual(hub.computer.locks().map((l) => `${l.resource}@${l.holder}`).sort(),
      ["computer:anthropic.claude_computer_use@claude:desktop-session", "window:notepad - notes.txt@claude:desktop-session"]);
    const acquired = eventsOf(hub, "computer.acquired");
    assert.equal(acquired.length, 1);
    assert.equal(acquired[0].payload.mode, "assisted");
    assert.equal(acquired[0].payload.leaseId, first.envLease.id);

    await assert.rejects(cmd(hub, "computer.acquire", { envId: "anthropic.claude_computer_use", holder: "codex:desktop-session" }), (error) => {
      isCategory("conflict")(error);
      assert.equal(error.details.holder, "claude:desktop-session");
      assert.equal(error.details.leaseId, first.envLease.id);
      return true;
    }, "a second holder on the same environment conflicts");

    await assert.rejects(cmd(hub, "computer.acquire", { envId: "openai.codex_computer_use", holder: "codex:desktop-session", windowRef: "  NOTEPAD -   notes.txt " }), (error) => {
      isCategory("conflict")(error);
      assert.equal(error.details.leaseId, first.windowLease.id);
      return true;
    }, "the same window on another environment conflicts");
    assert.equal(hub.leases.current("computer:openai.codex_computer_use"), null, "the refused acquisition leaves no environment lock behind");
    assert.equal(hub.computer.locks().length, 2);

    const other = (await cmd(hub, "computer.acquire", { envId: "openai.codex_computer_use", holder: "codex:desktop-session", windowRef: "Calculator" })).result;
    assert.equal(other.mode, "assisted");
    assert.equal(hub.computer.locks().length, 4);

    assert.equal((await cmd(hub, "computer.release", { leaseIds: [first.envLease.id, first.windowLease.id], reason: "task done" })).result, true);
    assert.equal(hub.leases.current("computer:anthropic.claude_computer_use"), null);
    assert.equal(hub.leases.current("window:notepad - notes.txt"), null);
    for (const id of [first.envLease.id, first.windowLease.id]) {
      const row = hub.db.prepare("SELECT status, release_reason FROM leases WHERE id = ?").get(id);
      assert.deepEqual({ ...row }, { status: "released", release_reason: "task done" });
    }
    assert.equal(eventsOf(hub, "computer.released").length, 1);
    const again = (await cmd(hub, "computer.acquire", { envId: "anthropic.claude_computer_use", holder: "claude:second-session", windowRef: "Notepad - Notes.txt" })).result;
    assert.equal(again.envLease.holder, "claude:second-session");
    assert.deepEqual(hub.computer.locks().map((l) => l.resource).sort(),
      ["computer:anthropic.claude_computer_use", "computer:openai.codex_computer_use", "window:calculator", "window:notepad - notes.txt"]);

    clock.set("2026-09-30T10:20:00.000Z");
    const takeover = (await cmd(hub, "computer.acquire", { envId: "openai.codex_computer_use", holder: "codex:new-session" })).result;
    assert.equal(takeover.envLease.holder, "codex:new-session", "an expired lock no longer blocks another controller");
    const expired = hub.db.prepare("SELECT status, release_reason FROM leases WHERE id = ?").get(other.envLease.id);
    assert.deepEqual({ ...expired }, { status: "released", release_reason: "expired without run" });
  } finally { await t.cleanup(); }
});

test("M01-CMP03 computer.acquire refuses blocked, planned and unknown environments; Hub visual control needs approval", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "hub.playwright", holder: "hub:e2e-runner" }), isCategory("policy", /blocked/));
    assert.throws(() => hub.bus.transaction(() => hub.computer.acquire({ envId: "hub.playwright", holder: "hub:e2e-runner" })), isCategory("policy"));
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "agent_zero.docker", holder: "hub:agent-zero" }), isCategory("policy", /blocked/));
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "hub.desktop_bridge", holder: "hub:desktop" }), isCategory("policy", /planned/));
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "no.such_env", holder: "hub:desktop" }), isCategory("not_found"));
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "anthropic.claude_computer_use", holder: "ab" }), isCategory("validation"));
    assert.equal(hub.computer.locks().length, 0);
    assert.equal(eventsOf(hub, "computer.acquired").length, 0);

    hub.db.prepare("UPDATE computer_environments SET status = 'available' WHERE id = 'hub.desktop_bridge'").run();
    await assert.rejects(cmd(hub, "computer.acquire", { envId: "hub.desktop_bridge", holder: "hub:desktop" }), (error) => {
      isCategory("gate")(error);
      assert.equal(error.details.policy.actionKind, "computer.visual_control");
      assert.equal(error.details.policy.decision, "ask");
      return true;
    }, "Hub-driven visual control is ALWAYS_ASK");
    assert.equal(hub.computer.locks().length, 0);
  } finally { await t.cleanup(); }
});
