import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Mic, Square, X, ShieldCheck, Activity, Building2, Target } from "lucide-react";
import { useHub, onLive, setState } from "../../store.js";
import { buildStageGraph, project } from "../../lib/stageGraph.js";
import { legaLevels, sendLegaCommand } from "../../lib/legaLevels.js";
import { deriveCoreState } from "../../lib/coreState.js";
import { isAppShortcut } from "../../lib/uiLogic.js";
import { StopAllButton } from "../../shell/Shell.jsx";

/**
 * Lega stage — the full-screen "JARVIS" view of the company. A living network drawn from real Hub state:
 * departments and their roles, missions, active runs (bright) and pending approvals (amber) around Lega at the centre.
 * The ambient plexus is decorative. Energy follows the REAL audio levels (your microphone, Lega's voice) and the core state.
 * Captions show what you and Lega say. Everything with effects still needs a click (approvals) or goes through the gate.
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

export function LegaStage({ onClose, go }) {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const legaPhase = useHub((s) => s.legaPhase);
  const legaStatus = useHub((s) => s.legaStatus || "off");
  const core = deriveCoreState({ hub, connection, legaPhase });
  const graph = useMemo(() => buildStageGraph(hub, { ambient: 260 }), [hub]);
  const canvasRef = useRef(null);
  const closeRef = useRef(null);
  const [caption, setCaption] = useState({ user: "", lega: "", legaFinal: false });
  useStageRenderer(canvasRef, graph, core.state);

  // Captions from the live transcript (redacted by the Hub).
  useEffect(() => onLive((e) => {
    if (e.type !== "lega.transcript.partial" && e.type !== "lega.transcript.done") return;
    const final = e.type === "lega.transcript.done";
    setCaption((c) => (e.role === "user" ? { ...c, user: e.text } : { ...c, lega: e.text, legaFinal: final }));
  }), []);

  // Esc closes; focus starts on the close button (the stage is a modal region).
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const words = String(caption.lega || "").trim().split(/\s+/).filter(Boolean);
  const lastWord = words.length ? words[words.length - 1].replace(/[.,!?;:]+$/, "") : "";
  const running = ["preparing", "connecting", "active"].includes(legaStatus);
  const departments = hub?.company?.departments || [];
  const approvals = hub?.approvals || [];
  const runs = hub?.activeRuns || [];
  const open = (path) => { onClose(); go(path); };

  return (
    <div className="lega-stage" role="dialog" aria-modal="true" aria-label="Lega — ecran complet">
      <canvas ref={canvasRef} className="lega-stage-canvas" aria-hidden="true" />
      <header className="stage-top">
        <div className="stage-brand"><AudioLines size={16} aria-hidden="true" /> LEGA · IFRIM DIGITAL</div>
        <div className="stage-chips">
          <span className="stage-chip">{hub?.mode || "—"}</span>
          <span className={`stage-chip ${hub?.executionGate?.status === "open" ? "ok" : ""}`}>poarta {hub?.executionGate?.status === "open" ? "deschisă" : "suspendată"}</span>
          <span className="stage-chip">{core.label}</span>
        </div>
        <div className="stage-actions">
          <StopAllButton compact />
          <button ref={closeRef} className="btn sm ghost" onClick={onClose} aria-label="Închide ecranul Lega (Esc)"><X size={15} /></button>
        </div>
      </header>

      <aside className="stage-col left" aria-label="Compania">
        <div className="stage-title"><Building2 size={13} aria-hidden="true" /> Compania</div>
        <ul>{departments.map((d) => <li key={d.key} className={d.status === "active" ? "on" : ""}><span>{d.name}</span><span className="faint">{d.roles} roluri</span></li>)}</ul>
        <p className="faint small">Structură configurată, nu muncă făcută. Execuții active: {runs.length}.</p>
        <button className="btn sm ghost" onClick={() => open("/company")}>Deschide Compania</button>
      </aside>

      <aside className="stage-col right" aria-label="Decizii și execuții">
        <div className="stage-title"><ShieldCheck size={13} aria-hidden="true" /> Decizii ({hub?.pendingApprovals || 0})</div>
        <ul>{approvals.slice(0, 5).map((a) => <li key={a.id} className="amber"><button className="link-btn" onClick={() => open("/approvals")}>{a.actionKind}</button></li>)}</ul>
        {approvals.length === 0 && <p className="faint small">Nimic de aprobat.</p>}
        <div className="stage-title"><Activity size={13} aria-hidden="true" /> Execuții</div>
        <ul>{runs.map((r) => <li key={r.runId}><button className="link-btn" onClick={() => open(`/conversations/${r.conversationId}`)}>{r.provider} · {r.phase === "streaming" ? "lucrează" : "așteaptă"}</button></li>)}</ul>
        {runs.length === 0 && <p className="faint small">Nicio execuție activă.</p>}
        <button className="btn sm ghost" onClick={() => open("/missions")}><Target size={13} />Misiuni</button>
      </aside>

      <div className="stage-captions" aria-live="polite">
        {caption.user && <p className="stage-user">Tu: {caption.user}</p>}
        {caption.lega && <p className="stage-lega">{caption.lega}</p>}
        {lastWord && !caption.legaFinal && <p className="stage-word" aria-hidden="true">{lastWord.toUpperCase()}</p>}
        {!caption.lega && !caption.user && <p className="stage-hint">{running ? "Vorbește cu Lega: „Lega, ce se întâmplă?”, „Lega, pregătește o analiză pe proiectul de test”, „Lega, oprește tot”." : "Pornește Lega ca să controlezi compania cu vocea. Tot ce are efecte se confirmă prin click."}</p>}
      </div>

      <footer className="stage-bottom">
        {running
          ? <button className="btn danger stage-mic" onClick={() => sendLegaCommand("stop")}><Square size={16} />Oprește Lega</button>
          : <button className="btn primary stage-mic" onClick={() => sendLegaCommand("start")}><Mic size={16} />Pornește Lega</button>}
        <span className="faint small">{core.reason}</span>
      </footer>
    </div>
  );
}

/** Opens/closes the stage (Alt+J, plain Alt only: AltGr+J types a character on the Romanian layout); rendered by the Shell. */
export function useStageToggle() {
  const open = useHub((s) => Boolean(s.stageOpen));
  useEffect(() => {
    const onKey = (e) => { if (isAppShortcut(e, "j")) { e.preventDefault(); setState((s) => ({ stageOpen: !s.stageOpen })); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, (value) => setState({ stageOpen: value })];
}
