// Part B verification: one system-Node test file at a time. Only RCO-04 may start temporary local servers/Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(root, '.tmp-s25-a/part-b-results'), tmp = path.join(dir, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
const selections = {
  'r-correct': null, 'r-claims': null, 'm11-template': null, 'm11-clip-ir': null, 'm11-summary': null, 'm11-revision-parse': null,
  'm11-stale-graph': null, 'm09-media-ir': null, 'm09-media-qa': null, 'm09-content': null,
  'm11-ui-logic': 'M11-UI-(0[1-9]|1[0-689]|2[0-9]) ',
  'stage-finalizare': '^FZ-(0[1-689]|1[0-9])', 'r-priv-rev': '^(RP-(0[1-6]|09|1[1-3])|RR-01)',
  'r-media-holds': '^RM-0[1-9] ', 'm11-fixture': 'M11-FX-(01|06|07|13|14|15) ',
  'stage-office-delivery': '^OFF-0[1-5] ', 'r-closure': '^(PACK-|REV-0[123]|ROLL-|SUP-)',
  'm09-media-capture': '^M09-CP-(01|07|08|09) ',
};
for (const file of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(selections)) {
  if (!(file in selections)) throw Error('Unknown suite: ' + file);
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', ...(selections[file] ? ['--test-name-pattern=' + selections[file]] : []), 'v2/tests/' + file + '.test.mjs'];
  const guard = file === 'r-correct' ? 'correction-local-guard.mjs' : 'claims-offline-guard.mjs';
  const result = spawnSync('C:/Program Files/nodejs/node.exe', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, TEMP: tmp, TMP: tmp, NODE_OPTIONS: '--import=' + new URL('fixtures/' + guard, import.meta.url).href } });
  const output = (result.stdout || '') + (result.stderr || ''); fs.writeFileSync(path.join(dir, file + '.tap'), output);
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(k => [k, Number(output.match(new RegExp('^# ' + k + ' (\\d+)', 'm'))?.[1] ?? -1)]));
  fs.writeFileSync(path.join(dir, file + '.json'), JSON.stringify({ file, args, guard, status: result.status, counts }, null, 2) + '\n');
  console.log(JSON.stringify({ file, status: result.status, ...counts }));
  if (result.status !== 0) { process.exitCode = 1; console.log(output.split('\n').filter(l => l.startsWith('not ok') || l.includes('error:')).join('\n')); }
}
