// Opens a COPY read-only. No Hub boot, migration, scheduler, runner, capture or provider is constructed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDeliveries } from '../../server/delivery/delivery.mjs';
import { createFactory } from '../../server/factory/factory.mjs';
import { createDeliveryExecutors } from '../../server/delivery/executors.mjs';
import { createOfficeExecutors } from '../../server/delivery/office-executors.mjs';
import { createExecutors } from '../../server/ops/executors.mjs';
import { createOpsPlans } from '../../server/ops/plans.mjs';
import { correctionSteps } from '../../server/delivery/correction.mjs';
import { hashCanonical } from '../../server/core/canonical.mjs';

const forbidden = 'C:\\Users\\mihai\\IfrimHub\\hub-data';
const within = (root, p) => { const r = path.resolve(root).toLowerCase(), c = path.resolve(p).toLowerCase(); return c === r || c.startsWith(r + path.sep); };
export function safeCopyRoot(root) {
  // Check lexical path before filesystem access, then reject aliases into the forbidden tree.
  if (!root || within(forbidden, root)) throw Error('LIVE_DATA_REFUSED');
  const real = fs.realpathSync(root); if (within(forbidden, real)) throw Error('LIVE_DATA_REFUSED');
  const pidFile = path.join(real, 'v2-hub.pid.json');
  if (fs.existsSync(pidFile)) {
    const info = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    if (Number.isInteger(info.pid) && info.pid > 0) { let alive = true; try { process.kill(info.pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; } if (alive) throw Error('LIVE_PROCESS_REFUSED'); }
    // The task forbids ALL network (in particular 8011). A recorded port is conservatively refused,
    // without probing /api/health. Remove the stale pid file from the COPY before using this tool.
    if (info.port) throw Error('RECORDED_PORT_REFUSED_OFFLINE');
  }
  return real;
}
export async function correctionDryRun({ dataRoot, deliveryId, out = null }) {
  const root = safeCopyRoot(dataRoot);
  if (out) {
    if (within(forbidden, out) || !within(path.resolve(import.meta.dirname, '../../..'), out)) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
    const parent = fs.realpathSync(path.dirname(path.resolve(out))); if (within(forbidden, parent) || !within(path.resolve(import.meta.dirname, '../../..'), parent)) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
  }
  const dbFile = fs.realpathSync(path.join(root, 'hub-v2.sqlite'));
  if (!within(root, dbFile) || within(forbidden, dbFile)) throw Error('DATABASE_ALIAS_REFUSED');
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const reject = () => { throw Error('DRY_RUN_WRITE_REFUSED'); }, bus = { append: reject, emit: reject, transaction: reject }, clock = () => new Date();
    const config = { testMode: true, dataDir: root, mediaDir: path.join(root, 'v2-media'), workDir: path.join(root, 'work') };
    const settings = { get: key => { const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; } };
    const projects = { get: id => { const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id); return r && { id: r.id, name: r.name, path: r.path, source: r.source }; } };
    const media = { edits: { getVersion: id => { const r = db.prepare('SELECT ir_json FROM media_edit_versions WHERE id = ?').get(id || ''); return r && { ir: JSON.parse(r.ir_json) }; } },
      assets: { getVersion: id => { const r = db.prepare('SELECT rel_path FROM media_asset_versions WHERE id = ?').get(id || ''); if (!r) return null; const p = path.resolve(config.mediaDir, r.rel_path); if (!within(config.mediaDir, p) || within(forbidden, p)) throw Error('CAPTURE_PATH_REFUSED'); const real = fs.realpathSync(p); if (!within(config.mediaDir, real) || within(forbidden, real)) throw Error('CAPTURE_PATH_REFUSED'); return { relPath: r.rel_path }; } } };
    const factory = createFactory({ db, bus, config, clock });
    const opsPlans = { view: id => { const r = db.prepare('SELECT * FROM ops_plans WHERE id = ?').get(id || ''); return r && { id: r.id, kind: r.kind, status: r.status, steps: db.prepare('SELECT * FROM ops_plan_steps WHERE plan_id = ? ORDER BY seq').all(id).map(s => ({ kind: s.kind, seq: s.seq, status: s.status, result: JSON.parse(s.result_json || '{}') })) }; } };
    const deliveries = createDeliveries({ db, bus, config, clock, settings, projects, factory, media, opsPlans, trust: {} });
    const draft = deliveries.correctionDraft(deliveryId);
    if (out && within(path.join(draft.template.exports.dir, draft.template.exports.folder), path.resolve(out))) throw Error('EXPORT_OUTPUT_REFUSED');
    if (!['READY', 'NEEDS_OWNER'].includes(draft.delivery.status)) throw Error('CORRECTION_STATUS');
    const revisionId = 'drv_dry_run';
    const getRevision = deliveries.getRevision;
    deliveries.getRevision = id => id === revisionId ? { id, deliveryId, delta: { correction: draft.correction, correctionSha: draft.correctionSha } } : getRevision(id);
    const executors = { ...createExecutors({ media, settings }), ...createDeliveryExecutors({ deliveries, factory, media, projects, opsPlans, config }), ...createOfficeExecutors({ deliveries, factory, opsPlans, config }) };
    const plans = createOpsPlans({ db, bus, clock, settings, trust: {}, executors, folderContext: () => ({ allowed: [draft.template.exports.dir], forbidden: [] }) });
    const steps = correctionSteps(draft.template, deliveryId, revisionId, draft.correction);
    const body = await plans.buildBody({ kind: 'delivery.correct', title: 'Corectură afirmații: ' + draft.template.project.name, steps, limits: { maxDurationMin: 30, maxActions: 120 } });
    const result = { defects: draft.audit.defects, captures: draft.correction.captures, outputs: draft.correction.outputs, steps, correctionSha: draft.correctionSha, planBodySha: hashCanonical(body) };
    if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    return result;
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => i % 2 ? a : [...a, [x, all[i + 1]]], []));
  if (!args['--data-root'] || !args['--delivery'] || !args['--out']) throw Error('Usage: --data-root <COPY> --delivery <dlv_id> --out <new.json>');
  await correctionDryRun({ dataRoot: args['--data-root'], deliveryId: args['--delivery'], out: args['--out'] });
}
