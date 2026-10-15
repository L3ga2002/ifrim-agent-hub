// Windows-only verification runner for SPEC_2.14.17_A: one system-Node test file at a time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = path.join(root, ".tmp-s25-a", "part-a-results"), tmp = path.join(dir, "tmp");
fs.mkdirSync(tmp, { recursive: true });
const selections = {
  "stage-finalizare": "^FZ-(0[1-689]|1[0-9])",
  "m11-fixture": "M11-FX-(01|06|07|13|14|15) ",
  "r-priv-rev": "^(RP-(0[1-6]|09|11)|RR-01)",
  "r-media-holds": "^RM-0[1-9] ",
  "m10-studio": "M10-ST-(04|05|13) ",
  "m11-ui-logic": "M11-UI-(0[1-9]|1[0-689]|2[0-9]) ",
};
const all = ["r-claims", "m11-template", "m11-clip-ir", "m11-summary", "m11-fixture", "m09-media-ir", "m09-media-qa", "m09-content", "m11-ui-logic", "stage-finalizare", "r-priv-rev", "r-media-holds", "m11-revision-parse", "m10-studio"];
const files = process.argv.length > 2 ? process.argv.slice(2) : all;
for (const file of files) {
  if (!all.includes(file)) throw Error("Unknown suite: " + file);
  const args = ["--test", "--test-concurrency=1", "--test-reporter=tap", ...(selections[file] ? ["--test-name-pattern=" + selections[file]] : []), "v2/tests/" + file + ".test.mjs"];
  const result = spawnSync("C:/Program Files/nodejs/node.exe", args, { cwd: root, encoding: "utf8", windowsHide: true,
    env: { ...process.env, TEMP: tmp, TMP: tmp, NODE_OPTIONS: "--import=" + new URL("fixtures/claims-offline-guard.mjs", import.meta.url).href }, maxBuffer: 15 * 1024 * 1024 });
  const output = (result.stdout || "") + (result.stderr || "");
  fs.writeFileSync(path.join(dir, file + ".tap"), output);
  const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled"].map(k => [k, Number(output.match(new RegExp("^# " + k + " (\\d+)", "m"))?.[1] ?? -1)]));
  fs.writeFileSync(path.join(dir, file + ".json"), JSON.stringify({ file, args, status: result.status, counts }, null, 2) + "\n");
  console.log(JSON.stringify({ file, status: result.status, ...counts }));
  if (result.status !== 0) { process.exitCode = 1; console.log(output.split("\n").filter(line => line.startsWith("not ok") || line.includes("error:")).join("\n")); }
}
