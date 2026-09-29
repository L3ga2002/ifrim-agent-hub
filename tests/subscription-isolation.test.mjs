import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildIsolatedSubscriptionConfig, validateIsolatedPaths, isolatedProfileId, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";

const ids = ["main", "ifrim-backend", "ifrim-reviewer", "ifrim-qa", "ifrim-architect", ...Array.from({length:18},(_,i)=>`ifrim-role-${String.fromCharCode(97+i)}`)];
const root = path.resolve("test-hub");
const source = { agents: { entries: Object.fromEntries(ids.map(id=>[id,{workspace:"client",model:{primary:"old",fallbacks:["api"]}}])) },
  channels:{telegram:{token:"never-copy"}}, secrets:{provider:"never-copy"}, env:{OPENAI_API_KEY:"never-copy"},
  plugins:{entries:{codex:{config:{appServer:{command:path.resolve("codex.exe")}}}}} };

test("isolated config does not mutate or copy client paths, API sources and historical defaults",()=>{
  const before=structuredClone(source); const config=buildIsolatedSubscriptionConfig(source,root,"x".repeat(64));
  assert.deepEqual(source,before); assert.equal(validateIsolatedPaths(config,root),true);
  assert.doesNotMatch(JSON.stringify(config),/never-copy|client|\"old\"/);
  assert.deepEqual(config.auth.order.openai,[isolatedProfileId]);
  assert.equal(config.agents.ownership,"explicit");
  assert.equal(config.agents.defaults.model.primary,"openai/gpt-6-luna");
  assert.deepEqual(config.agents.defaults.model.fallbacks,[]);
  assert.equal(config.agents.entries['ifrim-backend'].model.primary,"openai/gpt-6-sol");
  assert.equal(config.agents.entries['ifrim-architect'].model.primary,"openai/gpt-6-astra");
});
test("isolated config rejects missing roles, weak token and escaped agent/workspace paths",()=>{
  assert.throws(()=>buildIsolatedSubscriptionConfig({...source,agents:{entries:{}}},root,"x".repeat(64)),/23/);
  assert.throws(()=>buildIsolatedSubscriptionConfig(source,root,"short"),/authentication/);
  const config=buildIsolatedSubscriptionConfig(source,root,"x".repeat(64));
  config.agents.entries.main.agentDir=path.resolve("other-state");
  assert.throws(()=>validateIsolatedPaths(config,root),/escapes/);
});

test("physical boundary refuses an outside target and existing non-directory without modifying it",async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),"hub-isolation-test-"));
  try {
    await assert.rejects(assertPhysicalIsolationBoundary(base,path.dirname(base)),/inside/);
    const file=path.join(base,"not-a-directory"); await fs.writeFile(file,"preserved");
    await assert.rejects(assertPhysicalIsolationBoundary(base,path.join(file,"state")),/non-directory/);
    assert.equal(await fs.readFile(file,"utf8"),"preserved");
    await assertPhysicalIsolationBoundary(base,path.join(base,"new-state"));
  } finally {
    if(!path.resolve(base).startsWith(`${path.resolve(os.tmpdir())}${path.sep}hub-isolation-test-`)) throw new Error("Unexpected temporary path");
    await fs.rm(base,{recursive:true,force:true});
  }
});
