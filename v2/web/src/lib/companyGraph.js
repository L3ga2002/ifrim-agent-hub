export const DEPT_CODES = Object.freeze({ executive: "EX", product: "PR", engineering: "EN", "qa-security": "QA", devops: "DO", sales: "VZ", marketing: "MK", "customer-success": "CS", "project-management": "PM", operations: "OP", research: "CE", "finance-admin": "FA" });
/** Stable order from the configuration (never from counts); `rx` / `ry` give an ellipse in percent of the map width / height. */
export function radialLayout(departments = [], { cx = 50, cy = 50, r = 32, rx = r, ry = r } = {}) { return departments.map((d, i) => { const angle = -90 + i * 360 / departments.length; return { ...d, angle, x: cx + Math.cos(angle * Math.PI / 180) * rx, y: cy + Math.sin(angle * Math.PI / 180) * ry }; }); }
export function carousel(departments = [], key, dir) { if (!departments.length) return null; const i = departments.findIndex((d) => d.key === key); return departments[(Math.max(0, i) + (dir === "prev" || dir === -1 ? -1 : 1) + departments.length) % departments.length].key; }
export function relationsOf(graph, nodeId) { return (graph?.edges || []).filter((e) => e.from === nodeId || e.to === nodeId); }
export function departmentDetail(graph, key) {
  const department = graph?.departments?.find((d) => d.key === key) || null;
  const all = graph?.edges || [], selected = new Set([`dept:${key}`]);
  const linked = (kind, nodes) => { for (const e of all) if (kind.includes(e.kind) && (nodes.has(e.from) || nodes.has(e.to))) { selected.add(e.from); selected.add(e.to); } };
  linked(["dept_role", "work_dept"], new Set(selected));
  linked(["role_skill", "role_tool", "work_role"], new Set([...selected].filter((id) => id.startsWith("role:"))));
  linked(["skill_tool"], new Set([...selected].filter((id) => id.startsWith("skill:"))));
  const edges = all.filter((e) => selected.has(e.from) && selected.has(e.to));
  const records = (name, prefix, id) => (graph?.[name] || []).filter((x) => selected.has(`${prefix}:${x[id]}`));
  return { department, roles: records("roles", "role", "id"), skills: (graph?.skills || []).filter((s) => selected.has(`skill:${s.name}`) || selected.has(`skill:${s.id}`)), tools: records("tools", "tool", "id"), works: records("works", "work", "missionId"), edges };
}

export const DEPARTMENT_COLORS = Object.freeze(["#8732FE", "#32FE32", "#FE32BA", "#3265CB", "#FEFE32", "#766576", "#54A932", "#FEBAFE", "#FE3232", "#657643", "#FEEDED", "#CB76FE"]);
export const departmentStyle = Object.freeze(Object.fromEntries(DEPARTMENT_COLORS.map((c,i) => [`--dept-${i+1}`, c])));
