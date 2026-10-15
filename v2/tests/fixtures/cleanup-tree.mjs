import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// Both levels self-exit even when a deliberately broken tree kill leaves the grandchild behind.
const life = Number(process.argv.find((a) => a.startsWith("--life="))?.slice(7) || 30000);
process.stdin.resume();
// --detached-leaf: on Windows libuv puts every non-detached child in a kill-on-close job object, so a plain grandchild dies with
// its parent even when only the root is killed; a detached grandchild is outside that job and models a descendant that survives.
if (!process.argv.includes("--leaf")) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--leaf", `--life=${life}`],
    { windowsHide: true, detached: process.argv.includes("--detached-leaf"), stdio: ["ignore", "ignore", "ignore"] });
  console.log(JSON.stringify({ grandchild: child.pid }));
}
setTimeout(() => process.exit(0), life);
