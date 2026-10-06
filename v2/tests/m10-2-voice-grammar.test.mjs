// Milestone 10.2 (U01) — the voice route's deterministic Stop grammar (domain/voice.mjs) shares the resolver's normalization and
// polite-word stripper, so the polite and extended forms stop on voice exactly as typed; the open-mic rule is unchanged (a bare
// "oprește" without the name only silences Lega), and running files or installers is refused like approving. Pure, no Hub.
// Changed expectations of older suites: none (data.test.mjs and m03-lega.test.mjs pass unchanged).
import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommand } from "../server/domain/voice.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";

const POLITE_STOPS = ["Te rog, oprește tot", "Oprește tot, te rog", "Lega, oprește tot acum", "Stop, oprește tot", "Oprește tot ce rulează", "Lega, te rog, oprește tot",
  "Te rog frumos, oprește totul", "Oprește toate", "OPREȘTE TOT!"];

test("M10.2-VG-01 polite and extended Stop forms: stop_all on voice (explicit) AND in the resolver", () => {
  for (const p of POLITE_STOPS) {
    const v = parseVoiceCommand(p, { legaPrefix: true });
    assert.equal(v.kind, "command", `${p} → ${JSON.stringify(v)}`);
    assert.equal(v.command, "stop_all", p);
    assert.equal(v.explicit, true, `${p}: the "tot" form stops even without the name (open mic)`);
    assert.equal(resolveIntent(p, {}).steps[0].intent, "stop_all", `${p} (resolver)`);
    // The voice route without the Lega prefix (voice.command) recognizes them too, except where the sentence starts with the name.
    if (!/^Lega/.test(p)) assert.equal(parseVoiceCommand(p).command, "stop_all", `${p} (voice.command)`);
  }
});

test("M10.2-VG-02 the open-mic rule is kept: a bare stop is never explicit; with the name it is addressed", () => {
  for (const bare of ["Oprește", "Stop", "Oprește.", "stop!"]) {
    const v = parseVoiceCommand(bare, { legaPrefix: true });
    assert.equal(v.command, "stop_all", bare); assert.equal(v.addressed, false, bare); assert.equal(v.explicit, false, `${bare}: only silences Lega (lega.mjs)`);
  }
  const named = parseVoiceCommand("Lega, stop", { legaPrefix: true });
  assert.deepEqual([named.command, named.addressed], ["stop_all", true]);
  // Typed "Lega, stop" gives the same result as on voice (addressed → Stop All); a bare typed "stop" does not stop everything.
  assert.equal(resolveIntent("Lega, stop", {}).steps[0].intent, "stop_all");
  assert.notEqual(resolveIntent("Stop", {}).steps[0].intent, "stop_all");
  // Without legaPrefix the name is not stripped (older contract, m03-lega).
  assert.equal(parseVoiceCommand("Lega, oprește tot").kind, "message");
  assert.equal(parseVoiceCommand("Lega, pune pe pauză", { legaPrefix: true }).command, "pause");
  assert.equal(parseVoiceCommand("pune pe pauză", { legaPrefix: true }).explicit, true);
});

test("M10.2-VG-03 forbidden words: running, executing or installing is refused like approving; older commands unchanged", () => {
  for (const p of ["Execută fișierul descărcat", "Rulează scriptul", "Instalează aplicația", "Lega, execută planul"]) {
    assert.equal(parseVoiceCommand(p, { legaPrefix: true }).kind, "refused", p);
  }
  assert.equal(parseVoiceCommand("arată-mi aprobările").command, "show_approvals");
  assert.equal(parseVoiceCommand("aprobă și publică").kind, "refused");
  assert.equal(parseVoiceCommand("verifică testele pentru modulul de backup").kind, "message");
  assert.equal(parseVoiceCommand("pauză").command, "pause");
  assert.equal(parseVoiceCommand("taci").command, "mute");
  assert.equal(parseVoiceCommand("").kind, "empty");
  // The resolver refuses the same request with its reason (never a project or an app).
  const r = resolveIntent("Execută fișierul descărcat", {});
  assert.equal(r.steps[0].intent, "refuse_execute");
  assert.ok(r.refused.length);
});
