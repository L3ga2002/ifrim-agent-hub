// Lega's original abstract face (M06 §14): procedural geometry, no portrait, no asset. Three target shapes share ONE particle
// index space, so particle i is the same particle in the core, the face and the graph: transitions are real morphs (weighted
// sums of per-particle targets, i.e. morph targets), interruptible from wherever they are. Pure functions, testable in Node.

/** Deterministic pseudo-random in [0,1) for index i and channel k (stable across reloads). */
export function hash01(i, k = 0) {
  let x = (i + 1) * 374761393 + (k + 1) * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return ((x >>> 0) % 1000003) / 1000003;
}
const gauss = (x, mu, s) => Math.exp(-(((x - mu) / s) ** 2));
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Core: concentric shells (Fibonacci sphere per shell). */
function corePoint(i, n) {
  const shell = i % 3;
  const k = Math.floor(i / 3); const m = Math.ceil(n / 3);
  const y = 1 - (2 * (k + 0.5)) / m;
  const r = Math.sqrt(1 - y * y);
  const phi = k * Math.PI * (3 - Math.sqrt(5)) + shell * 0.7;
  const R = [0.34, 0.52, 0.7][shell] * (1 + (hash01(i, 1) - 0.5) * 0.04);
  return [Math.cos(phi) * r * R, y * R, Math.sin(phi) * r * R];
}

/**
 * The head surface at (u around the vertical axis, v height in [-1,1]); +z is the front. Proportions and features (brow,
 * eye sockets, nose, cheekbones, lips, chin) are displacements of an ellipsoid, with a subtle asymmetry. Returns
 * [x, y, z, jaw] where jaw (0..1) is how much the point follows the mouth/jaw opening.
 */
export function headSurface(u, v, { asym = 0.012 } = {}) {
  const front = Math.max(0, Math.cos(u));
  const side = Math.sin(u);
  let width = 0.6 * Math.sqrt(Math.max(0, 1 - v * v));
  if (v < -0.25) width *= 0.78 + 0.22 * smooth(-1, -0.25, v);
  if (v > 0.55) width *= 0.92 + 0.08 * smooth(1, 0.55, v);
  const depth = 0.68 * Math.sqrt(Math.max(0, 1 - v * v)) * (v < -0.3 ? 0.85 + 0.15 * smooth(-1, -0.3, v) : 1);
  let x = width * side;
  let z = depth * Math.cos(u);
  const y = v * 0.95;
  // Features live on the front only.
  const uu = u > Math.PI ? u - 2 * Math.PI : u;
  let bump = 0;
  bump += 0.035 * gauss(v, 0.3, 0.06) * gauss(Math.abs(uu), 0.32, 0.3); // brow ridge
  bump -= 0.07 * gauss(v, 0.17, 0.07) * gauss(Math.abs(uu), 0.36, 0.13); // eye sockets
  bump += 0.13 * gauss(uu, 0, 0.09) * smooth(0.28, 0.02, v) * smooth(-0.24, -0.08, v); // nose ridge, growing downward
  bump += 0.03 * gauss(v, 0.0, 0.1) * gauss(Math.abs(uu), 0.62, 0.15); // cheekbones
  bump += 0.03 * gauss(v, -0.33, 0.035) * gauss(uu, 0, 0.32); // lips
  bump -= 0.02 * gauss(v, -0.375, 0.012) * gauss(uu, 0, 0.3); // mouth line
  bump += 0.04 * gauss(v, -0.66, 0.08) * gauss(uu, 0, 0.25); // chin
  bump *= front;
  bump *= 1 + asym * Math.sign(uu); // imperfect symmetry, subtle
  const nx = Math.sin(u); const nz = Math.cos(u);
  x += nx * bump; z += nz * bump;
  // Jaw/lower lip follow the opening; upper face does not.
  const jaw = front > 0.25 ? smooth(-0.36, -0.42, v) * smooth(-1.0, -0.8, v) : 0;
  const lowerLip = front > 0.4 ? gauss(v, -0.4, 0.03) * gauss(uu, 0, 0.3) : 0;
  return [x, y, z, Math.min(1, Math.max(jaw, lowerLip))];
}

/**
 * Face: about 40% of the particles trace the features (eye contours, brows, nose ridge and nostrils, lips, jawline/chin, the
 * silhouette) so the face is legible; the rest cover the head, denser on the front. Returns [x, y, z, jaw, feature 0..1].
 */
export function facePoint(i) {
  const r = hash01(i, 4); const t = hash01(i, 11); const side = hash01(i, 10) < 0.5 ? -1 : 1;
  const on = (u, v, feat) => [...headSurface(u, v), feat];
  if (r < 0.09) { const a = t * 2 * Math.PI; return on(side * 0.36 + Math.cos(a) * 0.13, 0.165 + Math.sin(a) * 0.045, 1); }
  if (r < 0.14) return on(side * (0.17 + t * 0.36), 0.268 + 0.035 * Math.sin(t * Math.PI), 0.85);
  if (r < 0.19) return t < 0.72 ? on((hash01(i, 12) - 0.5) * 0.035, 0.24 - (t / 0.72) * 0.42, 0.8) : on(side * (0.05 + 0.05 * hash01(i, 13)), -0.17, 0.8);
  if (r < 0.27) { const x = (t - 0.5); return hash01(i, 14) < 0.5 ? on(x * 0.62, -0.355 + 0.012 * Math.cos(x * Math.PI), 1) : on(x * 0.56, -0.39 - 0.018 * Math.cos(x * Math.PI), 1); }
  if (r < 0.33) return on((t - 0.5) * Math.PI * 1.05, -0.55 - 0.32 * Math.cos((t - 0.5) * Math.PI), 0.7);
  if (r < 0.38) return on(side * (Math.PI / 2) * 0.97, 0.9 - 1.75 * t, 0.6);
  const r1 = hash01(i, 2); const r2 = hash01(i, 3);
  const frontBias = hash01(i, 5) < 0.8;
  const u = frontBias ? (r1 - 0.5) * Math.PI * 1.15 : r1 * Math.PI * 2;
  const v = 1 - 2 * Math.acos(1 - 2 * r2) / Math.PI;
  return [...headSurface(u, v), 0];
}

