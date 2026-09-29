import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("per-run subscription inspection cannot opt out of fresh plugin evidence", async () => {
  const source = await fs.readFile(new URL("../apps/api/src/subscription-auth.mjs", import.meta.url), "utf8");
  const run = source.slice(source.indexOf("export async function inspectSubscriptionSources("), source.indexOf("export async function inspectSubscriptionCredentialSources("));
  assert.match(run, /await inspectIsolatedPlugin\(options\.cwd, gatewayEnvironment\)/);
  assert.ok(run.indexOf("await inspectIsolatedPlugin(") < run.indexOf("await inspectSubscriptionCredentialSources("));
  assert.doesNotMatch(run, /skipPlugin|cachedPlugin|options\.pluginEvidence/);
  assert.match(source, /validateStartupProfiles\(store\)/);
  assert.match(source, /Object\.keys\(store\.profiles\)\.length !== 1/);
});

test("batch certificate verifies shared plugin before and after all credential audits", async () => {
  const source = await fs.readFile(new URL("../tools/certify-openclaw-subscription.mjs", import.meta.url), "utf8");
  const first = source.indexOf("const pluginEvidence = await inspectIsolatedPlugin(");
  const agents = source.indexOf("for (const agentId of agents)");
  const last = source.indexOf("isDeepStrictEqual(pluginEvidence, await inspectIsolatedPlugin(");
  const publish = source.indexOf("const gate =");
  assert.ok(first >= 0 && first < agents && agents < last && last < publish);
  assert.match(source, /evidence\.agents\[agentId\].*inspectSubscriptionCredentialSources/s);
  assert.match(source, /throw new Error\("Native plugin changed during certification"\)/);
  assert.match(source, /agents\.length !== 23/);
  assert.match(source, /!agents\.includes\("main"\)/);
  assert.doesNotMatch(source, /filter\(.*startsWith\("ifrim-"\)/);
});
