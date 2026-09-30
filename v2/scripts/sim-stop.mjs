// Stops the simulator started by `npm run v2:sim` (same graceful path as v2:stop, on the simulator's port and data dir).
import path from "node:path";
import { fileURLToPath } from "node:url";
const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.HUB_V2_PORT = String(Number(process.env.HUB_V2_SIM_PORT || 8012));
process.env.HUB_V2_DATA_DIR = path.join(HUB_ROOT, ".ifrim", "tmp", "v2-sim", "data");
const { health } = await import("./common.mjs");
const h = await health();
if (h?.ok && !h.simulation) { console.error("The process on the simulator port is not a simulator; refusing to stop it."); process.exit(1); }
await import("./stop.mjs");
