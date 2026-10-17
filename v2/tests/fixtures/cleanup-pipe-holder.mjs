// Both processes are bounded. The descendant alone keeps the supervisor's stdout open.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--descendant")) {
  setTimeout(() => {}, 18000);
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--descendant"], {
    detached: true, windowsHide: true, stdio: ["ignore", process.stdout, "ignore"],
  });
  child.once("spawn", () => {
    process.stdout.write(`${JSON.stringify({ pid: child.pid, parentPid: process.pid, creationDate: new Date().toISOString(), name: "node.exe" })}\n`, () => {
      child.unref();
      // Keep the descendant's creation time strictly before the root's millisecond exit bound.
      setTimeout(() => process.exit(0), 30);
    });
  });
}
