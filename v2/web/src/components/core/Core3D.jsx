import { useEffect, useRef, useState } from "react";
import { CORE_VISUALS } from "../../lib/coreState.js";
import { ErrorBoundary } from "../ErrorBoundary.jsx";

// IFRIM core: an original procedural VOLUME rendered by ray marching (no model, no asset, no library).
// Concentric gyroid-lattice shells around a nucleus; colour, turbulence and motion come only from the Hub state
// passed in. It does not depict "thinking": motion speed tracks observable activity, not inferred progress.

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uColor; uniform vec3 uAccent;
uniform float uEnergy; uniform float uTurb; uniform float uPulse; uniform float uShells; uniform float uSteps;
out vec4 o;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float field(vec3 p, float t){
  float r = length(p);
  float d = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    if (fk >= uShells) break;
    float rk = 0.36 + fk * 0.16;
    vec3 q = p;
    float dir = mod(fk, 2.0) * 2.0 - 1.0;
    q.xz *= rot(t * 0.16 * (fk + 1.0) * dir);
    q.xy *= rot(t * 0.05 * (fk + 1.0));
    float g = dot(sin(q * (7.0 + fk * 2.0)), cos(q.zxy * (7.0 + fk * 2.0)));
    float n = noise(q * 3.2 + vec3(t * 0.35));
    float shell = exp(-pow((r - rk) / (0.020 + 0.007 * fk), 2.0));
    d += shell * (0.25 + 0.75 * smoothstep(-0.15, 0.85, g + uTurb * (n - 0.5) * 1.6)) * (1.0 - fk * 0.16);
  }
  d += exp(-r * r * 30.0) * (1.25 + 0.45 * uPulse * sin(t * 2.2));
  return d;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, -2.2);
  vec3 rd = normalize(vec3(uv * 1.42, 1.6));
  float t = uTime * (0.2 + uEnergy);
  float b = dot(ro, rd); float c = dot(ro, ro) - 1.0; float h = b * b - c;
  vec3 col = vec3(0.0); float a = 0.0;
  if (h > 0.0) {
    h = sqrt(h);
    float t0 = max(-b - h, 0.0); float t1 = -b + h;
    float dt = (t1 - t0) / uSteps; float s = t0 + dt * 0.5;
    for (int i = 0; i < 48; i++) {
      if (float(i) >= uSteps || a > 0.97) break;
      vec3 p = ro + rd * s;
      float dens = field(p, t);
      vec3 tint = mix(uColor, uAccent, smoothstep(0.25, 0.85, length(p)));
      col += tint * dens * dt * 3.0 * (1.0 - a);
      a += dens * dt * 1.7 * (1.0 - a);
      s += dt;
    }
  }
  float r2 = length(uv) * 2.0;
  float halo = smoothstep(1.0, 0.55, r2) * smoothstep(0.3, 0.85, r2) * 0.09 * (0.5 + 0.5 * uEnergy);
  col += uColor * halo;
  o = vec4(col, clamp(a + halo, 0.0, 1.0));
}`;

function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    return s;
  };
  const program = gl.createProgram();
  const vs = compile(gl.VERTEX_SHADER, VERT); const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program link failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(program, n);
  const U = { res: u("uRes"), time: u("uTime"), color: u("uColor"), accent: u("uAccent"), energy: u("uEnergy"), turb: u("uTurb"), pulse: u("uPulse"), shells: u("uShells"), steps: u("uSteps") };
  return {
    gl,
    draw(time, v, w, h, steps) {
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, w, h); gl.uniform1f(U.time, time);
      gl.uniform3fv(U.color, v.color); gl.uniform3fv(U.accent, v.accent);
      gl.uniform1f(U.energy, v.energy); gl.uniform1f(U.turb, v.turbulence); gl.uniform1f(U.pulse, v.pulse);
      gl.uniform1f(U.shells, v.shells); gl.uniform1f(U.steps, steps);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    /** GPU cost of one frame: draw + 1-pixel read forces the pipeline to finish (used only for calibration). */
    measure(time, v, w, h, steps) {
      const px = new Uint8Array(4);
      const t0 = performance.now();
      this.draw(time, v, w, h, steps);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return performance.now() - t0;
    },
    dispose() {
      try { gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); } catch { /* context gone */ }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** 2D/SVG core: complete fallback (no WebGL, lost context, low-power choice). Same state, same labels. */
export function CoreSvg({ state = "IDLE", size }) {
  const v = CORE_VISUALS[state] || CORE_VISUALS.IDLE;
  const c = `rgb(${v.color.map((x) => Math.round(x * 255)).join(",")})`;
  const a = `rgb(${v.accent.map((x) => Math.round(x * 255)).join(",")})`;
  const rings = [18, 26, 34, 42].slice(0, Math.max(1, v.shells));
  return (
    <svg className={`core-svg state-${state}`} viewBox="0 0 100 100" role="img" aria-label={`Nucleu: ${v.label}`} style={size ? { width: size, height: size } : undefined}>
      <defs><radialGradient id={`cg-${state}`}><stop offset="0" stopColor={c} stopOpacity="0.9" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient></defs>
      <circle cx="50" cy="50" r="15" fill={`url(#cg-${state})`} />
      {rings.map((r, i) => (
        <circle key={r} className={`ring r${i}`} cx="50" cy="50" r={r} fill="none" stroke={i % 2 ? a : c} strokeWidth={0.8 + i * 0.25}
          strokeDasharray={`${5 - i} ${2.5 + i * 1.2}`} opacity={0.85 - i * 0.14} />
      ))}
    </svg>
  );
}

