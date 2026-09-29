import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { installHiddenChildWindows } from "../apps/api/src/hidden-child-process.mjs";

const methods = ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"];

function fakeChildProcess() {
  const calls = [];
  const result = { syntheticChild: true };
  const api = Object.fromEntries(methods.map((name) => [name, function (...args) {
    calls.push({ name, args, receiver: this });
    return result;
  }]));
  return { api, calls, result };
}

for (const name of methods) {
  test(`${name} preserves options, environment, stdio, arguments and receiver`, () => {
    const { api, calls, result } = fakeChildProcess();
    const restore = installHiddenChildWindows(api, "win32");
    const env = { SYNTHETIC_ONLY: "unchanged" };
    const stdio = ["ignore", "pipe", "pipe"];
    const options = { env, stdio, cwd: "synthetic-workspace", shell: false, timeout: 1234, windowsHide: true };
    const before = { ...options };
    const argv = ["--synthetic", "value with spaces"];
    const callback = () => {};
    const isShell = name === "exec" || name === "execSync";
    const hasCallback = name === "exec" || name === "execFile";
    const args = isShell ? ["synthetic-command", options] : ["synthetic-command", argv, options];
    if (hasCallback) args.push(callback);
    try {
      assert.equal(api[name](...args), result);
      const call = calls[0];
      assert.equal(call.receiver, api);
      assert.equal(call.args[0], args[0]);
      const index = isShell ? 1 : 2;
      if (!isShell) assert.equal(call.args[1], argv);
      assert.deepEqual(call.args[index], options);
      assert.notEqual(call.args[index], options);
      assert.equal(call.args[index].env, env);
      assert.equal(call.args[index].stdio, stdio);
      if (hasCallback) assert.equal(call.args.at(-1), callback);
      assert.deepEqual(options, before);
    } finally { restore(); }
  });

  test(`${name} adds hidden options to omitted-options overloads`, () => {
    const { api, calls } = fakeChildProcess();
    const restore = installHiddenChildWindows(api, "win32");
    try {
      api[name]("synthetic-command");
      assert.deepEqual(calls[0].args, ["synthetic-command", { windowsHide: true }]);
      if (name !== "exec" && name !== "execSync") {
        const argv = ["--synthetic"];
        api[name]("synthetic-command", argv);
        assert.equal(calls[1].args[1], argv);
        assert.deepEqual(calls[1].args[2], { windowsHide: true });
      }
    } finally { restore(); }
  });
}

for (const name of ["exec", "execFile"]) {
  test(`${name} keeps callback identity when options are omitted`, () => {
    const { api, calls } = fakeChildProcess();
    const restore = installHiddenChildWindows(api, "win32");
    const callback = () => {};
    try {
      api[name]("synthetic-command", callback);
      assert.equal(calls[0].args[2], callback);
      assert.deepEqual(calls[0].args[1], { windowsHide: true });
      if (name === "execFile") {
        const argv = ["--synthetic"];
        api[name]("synthetic-command", argv, callback);
        assert.equal(calls[1].args[1], argv);
        assert.deepEqual(calls[1].args[2], { windowsHide: true });
        assert.equal(calls[1].args[3], callback);
      }
    } finally { restore(); }
  });

  test(`${name} retains the custom promisify stdout/stderr contract`, async () => {
    const { api } = fakeChildProcess();
    const expected = { stdout: "synthetic stdout", stderr: "synthetic stderr" };
    const child = { syntheticChild: true };
    let customArgs;
    api[name] = function (...args) {
      args.at(-1)(null, expected.stdout, expected.stderr);
      return { syntheticChild: true };
    };
    api[name][promisify.custom] = function (...args) {
      customArgs = args;
      return Object.assign(Promise.resolve(expected), { child });
    };
    const restore = installHiddenChildWindows(api, "win32");
    try {
      const promise = promisify(api[name])("synthetic-command");
      assert.equal(promise.child, child);
      assert.deepEqual(await promise, expected);
      assert.deepEqual(customArgs, ["synthetic-command", { windowsHide: true }]);
    } finally { restore(); }
  });
}

test("non-Windows installation is a no-op and restoration keeps all original identities", () => {
  for (const platform of ["linux", "darwin"]) {
    const { api } = fakeChildProcess();
    const originals = { ...api };
    const restore = installHiddenChildWindows(api, platform);
    for (const name of methods) assert.equal(api[name], originals[name]);
    restore();
    for (const name of methods) assert.equal(api[name], originals[name]);
  }
  const { api } = fakeChildProcess();
  const originals = { ...api };
  const restore = installHiddenChildWindows(api, "win32");
  for (const name of methods) assert.notEqual(api[name], originals[name]);
  restore();
  restore();
  for (const name of methods) assert.equal(api[name], originals[name]);
});

