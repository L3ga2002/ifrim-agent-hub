import test from "node:test";
import assert from "node:assert/strict";
import { buildStageGraph, project, spherePoint } from "../web/src/lib/stageGraph.js";

const hub = {
  company: { departments: [{ key: "exec", name: "Executive", status: "active", roles: 1 }, { key: "eng", name: "Engineering", status: "active", roles: 7 }, { key: "ops", name: "Operations", status: "planned", roles: 0 }] },
  missions: [{ id: "m1", title: "Pagină de contact", status: "NEEDS_ATTENTION" }],
  activeRuns: [{ runId: "r1", provider: "codex", phase: "streaming" }],
  approvals: [{ id: "a1", actionKind: "lega.run_request" }],
};

test("M03-STAGE-01 the stage network comes from real Hub state; only the labelled ambient plexus is decorative", () => {
  const g = buildStageGraph(hub, { ambient: 20 });
  assert.deepEqual(g.counts, { departments: 3, roles: 8, missions: 1, runs: 1, approvals: 1, ambient: 20 });
  const real = g.nodes.filter((n) => !n.ambient);
  assert.equal(real.length, 1 + 3 + 8 + 1 + 1 + 1, "core + departments + roles + missions + runs + approvals");
  assert.ok(g.nodes.filter((n) => n.ambient).every((n) => n.kind === "ambient" && !n.label), "decorative nodes carry no label");
  assert.equal(g.nodes.find((n) => n.kind === "approval").tone, "approval", "approvals are amber");
  assert.equal(g.nodes.find((n) => n.kind === "mission").tone, "approval", "a mission needing attention is amber");
  assert.equal(g.nodes.find((n) => n.id === "dept:ops").tone, "dim", "a planned department is dim");
  for (const [i, j] of g.links) assert.ok(g.nodes[i] && g.nodes[j]);
  // No invented work: without runs there are no run nodes.
  assert.equal(buildStageGraph({ ...hub, activeRuns: [] }, { ambient: 0 }).nodes.filter((n) => n.kind === "run").length, 0);
  assert.equal(buildStageGraph(null, { ambient: 0 }).nodes.length, 1, "no state: only the core");
});

test("M03-STAGE-02 layout is deterministic and finite; projection is stable", () => {
  const a = buildStageGraph(hub); const b = buildStageGraph(hub);
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y, n.z]), b.nodes.map((n) => [n.x, n.y, n.z]));
  for (const n of a.nodes) for (const v of [n.x, n.y, n.z]) assert.ok(Number.isFinite(v));
  const p = spherePoint(0, 1, 2);
  assert.ok(Number.isFinite(p.x + p.y + p.z));
  const proj = project({ x: 0, y: 0, z: 0 }, { cx: 100, cy: 50, scale: 200 });
  assert.deepEqual([proj.sx, proj.sy, proj.f], [100, 50, 1]);
});