/**
 * Graph: particles gathered around the nodes of the company graph (real departments/missions/runs from the stage graph),
 * each node a small cluster; particle i always goes to the same node (i mod nodes) at a stable offset.
 */
function graphPoint(i, nodes) {
  if (!nodes.length) return corePoint(i, 900);
  const node = nodes[i % nodes.length];
  const spread = node.kind === "core" ? 0.05 : 0.025 + (node.r || 3) * 0.003;
  return [node.x * 0.85 + (hash01(i, 5) - 0.5) * spread, node.y * 0.85 + (hash01(i, 6) - 0.5) * spread, node.z * 0.85 + (hash01(i, 7) - 0.5) * spread];
}

/**
 * Builds the three morph targets for `count` particles (Float32Arrays of xyz) plus per-particle jaw weights and seeds.
 * `nodes`: stage-graph nodes ({x,y,z,kind,r}) for the graph target.
 */
export function buildMorphTargets(count, { nodes = [] } = {}) {
  const core = new Float32Array(count * 3); const face = new Float32Array(count * 3); const graph = new Float32Array(count * 3);
  const jaw = new Float32Array(count); const seed = new Float32Array(count); const feature = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const c = corePoint(i, count); const f = facePoint(i); const g = graphPoint(i, nodes);
    core.set(c, i * 3); face.set(f.slice(0, 3), i * 3); graph.set(g, i * 3);
    jaw[i] = f[3]; seed[i] = hash01(i, 9); feature[i] = f[4];
  }
  return { count, core, face, graph, jaw, seed, feature };
}

/**
 * Face wireframe: latitude rings and meridians over the front, plus feature contours (eyes, nose ridge, lips, jawline).
 * Returns { positions: Float32Array (xyz pairs = segments), jaw: Float32Array (per vertex) }.
 */
export function buildFaceLines({ rings = 15, meridians = 13, steps = 26 } = {}) {
  const pos = []; const jaw = [];
  const seg = (a, b) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); jaw.push(a[3], b[3]); };
  for (let r = 1; r < rings; r += 1) {
    const v = 1 - (2 * r) / rings;
    for (let s = 0; s < steps; s += 1) {
      const u0 = (s / steps - 0.5) * Math.PI * 1.1; const u1 = ((s + 1) / steps - 0.5) * Math.PI * 1.1;
      seg(headSurface(u0, v), headSurface(u1, v));
    }
  }
  for (let m = 0; m < meridians; m += 1) {
    const u = (m / (meridians - 1) - 0.5) * Math.PI * 1.1;
    for (let s = 0; s < steps; s += 1) {
      const v0 = 0.95 - (1.85 * s) / steps; const v1 = 0.95 - (1.85 * (s + 1)) / steps;
      seg(headSurface(u, v0), headSurface(u, v1));
    }
  }
  const contour = (fn, n = 28) => { for (let k = 0; k < n; k += 1) seg(fn(k / n), fn((k + 1) / n)); };
  for (const sgn of [-1, 1]) contour((t) => { const a = t * 2 * Math.PI; return headSurface(sgn * 0.36 + Math.cos(a) * 0.13, 0.165 + Math.sin(a) * 0.045); });
  contour((t) => headSurface((t - 0.5) * 0.62, -0.355 + 0.012 * Math.cos((t - 0.5) * Math.PI)), 20); // upper lip
  contour((t) => headSurface((t - 0.5) * 0.56, -0.39 - 0.018 * Math.cos((t - 0.5) * Math.PI)), 20); // lower lip
  contour((t) => headSurface(0, 0.24 - t * 0.4), 12); // nose ridge
  contour((t) => headSurface((t - 0.5) * Math.PI * 1.05, -0.55 - 0.32 * Math.cos((t - 0.5) * Math.PI)), 30); // jawline
  return { positions: Float32Array.from(pos), jaw: Float32Array.from(jaw) };
}

/**
 * Mouth openness from the PLAYED audio level (0..1): attack/release smoothing, a noise floor, and zero when there is no
 * audio. It is reactive amplitude, not phonetic lip-sync.
 */
export function mouthFollower({ attack = 0.45, release = 0.18, floor = 0.04 } = {}) {
  let value = 0;
  return (level, { muted = false } = {}) => {
    const target = muted ? 0 : Math.max(0, Math.min(1, (level - floor) / (1 - floor)));
    value += (target - value) * (target > value ? attack : release);
    if (value < 0.002) value = 0;
    return value;
  };
}

/** Eases morph weights toward the target shape; returns new weights (sum 1). Interruptible: starts from the current blend. */
export function stepWeights(current, target, dt, speed = 2.2) {
  const k = 1 - Math.exp(-speed * dt);
  const next = current.map((w, i) => w + ((target === i ? 1 : 0) - w) * k);
  const sum = next.reduce((s, w) => s + w, 0) || 1;
  return next.map((w) => w / sum);
}
export const SHAPES = Object.freeze({ CORE: 0, FACE: 1, GRAPH: 2 });