test("isolated hiding policy overrides visibility without mutating caller options", () => {
  const { api, calls } = fakeChildProcess();
  const restore = installHiddenChildWindows(api, "win32");
  try {
    const options = { windowsHide: false };
    api.spawn("synthetic-command", [], options);
    assert.equal(calls[0].args[2].windowsHide, true);
    assert.equal(options.windowsHide, false);
  } finally { restore(); }
});

const source = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("preload is guarded by isolated environment and physical boundary before installing policy", async () => {
  const preload = await source("tools/hidden-gateway-preload.mjs");
  const env = preload.indexOf("process.env.OPENCLAW_STATE_DIR !== target.state");
  const boundary = preload.indexOf("await assertPhysicalIsolationBoundary(root, target.state)");
  const install = preload.indexOf("installHiddenChildWindows(childProcess)");
  const sync = preload.indexOf("syncBuiltinESMExports();");
  assert.ok(env >= 0 && env < boundary && boundary < install && install < sync);
  assert.match(preload, /process\.env\.OPENCLAW_CONFIG_PATH !== target\.config/);
});

test("launcher places preload before Gateway entry without widening environment", async () => {
  const launch = await source("tools/launch-isolated-gateway.mjs");
  assert.match(launch, /import \{ pathToFileURL \} from "node:url"/);
  assert.match(launch, /\["--import", pathToFileURL\(preload\)\.href, entry, "gateway", "run", "--port", "18790"\]/);
  assert.match(launch, /cwd: target\.state, env: process\.env, detached: true, windowsHide: true/);
  assert.doesNotMatch(launch, /NODE_OPTIONS|API_KEY|danger-full-access/);
});

test("receipt rejects missing or changed preload and child-policy hashes", async () => {
  const auth = await source("apps/api/src/subscription-auth.mjs");
  const startup = await source("tools/start-subscription-gateway.ps1");
  assert.match(auth, /receipt\.preloadPath !== preload \|\| !receipt\.preloadSha256 \|\| !receipt\.childPolicySha256/);
  assert.match(auth, /digest\(await fs\.readFile\(preload\)\) !== receipt\.preloadSha256/);
  assert.match(auth, /digest\(await fs\.readFile\(path\.join\(receipt\.projectRoot, "apps\/api\/src\/hidden-child-process\.mjs"\)\)\) !== receipt\.childPolicySha256/);
  assert.match(auth, /throw new Error\("Hidden isolated Gateway child policy is not certified"\)/);
  for (const field of ["preloadPath", "preloadSha256", "childPolicySha256"]) assert.match(startup, new RegExp(`${field} =`));
});

test("receipt binds parsed Node preload tokens in exact order before Gateway entrypoint", async () => {
  const auth = await source("apps/api/src/subscription-auth.mjs");
  assert.match(auth, /CommandLineToArgvW/);
  assert.match(auth, /LocalFree\(pointer\)/);
  assert.match(auth, /!Array\.isArray\(current\.arguments\) \|\| current\.arguments\.length !== 8/);
  assert.match(auth, /current\.arguments\.some\(\(value, index\) => value !== \[receipt\.executable, '--import', pathToFileURL\(preload\)\.href, receipt\.entrypoint, 'gateway', 'run', '--port', '18790'\]\[index\]\)/);
  assert.doesNotMatch(auth, /current\.commandLine(?:\?\.)?\.includes/);
});

