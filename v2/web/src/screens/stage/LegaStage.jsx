import { useEffect, useMemo, useRef, useState } from "react";
import { useHub, onLive, setState } from "../../store.js";
import { buildStageGraph, project } from "../../lib/stageGraph.js";
import { legaLevels } from "../../lib/legaLevels.js";
import { deriveCoreState } from "../../lib/coreState.js";
import { isAppShortcut } from "../../lib/uiLogic.js";

/**
 * Lega stage — the "JARVIS" map of the company, drawn behind the one Lega screen (#/lega). A living network from real Hub state:
 * departments and their roles, missions, active runs (bright) and pending approvals (amber) around Lega at the centre.
 * The ambient plexus is decorative. Energy follows the REAL audio levels (your microphone, Lega's voice) and the core state.
 * Everything with effects still needs a click (approvals, the plan's one confirmation) or goes through the gate.
 */
const TONES = { accent: [101, 217, 255], approval: [233, 181, 109], ok: [134, 220, 187], danger: [255, 143, 133], dim: [120, 140, 160] };
const rgba = (tone, a) => { const [r, g, b] = TONES[tone] || TONES.accent; return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
const LINK_DISTANCE = 0.36;

function useStageRenderer(canvasRef, graph, coreState) {
  const stateRef = useRef({ graph, coreState });
  stateRef.current = { graph, coreState };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let raf = 0; let yaw = 0; let last = performance.now(); let energy = 0.3;
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    const draw = (now) => {
      const { graph: g, coreState: cs } = stateRef.current;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const voice = Math.max(legaLevels.mic, legaLevels.lega);
      const busy = cs === "EXECUTING" ? 0.35 : cs === "WAITING_APPROVAL" ? 0.2 : 0;
      energy += ((0.25 + busy + voice * 0.9) - energy) * Math.min(1, dt * 4);
      if (!reduced?.matches) yaw += dt * (0.05 + energy * 0.12);
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      const scale = Math.min(w, h) * 0.36;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const pts = g.nodes.map((n) => ({ n, ...project(n, { yaw, pitch: 0.28, scale, cx: w / 2, cy: h / 2 }) }));
      // Plexus lines between nearby nodes (3D distance), fading with depth and distance.
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j += 1) {
          const b = pts[j];
          const dx = a.n.x - b.n.x; const dy = a.n.y - b.n.y; const dz = a.n.z - b.n.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > LINK_DISTANCE) continue;
          const alpha = (1 - d / LINK_DISTANCE) * 0.42 * (0.6 + energy) * Math.min(a.f, b.f);
          ctx.strokeStyle = rgba(a.n.tone === "approval" || b.n.tone === "approval" ? "approval" : "accent", alpha);
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
      }
      // Structural links (Lega → departments/missions/runs/approvals, department → roles).
      for (const [i, j, s] of g.links) {
        const a = pts[i]; const b = pts[j];
        ctx.strokeStyle = rgba(b.n.tone, 0.18 * s * (0.7 + energy));
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      // Nodes (back to front), with a soft glow; pulsing ones breathe with time and energy.
      pts.sort((a, b) => b.depth - a.depth);
      const t = now / 1000;
      for (const p of pts) {
        const pulse = p.n.pulse ? 1 + Math.sin(t * 3 + p.n.x * 5) * 0.25 * p.n.pulse * (0.5 + energy) : 1;
        const radius = Math.max(0.6, p.n.r * p.f * pulse * (p.n.kind === "core" ? 1 + voice * 1.6 : 1));
        const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, radius * 4);
        glow.addColorStop(0, rgba(p.n.tone, (p.n.ambient ? 0.35 : 0.8) * p.f));
        glow.addColorStop(1, rgba(p.n.tone, 0));
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, radius * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(p.n.tone, p.n.ambient ? 0.55 : 0.95);
        ctx.beginPath(); ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      // Labels for the named nodes facing the viewer.
      ctx.font = "12px var(--font, system-ui)";
      ctx.textAlign = "center";
      for (const p of pts) {
        if (!p.n.label || p.n.kind === "role" || p.depth > 0.35) continue;
        ctx.fillStyle = `rgba(234,242,250,${(0.35 + 0.55 * (1 - Math.max(0, p.depth))).toFixed(2)})`;
        ctx.fillText(String(p.n.label).slice(0, 28), p.sx, p.sy - p.n.r * p.f - 10);
      }
      if (!reduced?.matches && document.visibilityState === "visible") raf = requestAnimationFrame(draw);
      else raf = 0;
    };
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    kick();
    const onVisibility = () => kick();
    document.addEventListener("visibilitychange", onVisibility);
    reduced?.addEventListener?.("change", kick);
    const redrawStatic = setInterval(() => { if (reduced?.matches) kick(); }, 1000); // reduced motion: calm, periodic redraw only
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); document.removeEventListener("visibilitychange", onVisibility); reduced?.removeEventListener?.("change", kick); clearInterval(redrawStatic); };
  }, [canvasRef]);
}

/**
 * One L3ga screen (2026-10-18): the living company map is the BACKGROUND of the Lega screen (#/lega), no longer a modal over it.
 * The same renderer and the same real data (departments and roles, missions, active runs, pending approvals around Lega); the energy
 * follows the real audio levels and the core state. Decorative for assistive technology (the panels next to it say the same in text).
 */
export function StageCanvas({ className = "" }) {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const legaPhase = useHub((s) => s.legaPhase);
  const core = deriveCoreState({ hub, connection, legaPhase });
  const graph = useMemo(() => buildStageGraph(hub, { ambient: 260 }), [hub]);
  const canvasRef = useRef(null);
  useStageRenderer(canvasRef, graph, core.state);
  return <canvas ref={canvasRef} className={`lega-stage-canvas ${className}`} aria-hidden="true" />;
}

/** The live captions of the voice session (redacted by the Hub): what you said and what Lega is saying, over the map. */
export function useVoiceCaption() {
  const [caption, setCaption] = useState({ user: "", lega: "", legaFinal: false });
  useEffect(() => onLive((e) => {
    if (e.type !== "lega.transcript.partial" && e.type !== "lega.transcript.done") return;
    const final = e.type === "lega.transcript.done";
    setCaption((c) => (e.role === "user" ? { ...c, user: e.text } : { ...c, lega: e.text, legaFinal: final }));
  }), []);
  return caption;
}

/**
 * „Ecran complet” (Alt+J, plain Alt only: AltGr+J types a character on the Romanian layout): the Lega screen without the Hub's bars.
 * `stageOpen` keeps its old name (start view „ecran complet”, the voice intent, toasts that close it); the Shell opens #/lega for it.
 */
export function useStageToggle() {
  const open = useHub((s) => Boolean(s.stageOpen));
  useEffect(() => {
    const onKey = (e) => { if (isAppShortcut(e, "j")) { e.preventDefault(); setState((s) => ({ stageOpen: !s.stageOpen })); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, (value) => setState({ stageOpen: value })];
}
