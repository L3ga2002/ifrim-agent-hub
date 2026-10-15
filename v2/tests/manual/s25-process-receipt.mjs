// Observational preload only: the single calibration child identifies its own process instance.
import fs from "node:fs";
const file = process.env.S25_PROCESS_RECEIPT;
if (file) {
  const identity = { pid: process.pid, startTime: performance.timeOrigin, startTimeSource: "node.performance.timeOrigin" };
  fs.appendFileSync(file, JSON.stringify({ ...identity, event: "start" }) + "\n");
  process.on("exit", (code) => fs.appendFileSync(file, JSON.stringify({ ...identity, event: "exit", code }) + "\n"));
}
