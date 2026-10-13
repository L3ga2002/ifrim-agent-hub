import assert from "node:assert/strict";

/** Each bounded defect changes exactly one site in the correct synthetic app. */
export function buildDatasetVariants(correct) {
  const replace = (from, to) => {
    assert.equal(correct.split(from).length, 2, `replacement must have exactly one site: ${from}`);
    const changed = correct.replace(from, to);
    assert.notEqual(changed, correct);
    return changed;
  };
  const post = "return sendJson(req, res, 201, { booking: publicBooking(row) });";
  return {
    "returned id differs": replace(post, 'return sendJson(req, res, 201, { booking: { ...publicBooking(row), id: "wrong-" + row.id } });'),
    "second returned id differs": replace(post, 'return sendJson(req, res, 201, { booking: { ...publicBooking(row), id: db.prepare("SELECT id FROM bookings WHERE day = ? AND synthetic = 0 AND id != ?").get(row.day, row.id) ? "wrong-" + row.id : row.id } });'),
    "historical phone filled": replace("  let closed = false;", '  db.prepare("UPDATE bookings SET phone = ? WHERE phone = ?").run("0700 999 999", "");\n  let closed = false;'),
    "historical row omitted": replace("sql.ofDay.all(day.date).map(publicBooking)", 'sql.ofDay.all(day.date).filter((row) => row.phone !== "").map(publicBooking)'),
  };
}