/**
 * @param {{ state: string, compact?: boolean, disabled?: boolean, onRenderer?: (mode: string) => void }} props
 * Renderer modes: "webgl" | "svg" (fallback or chosen) — exposed as data-renderer for tests and the status line.
 */
function Core3DRenderer({ state = "IDLE", compact = false, disabled = false, onRenderer }) {
  const canvasRef = useRef(null);
  const visualRef = useRef(CORE_VISUALS[state] || CORE_VISUALS.IDLE);
  const kickRef = useRef(() => {});
  const [mode, setMode] = useState(disabled ? "svg" : "webgl");
  const [lostCount, setLostCount] = useState(0);
  visualRef.current = CORE_VISUALS[state] || CORE_VISUALS.IDLE;

  useEffect(() => { onRenderer?.(mode); }, [mode, onRenderer]);

  useEffect(() => {
    if (disabled || lostCount > 2) { setMode("svg"); return undefined; }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let renderer = null;
    try { renderer = createRenderer(canvas); } catch { renderer = null; }
    if (!renderer) { setMode("svg"); return undefined; }
    setMode("webgl");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0; let last = 0; let visible = document.visibilityState === "visible"; let onScreen = true; let alive = true;
    // Adaptive quality from MEASURED GPU cost (periodic synchronous calibration): fewer march steps, then lower
    // resolution on modest GPUs; the numbers are exposed as data-* attributes for the performance report.
    const quality = { steps: 40, scale: 1, frames: 0, gpuMs: null };
    const started = performance.now();
    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality.scale;
      const px = Math.max(48, Math.min(compact ? 160 : 420, Math.round(Math.max(rect.width, rect.height) * dpr)));
      // Both dimensions: a computed size can equal the default canvas width (300) while the height is still 150.
      if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
      return px;
    };
    const frame = (now) => {
      raf = 0;
      if (!alive || !visible || !onScreen) return;
      const interval = compact ? 50 : 16; // compact core: ~20 fps is enough and saves power
      if (now - last >= interval) {
        const px = size();
        const t = reduced.matches ? 1.5 : (now - started) / 1000;
        if (quality.frames % 90 === 0) {
          const cost = renderer.measure(t, visualRef.current, px, px, quality.steps);
          quality.gpuMs = Math.round(cost * 10) / 10;
          if (cost > 10 && quality.steps > 16) quality.steps -= 8;
          else if (cost > 10 && quality.scale > 0.55) quality.scale = Math.round((quality.scale - 0.15) * 100) / 100;
          else if (cost < 3 && quality.steps < 40) quality.steps += 4;
          canvas.dataset.gpuMs = String(quality.gpuMs); canvas.dataset.steps = String(quality.steps); canvas.dataset.scale = String(quality.scale); canvas.dataset.px = String(px);
        } else {
          renderer.draw(t, visualRef.current, px, px, quality.steps);
        }
        quality.frames += 1;
        last = now;
      }
      if (!reduced.matches) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && alive) raf = requestAnimationFrame(frame); };
    const onVisibility = () => { visible = document.visibilityState === "visible"; if (visible) kick(); };
    const io = new IntersectionObserver((entries) => { onScreen = entries[0]?.isIntersecting ?? true; if (onScreen) kick(); });
    const onLost = (e) => { e.preventDefault(); alive = false; cancelAnimationFrame(raf); raf = 0; setLostCount((n) => n + 1); };
    canvas.addEventListener("webglcontextlost", onLost);
    io.observe(canvas);
    // Redraw on any size change (layout, zoom, viewport), also when animation is paused.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { last = 0; if (reduced.matches || !visible) { const px = size(); renderer.draw(1.5, visualRef.current, px, px, quality.steps); } else kick(); }) : null;
    ro?.observe(canvas);
    // First frame immediately (never show an unsized canvas while waiting for the animation loop).
    { const px = size(); renderer.draw(reduced.matches ? 1.5 : 0, visualRef.current, px, px, quality.steps); }
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener?.("change", kick);
    kickRef.current = () => { last = 0; kick(); };
    kick();
    return () => {
      alive = false; cancelAnimationFrame(raf); io.disconnect(); ro?.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener?.("change", kick);
      renderer.dispose();
    };
  }, [disabled, compact, lostCount]);

  // A state change is drawn even when animation is paused (reduced motion).
  useEffect(() => { kickRef.current(); }, [state]);

  const v = CORE_VISUALS[state] || CORE_VISUALS.IDLE;
  if (mode === "svg") return <CoreSvg state={state} />;
  // Remount the canvas after a context loss (a lost canvas cannot get a new context).
  return <canvas key={lostCount} ref={canvasRef} className="core-canvas-el" role="img" aria-label={`Nucleu: ${v.label}`} data-renderer="webgl" data-state={state} />;
}

/** Public core: any renderer error (driver, shader, WebGL API) falls back to the SVG core instead of breaking the page. */
export function Core3D(props) {
  return (
    <ErrorBoundary label="core" resetKey={props.disabled ? "svg" : "webgl"} onError={() => props.onRenderer?.("svg")} fallback={() => <CoreSvg state={props.state} />}>
      <Core3DRenderer {...props} />
    </ErrorBoundary>
  );
}
