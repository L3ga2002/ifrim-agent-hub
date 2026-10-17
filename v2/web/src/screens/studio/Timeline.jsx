import { useMemo } from "react";
import { timelineLayout, activeItemIds, formatTimecode, fmtSeconds } from "../../lib/studioLogic.js";
import { Empty } from "../../components/ui.jsx";

/**
 * Read-only timeline inspector of an EditProjectIR: one lane per track (video clips with their capture labels — SIMULATION,
 * REPLAY… —, text items, captions, audio). Clicking an item seeks the player to its start. The playhead follows the player.
 * Editing happens only through proposals (Corectură la timecode) or a new edit version, never by dragging here.
 */
export function TimelineInspector({ ir, currentMs = 0, onSeek }) {
  const layout = useMemo(() => timelineLayout(ir), [ir]);
  const active = activeItemIds(layout, currentMs);
  if (!ir || !layout.lanes.length) return <Empty title="Fără timeline">Versiunea nu are piste de afișat.</Empty>;
  const head = layout.durationMs ? Math.min(100, (currentMs / layout.durationMs) * 100) : 0;
  return (
    <div className="studio-timeline" aria-label={`Timeline, durata ${fmtSeconds(layout.durationMs)}`}>
      <div className="studio-ruler faint small" aria-hidden="true">
        <span>00:00.00</span><span>{formatTimecode(layout.durationMs / 2, layout.fps).clock}</span><span>{formatTimecode(layout.durationMs, layout.fps).clock}</span>
      </div>
      {layout.lanes.map((lane) => (
        <div key={lane.id} className={`studio-lane lane-${lane.kind}`}>
          <div className="studio-lane-label small">{lane.label}</div>
          <div className="studio-lane-track">
            <span className="studio-playhead" style={{ left: `${head}%` }} aria-hidden="true" />
            {lane.items.map((it) => {
              const isActive = active.has(`${lane.id}:${it.id}`);
              const tc = formatTimecode(it.startMs, layout.fps).clock;
              const name = `${lane.label}: ${it.badge ? `${it.badge} · ` : ""}${it.text || it.id}, de la ${tc} la ${formatTimecode(it.endMs, layout.fps).clock}`;
              return (
                <button key={it.id} type="button" className={`studio-item item-${it.kind}${isActive ? " is-active" : ""}${it.badge ? " has-badge" : ""}`}
                  style={{ left: `${it.leftPct}%`, width: `${it.widthPct}%` }} title={name} aria-label={`${name}. Mergi la început`} onClick={() => onSeek?.(it.startMs)}>
                  <span className="studio-item-text">{it.badge ? <strong>{it.badge} </strong> : null}{it.text || it.id}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** explainEdit lines from GET /api/media/edit-versions/<id> (interval, material, movement, text, sound, reason), each seekable. */
export function ExplainEdit({ explain, onSeek }) {
  if (!explain?.entries?.length) return <p className="faint small">Explicația montajului nu e disponibilă pentru această versiune.</p>;
  return (
    <ol className="studio-explain">
      {explain.entries.map((e, i) => (
        <li key={e.clipId || i}>
          <button type="button" className="link-btn" onClick={() => onSeek?.(e.fromMs)} aria-label={`Mergi la ${fmtSeconds(e.fromMs)}`}><span className="mono">{fmtSeconds(e.fromMs)}–{fmtSeconds(e.toMs)}</span></button>
          <span> {explain.lines?.[i] ? explain.lines[i].replace(/^\d+\.\s*[^·]*·\s*/, "") : `${e.asset} · ${e.movement} · ${e.reason}`}</span>
        </li>
      ))}
    </ol>
  );
}
