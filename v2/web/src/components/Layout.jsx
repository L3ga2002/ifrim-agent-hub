import { useEffect, useRef, useState } from "react";

/** Current viewport size (debounced on resize). */
export function useViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let t = null;
    const on = () => { clearTimeout(t); t = setTimeout(() => setSize(read()), 80); };
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); clearTimeout(t); };
  }, []);
  return size;
}

/**
 * Accessible splitter: pointer drag + keyboard (arrows ±24 px, Home/End). `invert` for panes anchored to the
 * right/bottom edge. The value is committed by the parent (and persisted there as a UI preference only).
 */
export function Splitter({ orientation = "vertical", value, min, max, onChange, invert = false, label }) {
  const drag = useRef(null);
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      const delta = orientation === "vertical" ? e.clientX - drag.current.x : e.clientY - drag.current.y;
      const next = drag.current.start + (invert ? -delta : delta);
      onChange(Math.max(min, Math.min(max, Math.round(next))));
    };
    const up = () => { if (drag.current) { drag.current = null; document.body.style.userSelect = ""; document.body.style.cursor = ""; } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [orientation, invert, min, max, onChange]);
  const step = (d) => onChange(Math.max(min, Math.min(max, value + (invert ? -d : d))));
  return (
    <div className={`splitter-x ${orientation}`} role="separator" aria-orientation={orientation} aria-label={label} tabIndex={0}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, start: value }; document.body.style.userSelect = "none"; document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize"; }}
      onKeyDown={(e) => {
        const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const fwd = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (e.key === back) { e.preventDefault(); step(-24); }
        if (e.key === fwd) { e.preventDefault(); step(24); }
        if (e.key === "Home") { e.preventDefault(); onChange(invert ? max : min); }
        if (e.key === "End") { e.preventDefault(); onChange(invert ? min : max); }
      }} />
  );
}
