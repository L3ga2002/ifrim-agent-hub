// Shared deterministic §25 fixture/spec construction. No Hub, git, credentials or providers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngineeringSpec } from "../../server/owner/planners/engineering.mjs";
import { checkSpec, specHash } from "../../server/factory/spec.mjs";
import { exportNamesOf } from "../../server/factory/test-first.mjs";

export const S25_WORDS = "Telefonul rămâne obligatoriu și salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze";
export const S25_FIXTURE = fileURLToPath(new URL("../fixtures/stage0-s25/", import.meta.url));
export const S25_APP = fileURLToPath(new URL("../fixtures/r-priv-booking/", import.meta.url));
export const readS25 = (name) => fs.readFileSync(path.join(S25_FIXTURE, name), "utf8");
export const bodyOf = (text) => text.split("// ---- corpul testului ----\n")[1];
export function manifestOf(text) {
  const body = bodyOf(text);
  if (body === undefined) throw new Error("Candidate must be an assembled Hub test");
  const cases = [...body.matchAll(/^test\("(AC-\d+(?: control)?: [^"\n]+)"/gm)].map(([, name]) => ({
    name, criterion: name.match(/^AC-\d+/)[0], kind: name.includes(" control:") ? "control" : "check", today: name.includes(" control:") ? "pass" : "fail",
  }));
  if (!cases.length) throw new Error("No candidate cases");
  return { needs: [], newApi: [], removed: [], api: "GET /api/bookings; GET /api/slots; POST /api/bookings; node:sqlite", cases };
}
export function s25Context(root, { words = S25_WORDS } = {}) {
  const dir = path.join(root, "booking");
  fs.cpSync(S25_APP, dir, { recursive: true, filter: (src) => path.basename(src) !== "SOURCE.md" });
  fs.writeFileSync(path.join(dir, ".ifrim-hub-test.json"), JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", fixture: "booking-demo", data: "synthetic" }));
  const built = buildEngineeringSpec({ text: words, project: { id: "prj_mv8c3o17_5ec1fb44d4", source: "hub-test", path: dir, name: "Repetiție izolată §25" } });
  if (built.problems.length) throw new Error(JSON.stringify(built.problems));
  const checked = checkSpec({ workType: built.input.workType, title: built.input.title, objective: built.input.objective, ...built.input.spec });
  if (checked.problems.length) throw new Error(JSON.stringify(checked.problems));
  const files = fs.readdirSync(dir, { recursive: true }).filter((rel) => fs.statSync(path.join(dir, rel)).isFile()).map((rel) => rel.replaceAll("\\", "/"));
  const exports = Object.fromEntries(files.filter((rel) => rel.startsWith("src/") && rel.endsWith(".js")).map((rel) => [rel, exportNamesOf(fs.readFileSync(path.join(dir, rel), "utf8"))]));
  return { dir, spec: checked.spec, sha: specHash(checked.spec), facts: { files, exports }, built };
}