test("isolated config disables native catalog while preserving Codex harness routing", async () => {
  const isolation = await source("apps/api/src/subscription-isolation.mjs");
  assert.match(isolation, /codex: \{ enabled: true, config: \{ sessionCatalog: \{ enabled: false \}/);
  assert.match(isolation, /agentRuntime: \{ id: "codex" \}/);
  assert.match(isolation, /entries\.length !== 23/);
});

test("primitive invalid option types reach the original validation unchanged", () => {
  for (const name of methods) {
    for (const invalid of ["invalid-options", 42, true, false]) {
      const { api } = fakeChildProcess();
      const isShell = name === "exec" || name === "execSync";
      api[name] = function (...args) {
        assert.equal(args[isShell ? 1 : 2], invalid);
        throw Object.assign(new TypeError("Synthetic invalid options"), { code: "ERR_INVALID_ARG_TYPE" });
      };
      const restore = installHiddenChildWindows(api, "win32");
      try {
        const args = isShell ? ["synthetic-command", invalid] : ["synthetic-command", [], invalid];
        assert.throws(() => api[name](...args), { code: "ERR_INVALID_ARG_TYPE" });
      } finally { restore(); }
    }
  }
});

test("invalid array and function options for spawn are not converted to valid options", () => {
  for (const invalid of [[], () => {}]) {
    const { api } = fakeChildProcess();
    api.spawn = function (command, args, options) {
      if (Array.isArray(options) || typeof options === "function") {
        throw Object.assign(new TypeError("Synthetic invalid options"), { code: "ERR_INVALID_ARG_TYPE" });
      }
      return { syntheticChild: true };
    };
    const restore = installHiddenChildWindows(api, "win32");
    try {
      assert.throws(() => api.spawn("synthetic-command", [], invalid), { code: "ERR_INVALID_ARG_TYPE" });
    } finally { restore(); }
  }
});

test("catalog maintenance stays approval, lock and stopped-gated and changes only native import", async () => {
  const helper = await source("tools/configure-on-demand-catalog.mjs");
  const approval = helper.indexOf('process.argv[2] !== "--approved-hub-018"');
  const lock = helper.indexOf("await acquireSubscriptionMaintenanceLock(root)");
  const stopped = helper.indexOf("await assertStopped();");
  const write = helper.indexOf("await fs.writeFile(temporary");
  const recheck = helper.indexOf("await assertStopped();", write);
  const rename = helper.indexOf("await fs.rename(temporary, target.config)");
  assert.ok(approval >= 0 && approval < lock && lock < stopped && stopped < write && write < recheck && recheck < rename);
  assert.match(helper, /process\.platform !== "win32"/);
  assert.match(helper, /gate\.status !== "suspended"/);
  assert.match(helper, /ProcessId=\$\{receipt\.pid\}/);
  assert.match(helper, /ParentProcessId=\$\{receipt\.pid\}/);
  assert.match(helper, /LocalPort -In 18789,18790/);
  assert.match(helper, /stat\.isSymbolicLink\(\).*digest\(await fs\.readFile\(target\.config\)\) !== digest\(raw\)/);
  assert.deepEqual(helper.match(/config(?:\.[A-Za-z_$][\w$]*)+\s*=(?!=)/g), ["config.plugins.entries.codex.config.sessionCatalog ="]);
  assert.match(helper, /finally\s*\{\s*await release\(\);\s*\}/);
  assert.doesNotMatch(helper, /connectOpenClaw|fetch\(|config\.patch|auth login/);
});

test("preload file URL escapes spaces and fragment characters without a drive-letter URL scheme", () => {
  const preload = path.resolve("synthetic Hub", "fragment#name", "hidden-gateway-preload.mjs");
  const url = pathToFileURL(preload);
  assert.equal(url.protocol, "file:");
  assert.equal(url.hash, "");
  assert.match(url.href, /synthetic%20Hub\/fragment%23name\/hidden-gateway-preload\.mjs$/);
});

test("startup bounds exact-PID readiness and rejects exit, foreign listeners and timeout before receipt", async () => {
  const startup = await source("tools/start-subscription-gateway.ps1");
  const identity = startup.indexOf("[Diagnostics.Process]::GetProcessById($launch.pid)");
  const deadline = startup.indexOf("$deadline = [DateTime]::UtcNow.AddSeconds(300)");
  const refresh = startup.indexOf("$process.Refresh()", deadline);
  const exit = startup.indexOf("if ($process.HasExited)", refresh);
  const listeners = startup.indexOf("Where-Object LocalPort -eq 18790", exit);
  const foreign = startup.indexOf("Where-Object OwningProcess -ne $launch.pid", listeners);
  const timeout = startup.indexOf("if ([DateTime]::UtcNow -ge $deadline)", foreign);
  const receipt = startup.indexOf("$receipt = @{", timeout);
  const persist = startup.indexOf("WriteAllText", receipt);
  assert.ok(identity >= 0 && identity < deadline && deadline < refresh && refresh < exit && exit < listeners && listeners < foreign && foreign < timeout && timeout < receipt && receipt < persist);
  assert.match(startup, /if \(\$process\.HasExited\) \{ throw \('Gateway exited before readiness;/);
  assert.match(startup, /Where-Object OwningProcess -ne \$launch\.pid\)\.Count -gt 0\) \{ throw 'Gateway port belongs to a different process'/);
  assert.match(startup, /if \(\[DateTime\]::UtcNow -ge \$deadline\) \{ throw \('Gateway readiness timed out;/);
  assert.match(startup, /Start-Sleep -Milliseconds 500/);
  assert.match(startup, /startedAt = \$startedAt/);
});

test("startup writes the receipt with explicit BOM-free UTF-8 on Windows PowerShell", async () => {
  const startup = await source("tools/start-subscription-gateway.ps1");
  const receiptWriter = startup.slice(startup.indexOf("$receipt = @{"));
  assert.match(receiptWriter, /\[(?:System\.)?IO\.File\]::WriteAllText\(/);
  assert.match(receiptWriter, /\[(?:System\.)?Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(receiptWriter, /subscription-gateway-receipt\.json/);
  assert.doesNotMatch(receiptWriter, /Set-Content\b/);
});
