export async function consumeOrderedFreshReads(items, read, consume) {
  const iterator = items[Symbol.asyncIterator]();
  const pending = [];
  let failure;
  let finished = false;
  const rememberFailure = (error) => { failure ??= { error }; };
  try {
    while (!finished || pending.length) {
      while (!finished && !failure && pending.length < 2) {
        const next = await iterator.next();
        if (next.done) { finished = true; break; }
        if (failure) break;
        const item = next.value;
        const promise = Promise.resolve().then(() => read(item)).then(
          (value) => ({ item, value }),
          (error) => { rememberFailure(error); return null; },
        );
        pending.push(promise);
      }
      if (failure) throw failure.error;
      if (pending.length) {
        const result = await pending[0];
        pending.shift();
        if (failure) throw failure.error;
        await consume(result.value, result.item);
      }
    }
  } finally {
    // Never leave reads running after traversal, read, or consumer failure.
    await Promise.all(pending);
    await iterator.return?.();
  }
}

export function createFreshFileHasher(fs, hash, limit = 536870912) {
  let accountedBytes = 0;
  return async (item) => {
    if (item.kind !== "file") return item;
    const stat = await fs.stat(item.file);
    if (accountedBytes + stat.size > limit) throw new Error(`${item.label} evidence exceeds audit budget`);
    accountedBytes += stat.size;
    const data = await fs.readFile(item.file);
    accountedBytes += data.length - stat.size;
    if (accountedBytes > limit) throw new Error(`${item.label} evidence exceeds audit budget`);
    return { ...item, sha256: hash(data) };
  };
}
