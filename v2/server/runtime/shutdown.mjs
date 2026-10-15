/** Bound shutdown waits without leaving a timer behind or losing the underlying rejection. */
export async function drainWithin(work, ms, label) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: shutdown drain exceeded ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
