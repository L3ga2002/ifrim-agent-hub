// Pure slot logic of the booking demo: day keys, the 30-minute grid, overlap and the status of each slot. No I/O and no
// clock of its own: the caller passes `now`. Days and hours are the server's local time.

export const STEP_MIN = 30;
export const FIRST_START_MIN = 9 * 60; // 09:00
export const LAST_START_MIN = 16 * 60 + 30; // 16:30, so a day has 16 slots
export const DAYS_SHOWN = 3; // today, tomorrow, the day after

const pad2 = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a Date, in local time. */
export const dateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Minutes since local midnight of a Date. */
export const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

/** The same text when it is a real calendar day written "YYYY-MM-DD", otherwise null. */
export function parseDateKey(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(year, month - 1, day, 12);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day ? m[0] : null;
}

/** The day `n` days after a date key. Computed at noon, so a daylight-saving change never moves the result by a day. */
export function addDays(key, n) {
  const [year, month, day] = key.split("-").map(Number);
  return dateKey(new Date(year, month - 1, day + n, 12));
}

/** The date keys the demo shows for a clock: index 0 is today, then the next DAYS_SHOWN - 1 days. */
export const shownDays = (now) => Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(dateKey(now), index));

/** "HH:MM" of minutes since midnight. */
export const timeLabel = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/** Minutes since midnight of an "HH:MM" that is a slot start on the grid, otherwise null. */
export function parseSlotTime(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!m || Number(m[2]) > 59) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= FIRST_START_MIN && minutes <= LAST_START_MIN && (minutes - FIRST_START_MIN) % STEP_MIN === 0 ? minutes : null;
}

/** The slot id of a day and a start: "YYYY-MM-DDTHH:MM". */
export const slotStart = (date, startMin) => `${date}T${timeLabel(startMin)}`;

/** { date, startMin } of a slot id on the grid, otherwise null. */
export function parseSlotStart(value) {
  if (typeof value !== "string" || value.length !== 16 || value[10] !== "T") return null;
  const date = parseDateKey(value.slice(0, 10));
  const startMin = parseSlotTime(value.slice(11));
  return date && startMin !== null ? { date, startMin } : null;
}

/** Every slot start of a day, in minutes since midnight. */
export function slotStarts() {
  const starts = [];
  for (let minutes = FIRST_START_MIN; minutes <= LAST_START_MIN; minutes += STEP_MIN) starts.push(minutes);
  return starts;
}

/** Whether the half-open intervals [aStart, aEnd) and [bStart, bEnd) share at least one minute. */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Whether a slot can no longer be booked at `now`: its day has passed, or it starts at or before the current minute. */
export function isPast(date, startMin, now) {
  const today = dateKey(now);
  return date < today || (date === today && startMin <= minutesOfDay(now));
}

/**
 * The slots of one day for a service of `durationMin` minutes: [{ start, time, status }] in grid order. The workshop has one
 * bay, so `bookings` (that day's [{ startMin, endMin }]) block every service. status: "past" when the start is not in the
 * future, "booked" when the service would overlap a booking, otherwise "free".
 */
export function buildDaySlots({ date, durationMin, bookings = [], now }) {
  return slotStarts().map((startMin) => {
    const status = isPast(date, startMin, now) ? "past"
      : bookings.some((booking) => overlaps(startMin, startMin + durationMin, booking.startMin, booking.endMin)) ? "booked" : "free";
    return { start: slotStart(date, startMin), time: timeLabel(startMin), status };
  });
}
