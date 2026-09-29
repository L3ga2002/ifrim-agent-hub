import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { isolationPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";

if (process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const target = isolationPaths(root);
const directory = path.join(target.state,"checkpoints",new Date().toISOString().replaceAll(":","-"));
await assertPhysicalIsolationBoundary(root,directory);
await fs.mkdir(directory,{recursive:true});
await assertPhysicalIsolationBoundary(root,directory);
const source = path.join(target.state,"state","openclaw.sqlite");
if ((await fs.lstat(source)).isSymbolicLink()) throw new Error("SQLite checkpoint source is a link");
const db = new DatabaseSync(source,{readOnly:true});
try { await backup(db,path.join(directory,"openclaw.sqlite")); } finally { db.close(); }
const saved = new DatabaseSync(path.join(directory,"openclaw.sqlite"),{readOnly:true});
try { if (saved.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Checkpoint integrity failed"); } finally { saved.close(); }
await fs.copyFile(target.config,path.join(directory,"openclaw.json"),fs.constants.COPYFILE_EXCL);
console.log(JSON.stringify({status:"checkpoint-created",directory,integrity:"ok"}));
