// A failed or stalled observation must not prevent later shutdown/evidence steps.
export async function boundedStep(step, fn, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${step} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function cleanupSteps(evidence, onError = () => {}) {
  return async (step, fn, timeoutMs) => {
    try { return await boundedStep(step, fn, timeoutMs); }
    catch (error) {
      (evidence.cleanupErrors ||= []).push({ step, message: error.message });
      onError(error);
    }
  };
}
