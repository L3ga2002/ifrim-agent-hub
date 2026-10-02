import { useEffect, useMemo, useRef, useState } from "react";
import { buildMorphTargets, buildFaceLines, mouthFollower, stepWeights, SHAPES } from "../../lib/faceGeometry.js";
import { legaLevels } from "../../lib/legaLevels.js";
import { CORE_VISUALS } from "../../lib/coreState.js";
import { ErrorBoundary } from "../ErrorBoundary.jsx";
import { CoreSvg } from "../core/Core3D.jsx";

// Lega's face (M06 §14–§15): particles + a line mesh in WebGL2. The shape is a blend of three morph targets that share the
// particle index (core ↔ face ↔ company graph); a change of shape eases from the CURRENT blend, so it can be interrupted
// mid-way. The mouth/jaw follows the level of the audio Lega is actually playing (reactive amplitude, not phonemes), and is
// closed when nothing plays or the sound is muted. Expression = observable Hub state, never "thoughts".

const VERT = `#version 300 es
in vec3 aCore; in vec3 aFace; in vec3 aGraph; in float aJaw; in float aSeed; in float aFeat;
uniform vec3 uW; uniform float uOpen; uniform float uTime; uniform float uYaw; uniform float uAspect; uniform float uEnergy; uniform float uSize;
out float vDepth; out float vSeed; out float vJaw; out float vFeat;
void main(){
  vec3 p = aCore * uW.x + aFace * uW.y + aGraph * uW.z;
  p.y -= uOpen * aJaw * 0.085 * uW.y;
  p.z += uOpen * aJaw * 0.02 * uW.y;
  float breathe = sin(uTime * (0.7 + aSeed) + aSeed * 40.0) * (0.004 + 0.01 * uEnergy) * (1.0 - uW.y * 0.6);
  p += normalize(p + 1e-4) * breathe;
  float c = cos(uYaw), s = sin(uYaw);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  float z = p.z + 2.4;
  gl_Position = vec4(p.x * 2.1 / z / uAspect, p.y * 2.1 / z, 0.0, 1.0);
  float feat = aFeat * uW.y;
  gl_PointSize = uSize * (1.6 + 1.2 * (0.5 + p.z)) * (0.8 + 0.4 * aSeed) * (1.0 + 0.45 * feat) * (1.0 - 0.35 * uW.y * (1.0 - aFeat));
  vDepth = p.z; vSeed = aSeed; vJaw = aJaw; vFeat = feat;
}`;
const FRAG = `#version 300 es
precision highp float; // same precision as the vertex shader: shared uniforms (uOpen) must match
in float vDepth; in float vSeed; in float vJaw; in float vFeat;
uniform vec3 uColor; uniform vec3 uAccent; uniform float uOpen; uniform float uW1;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.0, r) * (0.35 + 0.65 * smoothstep(-0.7, 0.6, vDepth)) * (1.0 - 0.55 * uW1 * (1.0 - vFeat)) * (1.0 + 0.5 * vFeat);
  vec3 col = mix(uColor, uAccent, vSeed * 0.35 + vJaw * uOpen * uW1 * 0.6);
  o = vec4(col * a, a);
}`;
const LVERT = `#version 300 es
in vec3 aPos; in float aJaw;
uniform float uOpen; uniform float uYaw; uniform float uAspect;
out float vDepth;
void main(){
  vec3 p = aPos; p.y -= uOpen * aJaw * 0.085; p.z += uOpen * aJaw * 0.02;
  float c = cos(uYaw), s = sin(uYaw);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  float z = p.z + 2.4;
  gl_Position = vec4(p.x * 2.1 / z / uAspect, p.y * 2.1 / z, 0.0, 1.0);
  vDepth = p.z;
}`;
const LFRAG = `#version 300 es
precision highp float; // same precision as the vertex shader: shared uniforms (uOpen) must match
in float vDepth; uniform vec3 uColor; uniform float uAlpha;
out vec4 o;
void main(){ float a = uAlpha * (0.25 + 0.75 * smoothstep(-0.6, 0.6, vDepth)); o = vec4(uColor * a, a); }`;

