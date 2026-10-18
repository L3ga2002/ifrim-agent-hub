// View model of the slot grid: what each slot shows and whether it can be chosen. Pure (no DOM), so node:test can check it.

/** What a slot that cannot be chosen says under its hour. */
const NOTES = Object.freeze({ booked: "Ocupat", past: "Trecut" });

/**
 * `slots` are the server's [{ start, time, status }], status "free" | "booked" | "past". Returns one entry per slot, in the
 * same order: { start, time, available, note }. `compact` is the narrow layout (two columns of short cards); otherwise the
 * desktop grid (six columns).
 */
export function layoutSlots(slots, { compact = false } = {}) {
  if (compact) {
    // Narrow screens: short cards, with the state under the hour.
    return slots.map((s) => ({ start: s.start, time: s.time, available: s.state !== "booked", note: NOTES[s.status] || "" }));
  }
  // Desktop: the state is written under the hour.
  return slots.map((s) => ({ start: s.start, time: s.time, available: s.status === "free", note: NOTES[s.status] || "" }));
}
