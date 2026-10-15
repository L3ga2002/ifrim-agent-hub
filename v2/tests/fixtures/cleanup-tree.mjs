import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// Both levels self-exit even when a deliberately broken tree kill leaves the grandchild behind.
const life = Number(process.argv.find((a) => a.startsWith("--life="))?.slice(7) || 30000);
process.stdin.resume();
if (!process.argv.includes("--leaf")) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--leaf", `--life=${life}`],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  console.log(JSON.stringify({ grandchild: child.pid }));
}
setTimeout(() => process.exit(0), life);
