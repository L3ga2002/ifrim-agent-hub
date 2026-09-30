import { useEffect, useRef, useState } from "react";

// Original procedural core: segmented light rings around a soft nucleus with a noise flow field.
// Parameters are driven only by real Hub states. It renders nothing decorative about activity it
// cannot observe; with WebGL unavailable or reduced motion it degrades to Canvas2D or a static frame.
export const CORE_STATES = {
  idle: { label: "În așteptare", color: [0.4, 0.85, 1.0], color2: [0.4, 0.85, 1.0], energy: 0.25, spin: 0.25, segments: 12, pulse: 0.35 },
  listening: { label: "Ascult", color: [0.55, 0.9, 1.0], color2: [1.0, 0.56, 0.52], energy: 0.6, spin: 0.2, segments: 24, pulse: 1.0 },
  transcribing: { label: "Transcriu", color: [0.55, 0.9, 1.0], color2: [0.55, 0.9, 1.0], energy: 0.75, spin: 0.8, segments: 36, pulse: 0.6 },
  processing: { label: "Procesez", color: [0.4, 0.85, 1.0], color2: [0.72, 0.78, 1.0], energy: 1.0, spin: 1.1, segments: 18, pulse: 0.5 },
  executing: { label: "Execut", color: [0.4, 0.85, 1.0], color2: [0.4, 0.85, 1.0], energy: 1.3, spin: 1.6, segments: 20, pulse: 0.3 },
  verifying: { label: "Verific", color: [0.53, 0.86, 0.73], color2: [0.4, 0.85, 1.0], energy: 0.55, spin: 0.6, segments: 16, pulse: 0.4 },
  approval: { label: "Aștept aprobare", color: [0.91, 0.71, 0.43], color2: [0.91, 0.71, 0.43], energy: 0.55, spin: 0.35, segments: 10, pulse: 1.0 },
  error: { label: "Atenție", color: [1.0, 0.56, 0.52], color2: [1.0, 0.56, 0.52], energy: 0.2, spin: 0.08, segments: 8, pulse: 0.2 },
};

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2;
uniform float uEnergy; uniform float uSpin; uniform float uSegments; uniform float uPulse;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float r = length(uv) * 2.0;
  float a = atan(uv.y, uv.x);
  float t = uTime;
  float core = exp(-r * r * 7.0) * (0.5 + 0.22 * uPulse * sin(t * 1.8));
  float rings = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float rr = 0.34 + fi * 0.165;
    float w = 0.007 + 0.004 * fi;
    float dir = mod(fi, 2.0) * 2.0 - 1.0;
    float seg = step(0.32, fract((a / 6.2831853) * (uSegments + fi * 6.0) + t * uSpin * (fi + 1.0) * dir * 0.05));
    rings += smoothstep(w, 0.0, abs(r - rr)) * (0.3 + 0.7 * seg) * (1.0 - fi * 0.17);
  }
  float tick = smoothstep(0.012, 0.0, abs(r - 0.93)) * step(0.9, fract(a / 6.2831853 * 60.0)) * 0.5;
  float n = noise(vec2(a * 3.0 + t * 0.25 * uEnergy, r * 6.0 - t * 0.7 * uEnergy));
  float flow = smoothstep(0.58, 0.92, n) * smoothstep(0.9, 0.18, r) * 0.33 * uEnergy;
  float halo = smoothstep(1.0, 0.74, r) * smoothstep(0.6, 0.92, r) * 0.16;
  vec3 col = uColor * (core * 1.35 + rings + flow + tick) + uColor2 * halo;
  float alpha = clamp(core + rings + flow + halo + tick, 0.0, 1.0) * smoothstep(1.0, 0.95, r);
  o = vec4(col * alpha, alpha);
}`;
const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

function createGl(canvas) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return null;
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(program, name);
  const uniforms = { res: u("uRes"), time: u("uTime"), color: u("uColor"), color2: u("uColor2"), energy: u("uEnergy"), spin: u("uSpin"), segments: u("uSegments"), pulse: u("uPulse") };
  return {
    draw(time, s, w, h) {
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.res, w, h); gl.uniform1f(uniforms.time, time);
      gl.uniform3fv(uniforms.color, s.color); gl.uniform3fv(uniforms.color2, s.color2);
      gl.uniform1f(uniforms.energy, s.energy); gl.uniform1f(uniforms.spin, s.spin); gl.uniform1f(uniforms.segments, s.segments); gl.uniform1f(uniforms.pulse, s.pulse);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}

function create2d(canvas) {
  const ctx = canvas.getContext("2d");
  return {
    draw(time, s, w, h) {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2; const cy = h / 2; const R = Math.min(w, h) / 2;
      const rgb = (c, a) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
      g.addColorStop(0, rgb(s.color, 0.55)); g.addColorStop(1, rgb(s.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.45, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i += 1) {
        const segs = s.segments + i * 6; const rr = R * (0.34 + i * 0.165); const dir = i % 2 ? 1 : -1;
        ctx.strokeStyle = rgb(s.color, 0.75 - i * 0.14); ctx.lineWidth = 1.5 + i * 0.4;
        for (let k = 0; k < segs; k += 1) {
          const a0 = (k / segs) * Math.PI * 2 + time * s.spin * 0.3 * dir * (i + 1) * 0.05 * Math.PI * 2;
          ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + (Math.PI * 2 / segs) * 0.68); ctx.stroke();
        }
      }
    },
    dispose() {},
  };
}

export function Core({ state = "idle", disabled = false }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(CORE_STATES[state] || CORE_STATES.idle);
  const [mode, setMode] = useState("webgl");
  const kickRef = useRef(() => {});
  stateRef.current = CORE_STATES[state] || CORE_STATES.idle;

  useEffect(() => {
    if (disabled) { setMode("static"); return undefined; }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let renderer = null;
    try { renderer = createGl(canvas); } catch { renderer = null; }
    if (!renderer) { renderer = create2d(canvas); setMode("canvas2d"); } else setMode("webgl");
    let raf = 0; let last = 0; let visible = true; let onScreen = true;
    const started = performance.now();
    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const px = Math.max(64, Math.min(360, Math.round(rect.width * dpr)));
      if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
      return px;
    };
    const frame = (now) => {
      raf = 0;
      if (!visible || !onScreen) return;
      if (now - last >= 33) { // ~30 fps cap: leaves CPU/GPU for browser tests and local tools
        last = now;
        const px = size();
        renderer.draw(reduced.matches ? 0 : (now - started) / 1000, stateRef.current, px, px);
      }
      if (!reduced.matches) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onVisibility = () => { visible = document.visibilityState === "visible"; if (visible) kick(); };
    const io = new IntersectionObserver((entries) => { onScreen = entries[0]?.isIntersecting ?? true; if (onScreen) kick(); });
    io.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener?.("change", kick);
    kickRef.current = kick;
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", onVisibility); reduced.removeEventListener?.("change", kick); renderer.dispose(); };
  }, [disabled]);

  // A state change must be visible even when animation is paused (reduced motion).
  useEffect(() => { kickRef.current(); }, [state]);

  const s = CORE_STATES[state] || CORE_STATES.idle;
  if (disabled || mode === "static") {
    const c = `rgb(${s.color.map((v) => Math.round(v * 255)).join(",")})`;
    return (
      <svg viewBox="0 0 100 100" role="img" aria-label={`Stare nucleu: ${s.label}`}>
        <circle cx="50" cy="50" r="14" fill={c} opacity="0.5" />
        {[17, 25, 33, 41].map((r, i) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={c} strokeWidth={1 + i * 0.3} strokeDasharray={`${6 - i} ${3 + i}`} opacity={0.8 - i * 0.15} />)}
      </svg>
    );
  }
  return <canvas ref={canvasRef} role="img" aria-label={`Stare nucleu: ${s.label}`} data-renderer={mode} />;
}
