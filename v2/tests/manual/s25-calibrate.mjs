// No model and no Hub. Run sequentially; never overwrite historical calibration evidence.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sha256 } from "../../server/core/canonical.mjs";
import { parseTestOutput, testStatus } from "../../server/factory/runner.mjs";
import { parseTapCases, classifyProof, normalizeNeeds, lintTestBody } from "../../server/factory/test-first.mjs";
import { buildVariants } from "../fixtures/stage0-s25/variants.mjs";
import { buildDatasetVariants } from "../fixtures/stage0-s25/dataset-variants.mjs";
import { buildCorrectionProbes } from "../fixtures/stage0-s25/correction-probes.mjs";
import { s25Context, S25_APP, readS25, bodyOf, manifestOf } from "./s25-context.mjs";

export const CALIBRATION_TIMEOUT_MS = 20000; // Same bound as r-dataset.execute().
export const CALIBRATION_REF = ".ifrim-hub/staging/privacy.mjs";
const receiptModule = new URL("./s25-process-receipt.mjs", import.meta.url).href;
export const failureCategory = (c) => /^DATE MARTOR/.test(c.message) ? "dataset" : /^ID API/.test(c.message) ? "ids" : /^CONTROL ISTORIC/.test(c.message) ? "historical" : /^EXPUNERE/.test(c.message) ? "exposure" : "other";
export const errorClass = (c) => /HUB_/.test(c.message || "") ? "HUB_" : c.code === "ERR_ASSERTION" ? "ERR_ASSERTION" : /TypeError/.test(`${c.code} ${c.errorName} ${c.message}`) ? "TypeError" : "other";

