// View model of the slot grid: what each slot shows and whether it can be chosen. Pure (no DOM), so node:test can check it.

/** What a slot that cannot be chosen says under its hour. */
const NOTES = Object.freeze({ booked: "Ocupat", past: "Trecut" });

/**
 * `slots` are the server's [{ start, time, status }], status "free" | "booked" | "past". Returns one entry per slot, in the
 * same order: { start, time, available, note }. `compact` is the narrow layout (two columns of short cards); otherwise the
 * desktop grid (six columns). Availability and notes are the same in both layouts.
 */
export function layoutSlots(slots, { compact = false } = {}) {
  // Both layouts use the server's status; only free slots can be chosen.
  return slots.map((s) => ({ start: s.start, time: s.time, available: s.status === "free", note: NOTES[s.status] || "" }));
}
