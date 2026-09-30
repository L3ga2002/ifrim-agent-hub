import { useMemo } from "react";

const STATUS_RO = { DRAFT: "ciornă", QUEUED: "în coadă", PLANNING: "planificare", RUNNING: "rulează", WAITING_APPROVAL: "aprobare", WAITING_PROVIDER: "provider",
  BLOCKED: "blocat", PAUSED: "pauză", VERIFYING: "verificare", COMPLETED: "finalizat", FAILED: "eșuat", CANCELLED: "anulat" };

/**
 * Dependency graph of a mission's tasks. Nodes are real tasks, edges are real `depends_on` links;
 * nothing is drawn that the data does not contain. Each node is a keyboard-focusable button.
 */
export function TaskGraph({ tasks, onOpen }) {
  const layout = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const level = new Map();
    const depth = (t, seen = new Set()) => {
      if (level.has(t.id)) return level.get(t.id);
      if (seen.has(t.id)) return 0;
      seen.add(t.id);
      const d = t.dependsOn.length ? 1 + Math.max(...t.dependsOn.map((id) => (byId.has(id) ? depth(byId.get(id), seen) : 0))) : 0;
      level.set(t.id, d);
      return d;
    };
    tasks.forEach((t) => depth(t));
    const columns = [];
    for (const t of tasks) { const d = level.get(t.id); (columns[d] ||= []).push(t); }
    const W = 188; const H = 58; const GX = 56; const GY = 18;
    const pos = new Map();
    columns.forEach((col, x) => col.forEach((t, y) => pos.set(t.id, { x: 12 + x * (W + GX), y: 12 + y * (H + GY) })));
    const width = 24 + columns.length * (W + GX) - GX;
    const height = 24 + Math.max(...columns.map((c) => c.length)) * (H + GY) - GY;
    const edges = tasks.flatMap((t) => t.dependsOn.filter((id) => pos.has(id)).map((id) => ({ from: pos.get(id), to: pos.get(t.id), key: `${id}-${t.id}` })));
    return { pos, width, height, edges, W, H };
  }, [tasks]);

  if (!tasks.length) return null;
  const { pos, width, height, edges, W, H } = layout;
  return (
    <div className="graph">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group" aria-label="Graful dependențelor dintre taskuri">
        {edges.map((e) => <path key={e.key} className="edge" d={`M${e.from.x + W} ${e.from.y + H / 2} C ${e.from.x + W + 28} ${e.from.y + H / 2}, ${e.to.x - 28} ${e.to.y + H / 2}, ${e.to.x} ${e.to.y + H / 2}`} />)}
        {tasks.map((t) => {
          const p = pos.get(t.id);
          return (
            <g key={t.id} className={`node s-${t.status}`} transform={`translate(${p.x},${p.y})`} tabIndex={0} role="button"
              aria-label={`${t.title}, ${STATUS_RO[t.status] || t.status}, rol ${t.roleId}`}
              onClick={() => onOpen?.(t)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(t); } }} style={{ cursor: "pointer" }}>
              <rect width={W} height={H} rx="6" />
              <text x="12" y="23">{t.title.length > 24 ? `${t.title.slice(0, 23)}…` : t.title}</text>
              <text x="12" y="43" className="meta">{t.roleId || "—"} · {STATUS_RO[t.status] || t.status}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
