import fs from "node:fs/promises";
import path from "node:path";
import { assertPhysicalIsolationBoundary, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";

export async function acquireSubscriptionMaintenanceLock(root) {
  const state = isolationPaths(root).state;
  await assertPhysicalIsolationBoundary(root, state);
  const lockPath = path.join(state, "maintenance.lock");
  const handle = await fs.open(lockPath, "wx");
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    try {
      await handle.close();
      await fs.unlink(lockPath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed maintenance lock acquisition cleanup");
    }
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.unlink(lockPath);
  };
}