function program(gl, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link");
  return p;
}

function createFaceRenderer(canvas, targets, lines) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true, powerPreference: "low-power" });
  if (!gl) return null;
  const pts = program(gl, VERT, FRAG);
  const lns = program(gl, LVERT, LFRAG);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buffers = [];
  const attr = (prog, name, data, size) => {
    const loc = gl.getAttribLocation(prog, name); if (loc < 0) return;
    const b = gl.createBuffer(); buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  attr(pts, "aCore", targets.core, 3); attr(pts, "aFace", targets.face, 3); attr(pts, "aGraph", targets.graph, 3); attr(pts, "aJaw", targets.jaw, 1); attr(pts, "aSeed", targets.seed, 1); attr(pts, "aFeat", targets.feature, 1);
  const lvao = gl.createVertexArray(); gl.bindVertexArray(lvao);
  attr(lns, "aPos", lines.positions, 3); attr(lns, "aJaw", lines.jaw, 1);
  gl.bindVertexArray(null);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const u = { w: U(pts, "uW"), open: U(pts, "uOpen"), time: U(pts, "uTime"), yaw: U(pts, "uYaw"), aspect: U(pts, "uAspect"), energy: U(pts, "uEnergy"), size: U(pts, "uSize"), color: U(pts, "uColor"), accent: U(pts, "uAccent"), w1: U(pts, "uW1") };
  const l = { open: U(lns, "uOpen"), yaw: U(lns, "uYaw"), aspect: U(lns, "uAspect"), color: U(lns, "uColor"), alpha: U(lns, "uAlpha") };
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return {
    draw({ w, open, time, yaw, energy, visual, w2, h2, dpr }) {
      gl.viewport(0, 0, w2, h2); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const aspect = w2 / h2;
      if (w[SHAPES.FACE] > 0.02) {
        gl.useProgram(lns); gl.bindVertexArray(lvao);
        gl.uniform1f(l.open, open); gl.uniform1f(l.yaw, yaw); gl.uniform1f(l.aspect, aspect); gl.uniform3fv(l.color, visual.color); gl.uniform1f(l.alpha, 0.6 * w[SHAPES.FACE]);
        gl.drawArrays(gl.LINES, 0, lines.positions.length / 3);
      }
      gl.useProgram(pts); gl.bindVertexArray(vao);
      gl.uniform3f(u.w, w[0], w[1], w[2]); gl.uniform1f(u.open, open); gl.uniform1f(u.time, time); gl.uniform1f(u.yaw, yaw); gl.uniform1f(u.aspect, aspect);
      gl.uniform1f(u.energy, visual.energy); gl.uniform1f(u.size, Math.max(1, (w2 < 300 ? 0.95 : 1.15) * Math.min(dpr, 1.5))); gl.uniform3fv(u.color, visual.color); gl.uniform3fv(u.accent, visual.accent); gl.uniform1f(u.w1, w[1]);
      gl.drawArrays(gl.POINTS, 0, targets.count);
      gl.bindVertexArray(null);
    },
    dispose() { try { buffers.forEach((b) => gl.deleteBuffer(b)); gl.deleteProgram(pts); gl.deleteProgram(lns); } catch { /* gone */ } gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}

/**
 * @param {{ shape: "CORE"|"FACE"|"GRAPH", state: string, nodes?: Array, compact?: boolean, onStats?: (s) => void }} props
 * The current shape/weights and the mouth level are exposed as data-* attributes (tests and the performance report).
 */
function LegaFaceRenderer({ shape = "CORE", state = "IDLE", nodes = [], compact = false, onStats }) {
  const canvasRef = useRef(null);
  const targetRef = useRef(SHAPES[shape] ?? 0);
  const visualRef = useRef(CORE_VISUALS[state] || CORE_VISUALS.IDLE);
  targetRef.current = SHAPES[shape] ?? 0;
  visualRef.current = CORE_VISUALS[state] || CORE_VISUALS.IDLE;
  const count = compact ? 900 : 2200;
  const nodeKey = nodes.map((n) => `${n.kind}:${n.x.toFixed(2)}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => buildMorphTargets(count, { nodes }), [count, nodeKey]);
  const lines = useMemo(() => buildFaceLines(), []);
  const geomKey = `${count}:${nodeKey}`;
  // A failure belongs to one geometry: a new geometry (another project graph, compact mode) tries WebGL again on a new canvas.
  const [failedKey, setFailedKey] = useState(null);
  const failed = failedKey === geomKey;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let renderer = null;
    let reason = "WebGL2 indisponibil";
    try { renderer = createFaceRenderer(canvas, targets, lines); } catch (error) { renderer = null; reason = String(error?.message || error); }
    if (!renderer) { console.warn(`[lega-face] fallback SVG: ${reason}`); setFailedKey(geomKey); return undefined; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = mouthFollower();
    let weights = [0, 0, 0]; weights[targetRef.current] = 1;
    let raf = 0; let last = performance.now(); let yaw = 0; let alive = true; let frames = 0; let costMs = 0;
    const started = performance.now();
    const frame = (now) => {
      raf = 0;
      if (!alive || document.visibilityState !== "visible") return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t0 = performance.now();
      weights = reduced.matches ? weights.map((_, i) => (i === targetRef.current ? 1 : 0)) : stepWeights(weights, targetRef.current, dt);
      // The level of what is PLAYED; a muted or silent Lega keeps the mouth closed.
      const open = follow(legaLevels.lega || 0, { muted: Boolean(legaLevels.muted) });
      if (!reduced.matches) yaw = Math.sin((now - started) / 5200) * 0.32;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);
      const w2 = Math.max(64, Math.round(rect.width * dpr)); const h2 = Math.max(64, Math.round(rect.height * dpr));
      if (canvas.width !== w2 || canvas.height !== h2) { canvas.width = w2; canvas.height = h2; }
      renderer.draw({ w: weights, open, time: (now - started) / 1000, yaw, energy: visualRef.current.energy, visual: visualRef.current, w2, h2, dpr });
      costMs = costMs * 0.9 + (performance.now() - t0) * 0.1;
      frames += 1;
      if (frames % 30 === 0) {
        canvas.dataset.weights = weights.map((x) => x.toFixed(2)).join(","); canvas.dataset.mouth = open.toFixed(3); canvas.dataset.cpuMs = costMs.toFixed(2); canvas.dataset.particles = String(targets.count);
        onStats?.({ weights, mouth: open, cpuMs: costMs, particles: targets.count });
      }
      if (!reduced.matches) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && alive) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);
    const reducedTimer = setInterval(() => { if (reduced.matches) kick(); }, 500);
    kick();
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); alive = false; setFailedKey(geomKey); });
    return () => { alive = false; cancelAnimationFrame(raf); clearInterval(reducedTimer); document.removeEventListener("visibilitychange", onVis); renderer.dispose(); };
  }, [targets, lines, compact, onStats, geomKey]);

  if (failed) return <CoreSvg state={state} />;
  const label = shape === "FACE" ? "Fața Lega (abstractă, din particule și linii)" : shape === "GRAPH" ? "Harta companiei din particule" : "Nucleul Lega";
  // A new canvas per geometry: a disposed renderer loses its WebGL context, and a lost context cannot be reused.
  return <canvas key={geomKey} ref={canvasRef} className="lega-face-canvas" role="img" aria-label={`${label}: ${(CORE_VISUALS[state] || CORE_VISUALS.IDLE).label}`} data-shape={shape} data-renderer="webgl2" />;
}

/** Any WebGL failure falls back to the SVG core; the conversation and Stop never depend on this component. */
export function LegaFace(props) {
  return (
    <ErrorBoundary label="face" resetKey={props.shape} fallback={() => <CoreSvg state={props.state} />}>
      <LegaFaceRenderer {...props} />
    </ErrorBoundary>
  );
}
