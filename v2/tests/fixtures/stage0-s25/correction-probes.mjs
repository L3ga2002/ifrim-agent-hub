// Coordinator's verified T-001..T-003 probes. Deliberately outside the historical 29 + 8 + 4 inventory.
export function buildCorrectionProbes(correct) {
  const one = (from, to) => {
    if (correct.split(from).length !== 2) throw new Error(`Expected exactly one correction site: ${from}`);
    return correct.replace(from, to);
  };
  const listLine = 'return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });';
  const slotsCall = "slots: buildDaySlots({ date: day.date, durationMin: service.durationMin, bookings, now: at })";
  return {
    defects: {
      "initial data phone lost at restart": one("  let closed = false;", '  db.exec("UPDATE bookings SET phone = char(32) WHERE synthetic = 1");\n  let closed = false;'),
      "historical row changed by debug, restored by next request": one(listLine, `db.prepare(query.has("debug") ? "UPDATE bookings SET phone = '0700 000 000' WHERE phone = ''" : "UPDATE bookings SET phone = '' WHERE phone = '0700 000 000'").run(); ${listLine}`),
    },
    preconditions: {
      "13:00 not free before historical insertion": one(slotsCall, `${slotsCall}.map((s) => s.time === "13:00" ? { ...s, status: "booked" } : s)`),
    },
  };
}
