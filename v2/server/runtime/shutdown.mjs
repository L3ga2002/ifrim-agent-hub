/** Bound shutdown waits without leaving a timer behind or losing the underlying rejection. */
export async function drainWithin(work, ms, label) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: shutdown drain exceeded ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
// Production envelope: prepare <=25s, parallel service drains <=30s, finalizers <=5s.
// Both managed stop callers allow another 5s for HTTP scheduling, pid removal and process exit.
export const SHUTDOWN_PREPARE_MS = 25000;
export const HUB_DRAIN_MS = 30000;
export const HUB_SETTLE_MS = 5000;
export const STOP_WAIT_MS = SHUTDOWN_PREPARE_MS + HUB_DRAIN_MS + HUB_SETTLE_MS + 5000;

