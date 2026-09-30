// Applies the pending V2 schema migrations to a coherent COPY of the live hub-v2.sqlite (online backup
// API) inside .ifrim/tmp and reports integrity + before/after counts. The live database is only read.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { migrate } from "../../server/storage/db.mjs";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const live = path.join(root, ".ifrim", "private", "hub-v2.sqlite");
const outDir = path.join(root, ".ifrim", "tmp", "migration-check");
fs.mkdirSync(outDir, { recursive: true });
const copy = path.join(outDir, `hub-v2-copy-${Date.now()}.sqlite`);

const source = new DatabaseSync(live, { readOnly: true });
await backup(source, copy);
source.close();

const db = new DatabaseSync(copy);
const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memory_fts%' ORDER BY name").all().map((r) => r.name);
const counts = () => Object.fromEntries(tables().map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const before = { version: db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, counts: counts(),
  memoryScopes: db.prepare("SELECT scope, COUNT(*) AS n FROM memory_items GROUP BY scope").all(),
  tasksWithDeps: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE depends_on_json NOT IN ('[]','')").get().n };
db.exec("PRAGMA foreign_keys = ON");
migrate(db);
const after = { version: db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, counts: counts(),
  memoryScopes: db.prepare("SELECT scope, COUNT(*) AS n FROM memory_items GROUP BY scope").all(),
  integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
  foreignKeys: db.prepare("PRAGMA foreign_key_check").all().length };
const lost = Object.entries(before.counts).filter(([t, n]) => (after.counts[t] ?? -1) < n).map(([t]) => t);
db.close();
console.log(JSON.stringify({ copy: path.relative(root, copy), before: { version: before.version, memoryScopes: before.memoryScopes, tasksWithDeps: before.tasksWithDeps },
  after: { version: after.version, integrity: after.integrity, foreignKeyViolations: after.foreignKeys, memoryScopes: after.memoryScopes, taskDependencies: after.counts.task_dependencies },
  newTables: Object.keys(after.counts).filter((t) => !(t in before.counts)), tablesWithFewerRows: lost,
  preserved: Object.fromEntries(Object.entries(before.counts).map(([t, n]) => [t, `${n}→${after.counts[t]}`])) }, null, 2));
