// Milestone 06 — pure UI logic: Lega's replies are built only from returned data, the plan presented is the only one a
// confirmation may name, the face geometry keeps one particle index across shapes (real morph targets) with the jaw only on
// the lower face, and the mouth follows the PLAYED audio level (closed when silent or muted).
import test from "node:test";
import assert from "node:assert/strict";
import { replyFor, cockpitSummary, faceCommand, presentedFrom, missionGraph, pushLayout } from "../web/src/lib/cockpitLogic.js";
import { buildMorphTargets, buildFaceLines, mouthFollower, stepWeights, facePoint, SHAPES } from "../web/src/lib/faceGeometry.js";

const cockpit = { project: { name: "Demo", kind: "test" }, state: { code: "PLAN_READY", label: "Plan pregătit" }, running: { missions: [], runs: [] }, readyForReview: [], blocked: [], done: [],
  open: [{ missionId: "m1", title: "Fix" }], next: { recommended: { text: "Vezi și confirmă planul pentru „Fix”" } }, isolation: { blockers: [] }, missing: [] };

test("M06-UI-01 replies come from the data returned: no invented progress, refusals and clarifications are stated", () => {
  const s = cockpitSummary(cockpit);
  assert.match(s, /Demo: plan pregătit/); assert.match(s, /Următorul pas: Vezi și confirmă/);
  assert.ok(!/%/.test(s), "no percentage");
  const reply = replyFor({ resolved: { steps: [{ intent: "status" }], refused: [{ reason: "O transcriere făcută de provider nu poate confirma" }], clarification: null },
    results: [{ explain: { runs: [], missions: [], idle: true } }] });
  assert.match(reply, /Nu: O transcriere/); assert.match(reply, /nu rulează nimic/);
  const clar = replyFor({ resolved: { steps: [{ intent: "open_project" }], refused: [], clarification: { question: "La care proiect te referi: A sau B?" } }, results: [{}] });
  assert.match(clar, /La care proiect/);
  assert.match(replyFor({ resolved: { steps: [{ intent: "unknown" }], refused: [] }, results: [{}] }), /Nu am înțeles/);
  assert.match(replyFor({ resolved: { steps: [{ intent: "face_show" }], refused: [] }, results: [{}] }), /nu chipul cuiva/);
});

test("M06-UI-02 only the PROPOSED plan on screen can be named by a confirmation; face commands stay local", () => {
  assert.deepEqual(presentedFrom({ id: "env1", status: "PROPOSED", nonce: "n", envelopeHash: "h" }), { envelopeId: "env1", nonce: "n", hash: "h" });
  assert.equal(presentedFrom({ id: "env1", status: "ACTIVE", nonce: "n", envelopeHash: "h" }), null);
  assert.equal(presentedFrom(null), null);
  assert.deepEqual(faceCommand([{ intent: "face_show" }]), { shape: "FACE", hidden: false });
  assert.deepEqual(faceCommand([{ intent: "show_company" }]), { shape: "GRAPH", hidden: false });
  assert.equal(faceCommand([{ intent: "status" }]), null);
  let h = []; for (let i = 0; i < 30; i += 1) h = pushLayout(h, { i });
  assert.equal(h.length, 20, "bounded undo history");
});

test("M06-UI-03 morph targets share the particle index; jaw weights only on the lower face; features are traced", () => {
  const nodes = [{ x: 0, y: 0, z: 0, kind: "core", r: 8 }, { x: 0.6, y: 0.1, z: 0.2, kind: "dept", r: 4 }];
  const t = buildMorphTargets(1500, { nodes });
  for (const k of ["core", "face", "graph"]) assert.equal(t[k].length, 1500 * 3, k);
  const again = buildMorphTargets(1500, { nodes });
  assert.equal(again.face[900], t.face[900], "deterministic: particle i is always the same particle");
  let upperJaw = 0; let lowerJaw = 0; let features = 0;
  for (let i = 0; i < t.count; i += 1) { if (t.jaw[i] > 0.1) { if (t.face[i * 3 + 1] > -0.25) upperJaw += 1; else lowerJaw += 1; } if (t.feature[i] > 0) features += 1; }
  assert.equal(upperJaw, 0, "nothing above the mouth moves with the jaw");
  assert.ok(lowerJaw > 50);
  assert.ok(features / t.count > 0.3 && features / t.count < 0.45, `features ${features}`);
  const eye = facePoint(5); assert.equal(eye.length, 5);
  const lines = buildFaceLines();
  assert.ok(lines.positions.length / 6 > 500, "a real wireframe, not a flat image");
  assert.equal(lines.positions.length / 3, lines.jaw.length);
});

test("M06-UI-04 transitions are interruptible blends; the mouth follows the played level and closes without audio", () => {
  let w = [1, 0, 0];
  for (let i = 0; i < 15; i += 1) w = stepWeights(w, SHAPES.FACE, 1 / 60);
  assert.ok(w[1] > 0.2 && w[1] < 0.9, "half way");
  for (let i = 0; i < 10; i += 1) w = stepWeights(w, SHAPES.GRAPH, 1 / 60);
  assert.ok(w[0] > 0 && w[1] > 0 && w[2] > 0, "interrupted mid-way: the new target starts from the current blend, no jump");
  assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  const m = mouthFollower();
  const speaking = [0.6, 0.6, 0.6, 0.6].map((l) => m(l));
  assert.ok(speaking[3] > 0.3);
  let v = 0; for (let i = 0; i < 60; i += 1) v = m(0);
  assert.equal(v, 0, "no audio → mouth closed");
  m(0.9); assert.ok(m(0.9, { muted: true }) < m(0.9) + 1, "muted level is treated as silence");
  const m2 = mouthFollower(); for (let i = 0; i < 60; i += 1) v = m2(0.9, { muted: true });
  assert.equal(v, 0, "a muted Lega never moves its mouth");
});

test("M06-UI-05 the execution graph shows where each stage ACTUALLY ran (from evidence), never a global environment badge", () => {
  const view = { factory: { approvedSpecVersion: 1, stage: "REVIEWING" }, runs: [{ provider: "codex", status: "completed", environment: "wsl-runner" }, { provider: "claude", status: "running" }],
    evidence: [{ stage: "BASELINE", status: "FAIL", runner: "codex-sandbox@wsl-runner", stale: false }, { stage: "CHECKING", status: "PASS", runner: "codex-sandbox@wsl-runner", stale: false }] };
  const g = Object.fromEntries(missionGraph(view).map((n) => [n.key, n]));
  assert.equal(g.writer.where, "ifrim-runner"); assert.equal(g.writer.status, "DONE");
  assert.equal(g.checks.where, "ifrim-runner"); assert.equal(g.checks.status, "DONE");
  assert.match(g.review.where, /Windows/, "the reviewer is not given the environment's badge");
  assert.equal(g.review.status, "RUNNING");
  assert.equal(g.preview.status, "WAITING"); assert.equal(g.preview.where, "—");
});
