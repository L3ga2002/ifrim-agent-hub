import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, Minimize2, X } from "lucide-react";
import { usePref } from "../../store.js";
import { useRead } from "../command/Recap.jsx";
import { CompanyGraph, Department } from "../command/Company.jsx";
import { departmentStyle } from "../../lib/companyGraph.js";
import { MAP_ZOOM, normalizeMapState, zoomLabel } from "../../lib/legaMapView.js";
import { ErrorNotice, Loading } from "../../components/ui.jsx";

/** Successive wheel events closer than this count once (a trackpad sends dozens per gesture). */
const WHEEL_GAP_MS = 140;

/**
 * 2.19.1: the company map on the L3ga screen — the readable map of M16 (departments, counters, the department's roles, skills, tools
 * and work), big enough to read: zoom with the buttons, the mouse wheel or by voice („mărește harta”, „harta pe tot ecranul”), drag to
 * move it when it is bigger than the panel. A department opens here, without leaving the conversation. Reads only.
 */
export function MapPanel({ map, onAction, department, onDepartment, shape, coreState, go }) {
  const view = normalizeMapState(map);
  const graphRead = useRead("/api/company/graph");
  const graph = graphRead.data;
  const [decor, setDecor] = usePref("command.decor", true);
  const viewport = useRef(null);
  const act = useRef(onAction);
  act.current = onAction;
  const [dragging, setDragging] = useState(false);
  // The wheel zooms the map (never the page) while the pointer is over it.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    let last = 0;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last < WHEEL_GAP_MS) return;
      last = now;
      act.current(e.deltaY < 0 ? "zoom_in" : "zoom_out");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // Drag to move a map bigger than its panel (a click on a department stays a click).
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("button, a, input, select")) return;
    const el = viewport.current;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    viewport.current.scrollLeft = d.left - (e.clientX - d.x);
    viewport.current.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = (e) => { if (drag.current?.id === e.pointerId) { drag.current = null; setDragging(false); } };
  const name = department ? (graph?.departments || []).find((d) => d.key === department)?.labelRo : null;
  return (
    <section className={`lega-map${view.full ? " is-full" : ""}`} aria-label="Harta companiei" style={{ "--map-zoom": view.zoom }}>
      <header className="lega-map-bar">
        <strong className="lega-map-title">Harta companiei{name ? ` · ${name}` : ""}</strong>
        <div className="row wrap lega-map-tools" role="group" aria-label="Harta">
          {department && <button type="button" className="btn sm ghost" onClick={() => onDepartment(null)}>‹ Toată compania</button>}
          <button type="button" className="btn sm icon" onClick={() => onAction("zoom_out")} disabled={view.zoom <= MAP_ZOOM.min} aria-label="Micșorează harta" title="Micșorează (rotița în jos)"><ZoomOut size={15} /></button>
          <span className="lega-map-zoom" aria-live="polite" aria-label={`Mărirea hărții: ${zoomLabel(view)}`}>{zoomLabel(view)}</span>
          <button type="button" className="btn sm icon" onClick={() => onAction("zoom_in")} disabled={view.zoom >= MAP_ZOOM.max} aria-label="Mărește harta" title="Mărește (rotița în sus)"><ZoomIn size={15} /></button>
          <button type="button" className="btn sm ghost" aria-pressed={view.full} onClick={() => onAction(view.full ? "reset" : "full")} title={view.full ? "Revino la ecranul cu conversația" : "Harta pe tot ecranul; conversația se minimizează"}>
            {view.full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{view.full ? "Ieși de pe tot ecranul" : "Pe tot ecranul"}</button>
          <button type="button" className="btn sm icon ghost" onClick={() => onAction("close")} aria-label="Închide harta" title="Închide harta"><X size={15} /></button>
        </div>
      </header>
      <div className={`lega-map-viewport${dragging ? " is-dragging" : ""}`} ref={viewport} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="command lega-map-canvas" data-variant="A" style={departmentStyle}>
          {graph
            ? department
              ? <Department graph={graph} departmentKey={department} display={false} onDepartment={onDepartment} onSheet={(sheetId) => go(`/comanda?vedere=sheet&fisa=${encodeURIComponent(sheetId)}`)} />
              : <CompanyGraph shape={shape} coreState={coreState} graph={graph} display={false} hideNumbers={false} decor={decor} setDecor={setDecor} onDepartment={onDepartment} />
            : graphRead.error ? <ErrorNotice error={graphRead.error} /> : <Loading lines={4} />}
        </div>
      </div>
      <p className="faint small lega-map-hint">Rotița mouse-ului mărește și micșorează; trage ca să muți harta. Poți spune „mărește harta”, „harta pe tot ecranul”, „la vânzări”, „închide harta”.</p>
    </section>
  );
}
