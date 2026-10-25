import { utcToZoned, zonedToUtc } from "../media/distribution.mjs";

export const TZ = "Europe/Bucharest";
export function bucharestDayStart(now = new Date(), dayOffset = 0) {
  const local = utcToZoned(new Date(now).toISOString(), TZ).local.slice(0, 10);
  const day = new Date(`${local}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + dayOffset);
  return new Date(zonedToUtc(`${day.toISOString().slice(0, 10)}T00:00`, TZ).utc);
}
export const hhmm = (iso) => new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const dayMonth = (iso) => new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
export const dateTimeRo = (iso) => `${dayMonth(iso)}, ${hhmm(iso)}`;
export function roCount(n, { one, many, gender = "f", article = false, none = null }) {
  if (n === 0 && none !== null) return none;
  if (n === 1) return `${article ? gender === "f" ? "o" : "un" : "1"} ${one}`;
  return `${new Intl.NumberFormat("ro-RO").format(n)}${n !== 0 && (n % 100 === 0 || n % 100 >= 20) ? " de" : ""} ${many}`;
}
export const roList = (parts) => parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} și ${parts.at(-1)}`;
