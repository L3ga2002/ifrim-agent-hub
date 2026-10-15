/** Bound shutdown waits without leaving a timer behind or losing the underlying rejection. */
export async function drainWithin(work, ms, label) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: shutdown drain exceeded ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
// Bound the existing production preparation step; managed stop callers retain baseline budgets.
export const SHUTDOWN_PREPARE_MS = 25000;