/** The r-dataset execution/parsing machinery with bounded single-process isolation and process receipts. */
export function executeCalibration(dir, text, { name = "candidate", precondition = false } = {}) {
  const target = path.join(dir, CALIBRATION_REF), receipt = path.join(dir, "process-receipt.jsonl"), tmp = path.join(dir, "tmp");
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(target, text); fs.writeFileSync(receipt, "");
  const env = { ...process.env, TEMP: tmp, TMP: tmp, S25_PROCESS_RECEIPT: receipt };
  delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  const startedAt = new Date().toISOString(), t0 = performance.now();
  // One candidate file, no worker subprocess: the timeout owns exactly this child handle.
  // The body still runs under the unmodified header v2 and Node's real test runner.
  const run = spawnSync(process.execPath, ["--import", receiptModule, "--test", "--test-isolation=none", "--test-reporter=tap", CALIBRATION_REF],
    { cwd: dir, env, encoding: "utf8", timeout: CALIBRATION_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  const ms = Math.round(performance.now() - t0), output = String(run.stdout || ""), lines = output.split(/\r?\n/);
  const counts = parseTestOutput(lines).counts, tap = parseTapCases(lines), hung = run.error?.code === "ETIMEDOUT";
  const records = fs.readFileSync(receipt, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const processes = records.filter((r) => r.event === "start").map((r) => {
    let gone = false, verificationError = null;
    try { process.kill(r.pid, 0); } catch (e) { if (e.code === "ESRCH") gone = true; else verificationError = e.code || e.message; }
    return { pid: r.pid, startTime: r.startTime, startTimeSource: r.startTimeSource, exited: records.some((e) => e.event === "exit" && e.pid === r.pid && e.startTime === r.startTime), gone, verificationError };
  });
  const processesGone = processes.length === 1 && processes[0].pid === run.pid && processes.every((p) => p.gone);
  const failed = tap.cases.filter((c) => !c.ok);
  const cleanupOk = tap.cases.length > 0 && tap.cases.every((c) => c.cleanup?.ok === true) && tap.fileCleanup?.ok === true;
  const technical = !!run.error || !!run.signal || ![0, 1].includes(run.status) || !processesGone || !cleanupOk
    || !counts.tests || counts.tests !== tap.cases.length || (counts.cancelled || 0) > 0 || (counts.skipped || 0) > 0 || (counts.todo || 0) > 0
    || !!tap.fileLevelFailure || tap.overflow > 0 || failed.some((c) => errorClass(c) !== "ERR_ASSERTION");
  const status = testStatus({ exitCode: run.status, counts, timedOut: hung });
  const stopped = !technical && failed.length > 0 && failed.every((c) => /^CONTROL ISTORIC:.*13:00.*liber/.test(c.message));
  const verdict = technical ? "TECHNICAL_STOP" : precondition ? (stopped ? "PRECONDITION_STOP" : "PRECONDITION_NOT_DEMONSTRATED") : status.status === "PASS" ? "PASS" : failed.length ? "ASSERTION_REJECTION" : "TECHNICAL_STOP";
  return { name, ...status, verdict, pass: counts.pass ?? 0, tests: counts.tests ?? 0,
    failed: failed.map((c) => `${c.name}:${failureCategory(c)}:${errorClass(c) === "ERR_ASSERTION" ? "assertion" : errorClass(c)}`),
    errors: failed.map((c) => ({ name: c.name, errorClass: errorClass(c), code: c.code, message: c.message })),
    ms, durationMs: ms, startedAt, hung, cleanupOk, processesGone, processes, runnerPid: run.pid ?? null,
    exitCode: run.status, signal: run.signal, error: run.error ? { code: run.error.code, message: run.error.message } : null,
    counts, ...tap, output, stderr: String(run.stderr || ""), timedOut: hung,
    asExpected: precondition ? verdict === "PRECONDITION_STOP" : name === "CORRECT" ? verdict === "PASS" : verdict === "ASSERTION_REJECTION" };
}

export async function calibrateS25({ candidate, text = candidate && fs.readFileSync(candidate, "utf8"), manifest = text && manifestOf(text), onRun = () => {} } = {}) {
  if (typeof text !== "string") throw new Error("An assembled candidate is required");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s25-calibrate-"));
  try {
    const ctx = s25Context(root), body = bodyOf(text), needs = normalizeNeeds(body, manifest.needs);
    manifest = { ...manifest, needs: needs.effective, needsDeclared: needs.declared, needsCompleted: needs.completed };
    const lint = lintTestBody(body, { manifest, criteria: ctx.spec.acceptance, workType: ctx.spec.workType, testRef: ctx.spec.authoring.testRef,
      stagingRef: CALIBRATION_REF, projectFiles: ctx.facts.files, moduleExports: ctx.facts.exports, spec: ctx.spec });
    const source = fs.readFileSync(path.join(S25_APP, "src/server-app.js"), "utf8");
    const correct = source.replace("phone: row.phone, ", "");
    const { DEFECTIVE, extra } = buildVariants(source.replaceAll("\r\n", "\n"), readS25), ds = buildDatasetVariants(correct);
    const variants = { ...DEFECTIVE, ...extra, ...ds }, probes = buildCorrectionProbes(correct);
    if (Object.keys(DEFECTIVE).length !== 29 || Object.keys(extra).length !== 8 || Object.keys(ds).length !== 4 || Object.keys(variants).length !== 41) throw new Error("Historical variant inventory changed");
    const result = { schema: "s25-calibration-2.14.16/v1", candidateSha: sha256(text), specSha: ctx.sha, node: process.execPath, nodeVersion: process.version,
      timeoutMs: CALIBRATION_TIMEOUT_MS, isolation: "none (one file, one owned child)", lint, manifest, matrix: [], originalRuns: [], proof: null, correctionProbes: { defects: [], preconditions: [] } };
    if (!lint.ok) { result.stop = "Candidate lint failed"; return result; }
    const execute = (name, code, precondition = false) => {
      fs.writeFileSync(path.join(ctx.dir, "src/server-app.js"), code);
      const run = executeCalibration(ctx.dir, text, { name, precondition }); onRun(run); return run;
    };
    result.matrix.push(execute("CORRECT", correct));
    if (result.matrix[0].verdict !== "PASS") { result.stop = "Correct app did not pass cleanly"; return result; }
    for (let i = 0; i < 2; i++) {
      const run = execute("original", source); result.originalRuns.push(run);
      if (run.verdict === "TECHNICAL_STOP") { result.stop = "Original run stopped technically"; return result; }
    }
    result.proof = classifyProof({ runs: result.originalRuns, manifest, criteria: ctx.spec.acceptance, workType: ctx.spec.workType,
      testRef: CALIBRATION_REF, spec: ctx.spec, test: { text, headerLines: text.split("\n").indexOf("// ---- corpul testului ----") + 1, refs: ["privacy.mjs"], harness: 2 } });
    for (const [name, code] of Object.entries(variants)) {
      const run = execute(name, code); result.matrix.push(run);
      if (run.verdict === "TECHNICAL_STOP") { result.stop = "Variant stopped technically"; return result; }
    }
    for (const [group, entries] of Object.entries(probes)) for (const [name, code] of Object.entries(entries)) {
      const run = execute(name, code, group === "preconditions"); result.correctionProbes[group].push(run);
      if (run.verdict === "TECHNICAL_STOP") { result.stop = "Correction probe stopped technically"; return result; }
    }
    result.ok = result.proof.verdict === "PROVEN" && result.matrix.every((r) => r.asExpected)
      && result.correctionProbes.defects.every((r) => r.verdict === "ASSERTION_REJECTION")
      && result.correctionProbes.preconditions.every((r) => r.verdict === "PRECONDITION_STOP");
    return result;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--candidate" || args[2] !== "--out") throw new Error("Usage: node v2/tests/manual/s25-calibrate.mjs --candidate <assembled test file> --out <new json>");
  const out = path.resolve(args[3]);
  if (fs.existsSync(out)) throw new Error("Output exists; use a NEW evidence identity");
  const result = await calibrateS25({ candidate: path.resolve(args[1]), onRun: (r) => console.log(`${r.name}: ${r.verdict} ${r.pass}/${r.tests}, cleanup=${r.cleanupOk}, processesGone=${r.processesGone}`) });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.exitCode = result.ok ? 0 : 1;
}
