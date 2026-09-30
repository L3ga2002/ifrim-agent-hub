// Pure scene model for the Lega stage (full-screen "JARVIS" view). No DOM, no React — covered by v2/tests/m03-stage.test.mjs.
// Every node comes from real Hub state (departments, roles, missions, runs, approvals); only the "ambient" plexus is decorative
// and is labelled as such, so the picture never invents agents that are not working.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Deterministic PRNG so the layout is stable between renders (no jumping nodes). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** i-th of n points evenly spread on a sphere (Fibonacci lattice), radius r. */
export function spherePoint(i, n, r = 1) {
  const y = n <= 1 ? 0 : 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * i;
  return { x: Math.cos(theta) * rad * r, y: y * r, z: Math.sin(theta) * rad * r };
}

const hashString = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * @param {object|null} hub  /api/state projection
 * @returns {{ nodes: Array<{id,kind,label,x,y,z,r,tone,pulse,ambient?}>, links: Array<[number, number, number]>, counts: object }}
 */
export function buildStageGraph(hub, { ambient = 140, seed = 7 } = {}) {
  const nodes = [];
  const links = [];
  const add = (node) => { nodes.push(node); return nodes.length - 1; };
  const core = add({ id: "core", kind: "core", label: "Lega", x: 0, y: 0, z: 0, r: 10, tone: "accent", pulse: 1 });

  const departments = (hub?.company?.departments || []).slice(0, 16);
  departments.forEach((d, i) => {
    const p = spherePoint(i, Math.max(departments.length, 2), 1);
    const active = d.status === "active";
    const di = add({ id: `dept:${d.key}`, kind: "department", label: d.name, ...p, r: active ? 6 : 4, tone: active ? "accent" : "dim", pulse: active ? 0.5 : 0.1 });
    links.push([core, di, active ? 0.8 : 0.25]);
    const rand = mulberry32(hashString(d.key) ^ seed);
    const roles = Math.min(12, Number(d.roles) || 0);
    for (let j = 0; j < roles; j += 1) {
      const q = spherePoint(j, Math.max(roles, 2), 0.16 + rand() * 0.06);
      const ri = add({ id: `role:${d.key}:${j}`, kind: "role", label: "", x: p.x + q.x, y: p.y + q.y, z: p.z + q.z, r: 2, tone: active ? "accent" : "dim", pulse: 0 });
      links.push([di, ri, 0.35]);
    }
  });

  const missions = (hub?.missions || []).slice(0, 8);
  missions.forEach((m, i) => {
    const p = spherePoint(i, Math.max(missions.length, 2), 0.55);
    const attention = ["BLOCKED", "FAILED", "NEEDS_ATTENTION", "AT_RISK"].includes(String(m.status || "").toUpperCase());
    const mi = add({ id: `mission:${m.id}`, kind: "mission", label: m.title || "Misiune", ...p, r: 5, tone: attention ? "approval" : "ok", pulse: 0.3 });
    links.push([core, mi, 0.6]);
  });

  const runs = (hub?.activeRuns || []).slice(0, 8);
  runs.forEach((run, i) => {
    const p = spherePoint(i, Math.max(runs.length, 2), 0.3);
    const ri = add({ id: `run:${run.runId}`, kind: "run", label: run.provider === "claude" ? "Claude" : "Codex", ...p, r: 5, tone: "accent", pulse: run.phase === "streaming" ? 1 : 0.6 });
    links.push([core, ri, 1]);
  });

  const approvals = (hub?.approvals || []).slice(0, 6);
  approvals.forEach((a, i) => {
    const p = spherePoint(i, Math.max(approvals.length, 2), 0.42);
    const ai = add({ id: `approval:${a.id}`, kind: "approval", label: a.actionKind, x: p.x, y: p.y + 0.05, z: p.z, r: 5, tone: "approval", pulse: 0.9 });
    links.push([core, ai, 0.9]);
  });

  // Decorative plexus (labelled ambient): gives the "living network" look without pretending to be work.
  const rand = mulberry32(seed);
  for (let i = 0; i < ambient; i += 1) {
    const p = spherePoint(i, ambient, 0.7 + rand() * 0.75);
    add({ id: `ambient:${i}`, kind: "ambient", label: "", x: p.x + (rand() - 0.5) * 0.08, y: p.y + (rand() - 0.5) * 0.08, z: p.z + (rand() - 0.5) * 0.08, r: 1.2, tone: "accent", pulse: 0, ambient: true });
  }

  return { nodes, links, counts: { departments: departments.length, roles: nodes.filter((n) => n.kind === "role").length, missions: missions.length, runs: runs.length, approvals: approvals.length, ambient } };
}

/** Rotate around Y (yaw) then X (pitch) and project with perspective; returns screen coords and depth. */
export function project(node, { yaw = 0, pitch = 0.25, scale = 300, cx = 0, cy = 0, distance = 3.2 } = {}) {
  const cosY = Math.cos(yaw); const sinY = Math.sin(yaw);
  const x1 = node.x * cosY - node.z * sinY;
  const z1 = node.x * sinY + node.z * cosY;
  const cosX = Math.cos(pitch); const sinX = Math.sin(pitch);
  const y2 = node.y * cosX - z1 * sinX;
  const z2 = node.y * sinX + z1 * cosX;
  const f = distance / (distance + z2);
  return { sx: cx + x1 * scale * f, sy: cy + y2 * scale * f, depth: z2, f };
}
