import { useEffect, useRef, useState } from "react";
import { pushToast } from "../store.js";

const FIND_TIMEOUT_MS = 5000;
const SHOW_MS = 12000;
const PAD = 6;

/** The first visible element marked with this target (the same mark can exist in the top bar and the mobile bar). */
function findTarget(target) {
  const nodes = document.querySelectorAll(`[data-lega-target="${CSS.escape(target)}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden") return node;
  }
  return null;
}

/**
 * Lega's arrow: highlights one `[data-lega-target]` element with a ring, an arrow and a label ("arată-mi unde…").
 * It only draws: the overlay never takes clicks (the owner presses the real button), and it disappears after a few
 * seconds, on Esc or on the next click. Targets come from the Hub's fixed map (LEGA_TARGETS), never from free text.
 */
export function Spotlight() {
  const [spot, setSpot] = useState(null); // { target, label, rect }
  const run = useRef({ id: 0 });

  useEffect(() => {
    const onPoint = (e) => {
      const { target, label } = e.detail || {};
      if (typeof target !== "string" || !target) return;
      const id = ++run.current.id;
      const started = Date.now();
      let node = null;
      let last = "";
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      // Follows the element while it moves (scrolling, layout changes); re-renders only when its box changes.
      const follow = () => {
        if (run.current.id !== id) return;
        if (!node || !node.isConnected) node = findTarget(target);
        const rect = node ? node.getBoundingClientRect() : null;
        const key = rect ? `${rect.left}|${rect.top}|${rect.width}|${rect.height}` : "none";
        if (key !== last) { last = key; setSpot(rect ? { target, label, rect } : null); }
        requestAnimationFrame(follow);
      };
      const search = () => {
        if (run.current.id !== id) return;
        node = findTarget(target);
        if (node) {
          node.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
          follow();
          run.current.timer = setTimeout(() => { if (run.current.id === id) { run.current.id += 1; setSpot(null); } }, SHOW_MS);
          return;
        }
        if (Date.now() - started > FIND_TIMEOUT_MS) { setSpot(null); pushToast(`lega-point-${id}`, "info", `Lega voia să-ți arate „${label || target}”, dar elementul nu e pe ecran acum.`); return; }
        run.current.search = setTimeout(search, 120); // the screen may still be loading after Lega's navigation
      };
      // A new request replaces the previous one (its loops stop because the id changed). The first look waits a moment so
      // the screen Lega just opened replaces the old one (the same mark may exist on both, e.g. two project pages).
      clearTimeout(run.current.timer); clearTimeout(run.current.search);
      setSpot(null);
      run.current.search = setTimeout(search, 150);
    };
    const dismiss = () => { if (run.current.id) { run.current.id += 1; clearTimeout(run.current.timer); clearTimeout(run.current.search); setSpot(null); } };
    const onKey = (e) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("lega:point", onPoint);
    window.addEventListener("keydown", onKey);
    // The next click (usually on the highlighted button itself) ends the highlight; capture so it runs first.
    window.addEventListener("pointerdown", dismiss, true);
    return () => {
      window.removeEventListener("lega:point", onPoint);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", dismiss, true);
      run.current.id += 1; clearTimeout(run.current.timer); clearTimeout(run.current.search);
    };
  }, []);

  if (!spot) return null;
  const { rect, label } = spot;
  const vw = window.innerWidth; const vh = window.innerHeight;
  const below = rect.bottom + 70 < vh || rect.top < 90;
  const ring = { left: Math.max(2, rect.left - PAD), top: Math.max(2, rect.top - PAD), width: Math.min(vw - 4, rect.width + PAD * 2), height: rect.height + PAD * 2 };
  const center = Math.min(vw - 24, Math.max(24, rect.left + rect.width / 2));
  const bubbleLeft = Math.min(vw - 16 - 260, Math.max(16, center - 130));
  return (
    <div className="lega-spot-layer">
      <div className="lega-spot-ring" style={ring} />
      <div className={`lega-spot-arrow ${below ? "below" : "above"}`} style={{ left: center - 11, top: below ? rect.bottom + PAD + 4 : rect.top - PAD - 26 }} />
      <div className="lega-spot-label" role="status" style={{ left: bubbleLeft, top: below ? rect.bottom + PAD + 28 : undefined, bottom: below ? undefined : vh - rect.top + PAD + 28 }}>
        <span className="lega-spot-by">Lega arată</span>{label}
      </div>
    </div>
  );
}
