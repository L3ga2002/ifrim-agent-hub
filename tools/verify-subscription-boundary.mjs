import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPhysicalIsolationBoundary, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await assertPhysicalIsolationBoundary(root, isolationPaths(root).state);
console.log("Isolated physical boundary verified");
