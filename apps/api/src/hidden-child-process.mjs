import { promisify } from "node:util";

export function installHiddenChildWindows(childProcess, platform = process.platform) {
  if (platform !== "win32") return () => {};
  const originals = new Map();
  for (const name of ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"]) {
    const original = childProcess[name];
    originals.set(name, original);
    const wrap = (operation) => function (...args) {
      const optionsIndex = name === "exec" || name === "execSync" ? 1 : Array.isArray(args[1]) ? 2 : 1;
      const options = args[optionsIndex];
      const acceptsCallback = name === "exec" || name === "execFile";
      if (Array.isArray(options) || (typeof options === "function" && !acceptsCallback)) return operation.apply(this, args);
      if (options != null && typeof options !== "object" && typeof options !== "function") return operation.apply(this, args);
      if (typeof args[optionsIndex] === "function") args.splice(optionsIndex, 0, { windowsHide: true });
      else args[optionsIndex] = { ...args[optionsIndex], windowsHide: true };
      return operation.apply(this, args);
    };
    childProcess[name] = wrap(original);
    if (original[promisify.custom]) childProcess[name][promisify.custom] = wrap(original[promisify.custom]);
  }
  return () => { for (const [name, original] of originals) childProcess[name] = original; };
}
