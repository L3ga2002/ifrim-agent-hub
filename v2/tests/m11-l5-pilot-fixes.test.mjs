// 2.13.1 fixes found in the live L5 pilot (2026-10-07). Pure resolver checks, no Hub.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent } from "../server/owner/intents.mjs";

const PROJECTS = [
  { id: "p1", name: "Factory Demo M10.2", slug: "factory-demo-m10-2" },
  { id: "p2", name: "Factory Demo L5", slug: "factory-demo-l5" },
  { id: "p3", name: "ProDelivery", slug: "prodelivery" },
];
const projectOf = (text) => resolveIntent(text, { projects: PROJECTS, currentProjectId: "p1" }).steps.map((s) => [s.intent, s.args.projectId ?? null]);

test("L5P-01 „în <proiect>” names the project of a code request (live: the plan was drafted on the cockpit's project)", () => {
  assert.deepEqual(projectOf("Repară validarea în Factory Demo L5: un nume format doar din spații trece de validare"), [["engineering_request", "p2"]]);
  assert.deepEqual(projectOf("Repară eroarea în ProDelivery la login"), [["engineering_request", "p3"]]);
  // „din” keeps working.
  assert.deepEqual(projectOf("Repară validarea din Factory Demo L5: un nume gol trece"), [["engineering_request", "p2"]]);
});

test("L5P-02 „în” before ordinary words names no project („în formular”, „în cod”)", () => {
  assert.deepEqual(projectOf("Repară bug-ul în formular: numele gol trece"), [["engineering_request", null]]);
  assert.deepEqual(projectOf("Adaugă validarea în cod pentru email"), [["engineering_request", null]]);
});
