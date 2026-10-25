// Romanian counts and civil time; the host timezone never participates.
export function roCount(n, { one, many, gender = "f", article = false, none = null } = {}) {
  if (n === 0 && none !== null) return none;
  if (n === 1) return `${article ? gender === "f" ? "o" : "un" : "1"} ${one}`;
  return `${new Intl.NumberFormat("ro-RO").format(n)}${n !== 0 && (n % 100 === 0 || n % 100 >= 20) ? " de" : ""} ${many}`;
}
export function roList(items = []) { return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} și ${items.at(-1)}`; }
export function bucharestParts(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return { time: "—", weekday: "—", date: "—", dateShort: "—" };
  const fmt = (options) => new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", ...options }).format(d);
  return { time: fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), weekday: fmt({ weekday: "long" }), date: fmt({ day: "numeric", month: "long", year: "numeric" }), dateShort: fmt({ day: "numeric", month: "short" }) };
}
