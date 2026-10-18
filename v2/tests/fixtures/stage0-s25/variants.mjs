// Fixed synthetic defect inventory shared by the historic and harness-v2 calibrations.
export function buildVariants(source, read) {
const correct = source.replace("phone: row.phone, ", "");
const listLine = 'return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });';
const atRestart = (statement) => correct.replace('  let closed = false;', `  ${statement}\n  let closed = false;`);
const rememberExisting = atRestart('const existingIds = new Set(db.prepare("SELECT id FROM bookings").all().map((r) => r.id));');
const existingVariants = {
  "seed ignored, leak only before restart": rememberExisting.replace('if (!seed) return;', 'return;').replace('map(publicBooking)', 'map((r) => existingIds.has(r.id) ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "existing record absent after restart": atRestart('db.exec("DELETE FROM bookings");'),
  "existing record on another day": atRestart('db.exec("UPDATE bookings SET day = char(50,48,50,54,45,49,48,45,49,50)");'),
  "existing phone not persisted": atRestart('db.exec("UPDATE bookings SET phone = char(32)");'),
};
const listVariants = {};
for (const [name, records] of [["empty list", "[]"], ["existing omitted", "rows.filter((r) => !existingIds.has(r.id)).map(publicBooking)"], ["ids only in metadata", "[]"]]) {
  for (const parameter of [false, true]) {
    listVariants[`${name}, ${parameter ? "debug" : "base"}`] = rememberExisting.replace(listLine,
      `const rows = sql.ofDay.all(day.date); return sendJson(req, res, 200, { date: day.date, bookings: ${parameter ? `query.has("debug") ? ${records} : rows.map(publicBooking)` : records}${name === "ids only in metadata" ? ", ids: rows.map((r) => r.id)" : ""} });`);
  }
}

// Fixed inventory: the original, sixteen historic defects, the c8 miss, four existence and six list defects, and initial-row exposure.
const DEFECTIVE = {
  original: source,
  "refuse-all": correct.replace('if (!phone) errors.phone', 'if (true) errors.phone'),
  "phone lost on save": correct.replace('name, vehicle, phone, 0,', 'name, vehicle, "", 0,'),
  "browser-only validation": correct.replace('if (!phone) errors.phone = "Telefonul este obligatoriu";', ''),
  "masked value": source.replace('phone: row.phone,', 'phone: "***",'),
  "includePhone bypass": correct.replace('map(publicBooking)', 'map((r) => query.has("includePhone") ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "debug other key": correct.replace('map(publicBooking)', 'map((r) => query.has("debug") ? { ...publicBooking(r), extra: r.phone } : publicBooking(r))'),
  "empty list": correct.replace('sql.ofDay.all(day.date).map(publicBooking)', '[]'),
  "invalid request saved": correct.replace('if (Object.keys(errors).length) return invalid(req, res, errors);\n\n    const endMin', 'if (Object.keys(errors).length) { sql.insert.run("bad", service.id, slot.date, slot.startMin, slot.startMin + service.durationMin, name, vehicle, phone, 0, at.toISOString()); return invalid(req, res, errors); }\n\n    const endMin'),
  "missing-property accepted": correct.replace('if (!phone) errors.phone', 'if (Object.hasOwn(input, "phone") && !phone) errors.phone'),
  "id only in metadata": correct.replace(listLine, 'return sendJson(req, res, 200, { date: day.date, bookings: [], ids: sql.ofDay.all(day.date).map((r) => r.id) });'),
  "fields=phone other key": correct.replace('map(publicBooking)', 'map((r) => query.get("fields") === "phone" ? { ...publicBooking(r), contact: r.phone } : publicBooking(r))'),
  "phone in text": correct.replace('map(publicBooking)', 'map((r) => ({ ...publicBooking(r), note: "Tel " + r.phone + " (sună)" }))'),
  "phone as key": correct.replace('map(publicBooking)', 'map((r) => ({ ...publicBooking(r), [r.phone]: true }))'),
  "escaped key and value": source.replace(listLine, read("variant-escape-key-value.js.txt").trim()),
  "escaped value other key": correct.replace(listLine, read("variant-escape-other-key.js.txt").trim()),
  "existing records only": correct.replace('map(publicBooking)', 'map((r) => r.start_min >= 660 ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "escape in text other key": correct.replace(listLine, read("variant-escape-in-text-other-key.js.txt").trim()),
  "seed ignored, leak only before restart": existingVariants["seed ignored, leak only before restart"],
  "existing record absent after restart": existingVariants["existing record absent after restart"],
  "existing record on another day": existingVariants["existing record on another day"],
  "existing phone not persisted": existingVariants["existing phone not persisted"],
  "empty list, base": listVariants["empty list, base"],
  "empty list, debug": listVariants["empty list, debug"],
  "existing omitted, base": listVariants["existing omitted, base"],
  "existing omitted, debug": listVariants["existing omitted, debug"],
  "ids only in metadata, base": listVariants["ids only in metadata, base"],
  "ids only in metadata, debug": listVariants["ids only in metadata, debug"],
  "seed rows only": correct.replace('map(publicBooking)', 'map((r) => r.synthetic === 1 ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
};

const initialVariants = {
  "initial data not created": correct.replace('if (!seed) return;', 'return;'),
  "initial data without phone": correct.replace('"0700 123 456"', '""'),
};
const omittedVariants = {
  "initial rows omitted": correct.replace('map(publicBooking)', 'filter((r) => r.synthetic !== 1).map(publicBooking)'),
  "kept row omitted": rememberExisting.replace('map(publicBooking)', 'filter((r) => !existingIds.has(r.id) || r.synthetic === 1).map(publicBooking)'),
  "new row omitted": rememberExisting.replace('map(publicBooking)', 'filter((r) => existingIds.has(r.id)).map(publicBooking)'),
};
const parameterConditions = [
  ["seed rows only under any parameter", '[...query.keys()].length > 1 && r.synthetic === 1'],
  ["threshold only under any parameter", '[...query.keys()].length > 1 && r.start_min >= 660'],
  ["seed rows only under all=1", 'query.has("all") && r.synthetic === 1'],
];
const parameterVariants = Object.fromEntries(parameterConditions.map(([name, condition]) => [name, correct.replace('map(publicBooking)', 'map((r) => ' + condition + ' ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))')]));
return { DEFECTIVE, listVariants, initialVariants, omittedVariants, parameterVariants, parameterConditions, extra: { ...initialVariants, ...omittedVariants, ...parameterVariants } };
}
