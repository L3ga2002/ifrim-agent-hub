// Observational preload only: the single calibration child identifies its own process instance.
import fs from "node:fs";
import { windowsProcessSnapshot } from "./s25-process-identity.mjs";
const file = process.env.S25_PROCESS_RECEIPT;
if (file) {
  const snapshot = windowsProcessSnapshot([process.pid]);
  const creationDate = snapshot.rows.find((row) => row.pid === process.pid)?.creationDate ?? null;
  const identity = { pid: process.pid, creationDate, startTime: creationDate ? Date.parse(creationDate) : null,
    startTimeSource: "Win32_Process.CreationDate", identityError: snapshot.error || (creationDate ? null : "Child absent from OS snapshot") };
  fs.appendFileSync(file, JSON.stringify({ ...identity, event: "start" }) + "\n");
  process.on("exit", (code) => fs.appendFileSync(file, JSON.stringify({ ...identity, event: "exit", code }) + "\n"));
}
