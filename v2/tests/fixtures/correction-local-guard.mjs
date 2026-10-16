// RCO-04 alone may use temporary loopback servers and Chromium. Never the live Hub or external sockets.
import net from 'node:net';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const refuse = () => { throw Error('CORRECTION_GUARDRAIL: external/live/model/git operation refused'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const a = Array.isArray(args[0]) ? args[0] : args, v = a[0];
  const port = typeof v === 'object' ? v.port : v, host = typeof v === 'object' ? v.host : a[1];
  if (Number(port) === 8011 || (typeof host === 'string' && !['127.0.0.1', 'localhost', '::1'].includes(host))) refuse();
  return connect.apply(this, args);
};
const fetch_ = globalThis.fetch;
globalThis.fetch = (input, init) => { const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port === '8011') refuse(); return fetch_(input, init); };
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = child[name];
  child[name] = function(command, ...args) { if (/^(git|codex|claude|openclaw)(\.exe|\.cmd)?$/i.test(String(command).replaceAll('\\','/').split('/').at(-1))) refuse(); return original.call(this, command, ...args); };
}
syncBuiltinESMExports();
