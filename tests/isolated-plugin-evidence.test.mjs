import test from "node:test";
import assert from "node:assert/strict";
import { requireSettledPluginMigrations } from "../apps/api/src/isolated-plugin-evidence.mjs";

test("startup/certification reject unfinished native plugin obligations", () => {
  requireSettledPluginMigrations([]);
  for (const pending of [null, {}, [{pluginId:"codex",requiresStateMigration:true}], [{pluginId:"other",requiresDoctorInspection:true}]]) {
    assert.throws(() => requireSettledPluginMigrations(pending), /migration pending/);
  }
});
