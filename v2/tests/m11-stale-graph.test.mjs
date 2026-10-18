// Milestone 11 — provenance and staleness of a delivery (v2/server/delivery/stale.mjs), pure: the cascade over the real upstream
// links, STALE vs SUPERSEDED, the current view bound to the software snapshot, the slots of a READY delivery, the variants to
// invalidate, the documents to stale or regenerate, and one rule per trigger. Hand-built items in the shape of delivery_items.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_KINDS, ITEM_STATUSES, STALE_CODES, UPSTREAM_KINDS, SOFTWARE_BOUND_KINDS, REQUIRED_SLOTS, RULES, TRIGGERS, DELIVERY_STATUSES, DELIVERY_TRANSITIONS,
  itemOf, cascade, applyUpdates, currentView, notCurrentReason, slotsComplete, previousOf, linkProblems, variantsToInvalidate, documentOf, documentsToStale,
  documentsToRegenerate, canTransition, applyRule,
} from "../server/delivery/stale.mjs";

// ---------------------------------------------------------------- fixtures: one complete delivery, generation 1

const SNAP = "s".repeat(64);
const it = (id, kind, role, upstream, extra = {}) => ({ id, delivery_id: "dlv_1", kind, role, ref_table: extra.ref_table || `t_${kind}`, ref_id: extra.ref_id || `ref_${id}`, ref_sha: "", snapshot_sha: kind === "brief" ? "" : SNAP,
  generation: 1, upstream_json: JSON.stringify(upstream), supersedes_id: null, status: "CURRENT", stale_code: "", status_reason: "", meta_json: JSON.stringify(extra.meta || {}), created_at: "2026-10-05T10:00:00.000Z" });
const ITEMS = () => [
  it("bundle", "bundle", "", [], { ref_table: "factory_bundles", ref_id: "bnd_1" }),
  it("shot6", "e2e_shot", "AC-6", ["bundle"]), it("shot7", "e2e_shot", "AC-7", ["bundle"]),
  it("preview", "preview", "", ["bundle"]),
  it("capD", "capture", "desktop", ["bundle", "preview"], { ref_id: "mav_desk" }), it("capM", "capture", "mobile", ["bundle", "preview"], { ref_id: "mav_mob" }),
  it("brief", "brief", "", []),
  it("claim1", "claim", "AC-1", ["bundle"]), it("claim6", "claim", "AC-6", ["bundle", "shot6"]), it("claim7", "claim", "AC-7", ["bundle", "shot7"]),
  it("edit", "edit", "master", ["capD", "capM", "brief", "claim1", "claim6", "claim7"], { ref_table: "media_edit_versions", ref_id: "mev_1" }),
  it("renderM", "render", "master", ["edit"], { ref_id: "mav_render_m" }),
  it("variant", "variant", "vertical", ["edit"], { ref_table: "media_variants", ref_id: "mvr_1", meta: { editVersionId: "mev_2" } }),
  it("renderV", "render", "vertical", ["variant"], { ref_id: "mav_render_v" }),
  it("qaM", "qa", "master", ["renderM"]), it("qaV", "qa", "vertical", ["renderV"]),
  it("exportM", "export", "master", ["renderM"]), it("exportV", "export", "vertical", ["renderV"]),
];
const DELIVERY = { id: "dlv_1", status: "READY", snapshot_sha: SNAP, envelope_id: "env_1" };
const DOCS = () => [{ id: "ddoc_1", version: 1, status: "CURRENT", basis_json: JSON.stringify({ bundleSha: "b".repeat(64), videoItemIds: ["renderM", "renderV", "exportM", "exportV"], serviceRefs: ["svc_detailing@3"] }) },
  { id: "ddoc_0", version: 0, status: "SUPERSEDED", basis_json: JSON.stringify({ videoItemIds: ["renderM"] }) }];
const statusOf = (items) => Object.fromEntries(items.map((i) => [i.id, i.status]));
const ids = (updates, status) => updates.filter((u) => !status || u.status === status).map((u) => u.id).sort();
const ALL_BUT_BRIEF = ITEMS().map((i) => i.id).filter((id) => id !== "brief").sort();
const MEDIA_CHAIN = ["edit", "exportM", "exportV", "qaM", "qaV", "renderM", "renderV", "variant"];
const VERTICAL_CHAIN = ["exportV", "qaV", "renderV", "variant"];
const throwsCode = (fn, expected) => assert.throws(fn, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); return true; });

test("M11-SG-01 the declared graph: kinds, legal links, the software-bound kinds and the slots of a READY delivery", () => {
  assert.deepEqual([...ITEM_KINDS], ["bundle", "e2e_shot", "preview", "capture", "brief", "claim", "edit", "render", "variant", "qa", "export"]);
  assert.deepEqual([...ITEM_STATUSES], ["CURRENT", "SUPERSEDED", "STALE"]);
  assert.deepEqual([...STALE_CODES], ["SOFTWARE_CHANGED", "RIGHTS_REVOKED", "FILE_MISSING", "STUDIO_CORRECTED"]);
  assert.ok(!SOFTWARE_BOUND_KINDS.includes("brief") && SOFTWARE_BOUND_KINDS.length === ITEM_KINDS.length - 1);
  assert.deepEqual(Object.keys(UPSTREAM_KINDS).sort(), [...ITEM_KINDS].sort());
  assert.deepEqual(REQUIRED_SLOTS.map(([k, r]) => (r ? `${k}:${r}` : k)), ["bundle", "capture:desktop", "capture:mobile", "edit:master", "render:master", "variant:vertical", "render:vertical", "qa:master", "qa:vertical", "export:master", "export:vertical"]);
  // The fixture follows the graph; an illegal link, an unknown id and a self link are reported.
  assert.deepEqual(linkProblems(ITEMS()), []);
  const broken = [...ITEMS(), it("x1", "qa", "master", ["edit"]), it("x2", "render", "master", ["nope"]), it("x3", "edit", "master", ["x3"]), it("x4", "poster", "", [])];
  assert.deepEqual(linkProblems(broken).map((p) => p.id), ["x1", "x2", "x3", "x4"]);
  // Rows and views are read the same way.
  const row = itemOf(ITEMS()[10]);
  assert.deepEqual([row.kind, row.role, row.refId, row.snapshotSha, row.upstream.length, row.status], ["edit", "master", "mev_1", SNAP, 6, "CURRENT"]);
  assert.deepEqual(itemOf({ id: "v", kind: "edit", role: "master", refId: "mev_9", snapshotSha: SNAP, upstream: ["a"], status: "STALE", staleCode: "FILE_MISSING" }).staleCode, "FILE_MISSING");
  throwsCode(() => itemOf({ kind: "edit" }), "DELIVERY_ITEM_INVALID");
});

test("M11-SG-02 a software change cascades from the bundle along the real links: everything but the brief becomes STALE", () => {
  const reason = "software-ul s-a schimbat: 2 fișiere modificate după versiunea testată";
  const { updates, reached, missing } = cascade(ITEMS(), ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason });
  assert.deepEqual(ids(updates), ALL_BUT_BRIEF);
  assert.ok(updates.every((u) => u.status === "STALE" && u.staleCode === "SOFTWARE_CHANGED" && u.statusReason === reason && u.from === "CURRENT"));
  assert.ok(!reached.includes("brief"));
  assert.deepEqual(missing, []);
  const after = applyUpdates(ITEMS(), updates);
  assert.equal(statusOf(after).brief, "CURRENT"); // tone and kept choices are reused by the next clip
  assert.ok(after.filter((i) => i.id !== "brief").every((i) => i.status === "STALE"));
  // The links are followed, not the kinds: an edit that does not derive from this bundle's captures is not reached.
  const foreign = [...ITEMS(), it("editX", "edit", "master", ["capX"]), it("capX", "capture", "desktop", [])];
  assert.ok(!ids(cascade(foreign, ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason }).updates).includes("editX"));
  // Unknown roots are reported, never guessed.
  assert.deepEqual(cascade(ITEMS(), ["nope"], { mode: "STALE", code: "FILE_MISSING" }), { updates: [], reached: [], missing: ["nope"] });
  // The brief is not software-bound: named as a root, or wrongly linked under the bundle, a software change still leaves it CURRENT
  // and is not walked through it (its edit is reached through the captures and the claims).
  assert.ok(!ids(cascade(ITEMS(), ["bundle", "brief"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason }).updates).includes("brief"));
  const briefUnderBundle = ITEMS().map((i) => (i.id === "brief" ? { ...i, upstream_json: JSON.stringify(["bundle"]) } : i));
  assert.deepEqual(ids(cascade(briefUnderBundle, ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason }).updates), ALL_BUT_BRIEF);
  assert.deepEqual(ids(cascade([it("brief", "brief", "", []), it("editB", "edit", "master", ["brief"])], ["brief"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason }).updates), []);
  // …while a rights problem on the brief's own material would reach what was made from it.
  assert.deepEqual(ids(cascade([it("brief", "brief", "", []), it("editB", "edit", "master", ["brief"])], ["brief"], { mode: "STALE", code: "RIGHTS_REVOKED", reason }).updates), ["brief", "editB"]);
  // A cycle in bad data does not hang the walk.
  const loop = [it("a", "edit", "master", ["b"]), it("b", "render", "master", ["a"])];
  assert.deepEqual(ids(cascade(loop, ["a"], { mode: "STALE", code: "FILE_MISSING" }).updates), ["a", "b"]);
});

test("M11-SG-03 the cascade is idempotent and never revives an item: CURRENT → SUPERSEDED → STALE only", () => {
  const first = cascade(ITEMS(), ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason: "prima cauză" });
  const stale = applyUpdates(ITEMS(), first.updates);
  // Running it again (same or another reason) changes nothing: the first code and reason are kept.
  assert.deepEqual(cascade(stale, ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason: "a doua cauză" }).updates, []);
  assert.deepEqual(cascade(stale, ["bundle"], { mode: "STALE", code: "RIGHTS_REVOKED", reason: "altă cauză" }).updates, []);
  assert.equal(stale.find((i) => i.id === "renderM").statusReason, "prima cauză");
  // A STALE item is never moved back: not to SUPERSEDED by a later media revision, not to CURRENT by anything.
  assert.deepEqual(cascade(stale, ["edit"], { mode: "SUPERSEDED", reason: "montaj nou" }).updates, []);
  const revived = applyUpdates(stale, [{ id: "renderM", status: "CURRENT" }, { id: "edit", status: "SUPERSEDED" }]);
  assert.deepEqual([statusOf(revived).renderM, statusOf(revived).edit], ["STALE", "STALE"]);
  for (const mode of ["STALE", "SUPERSEDED"]) {
    for (const roots of [["bundle"], ["edit"], ["variant"], ["capD"]]) {
      const { updates } = cascade(ITEMS(), roots, { mode, code: mode === "STALE" ? "FILE_MISSING" : "", reason: "x" });
      assert.ok(updates.every((u) => u.status !== "CURRENT"));
    }
  }
  // SUPERSEDED items do become STALE when their software basis changes (stale is the stronger statement).
  const superseded = applyUpdates(ITEMS(), cascade(ITEMS(), ["edit"], { mode: "SUPERSEDED", reason: "montaj nou" }).updates);
  const then = cascade(superseded, ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason: "software schimbat" });
  assert.deepEqual(ids(then.updates), ALL_BUT_BRIEF);
  assert.deepEqual(then.updates.find((u) => u.id === "renderM").from, "SUPERSEDED");
  // Bad arguments are refused.
  throwsCode(() => cascade(ITEMS(), ["bundle"], { mode: "CURRENT" }), "CASCADE_MODE_INVALID");
  throwsCode(() => cascade(ITEMS(), ["bundle"], { mode: "STALE" }), "CASCADE_CODE_INVALID"); // a stale item says why
  throwsCode(() => cascade(ITEMS(), ["bundle"], { mode: "STALE", code: "BECAUSE" }), "CASCADE_CODE_INVALID");
});

test("M11-SG-04 STALE and SUPERSEDED are distinct: a media revision supersedes only what derives from the old montage", () => {
  const media = cascade(ITEMS(), ["edit"], { mode: "SUPERSEDED", reason: "înlocuit de o versiune nouă a montajului" });
  assert.deepEqual(ids(media.updates), MEDIA_CHAIN);
  assert.ok(media.updates.every((u) => u.status === "SUPERSEDED" && u.staleCode === ""));
  const after = statusOf(applyUpdates(ITEMS(), media.updates));
  for (const id of ["bundle", "shot6", "shot7", "preview", "capD", "capM", "brief", "claim1", "claim6", "claim7"]) assert.equal(after[id], "CURRENT", id);
  // Vertical only: the master's render, QA and export are untouched.
  const vertical = cascade(ITEMS(), ["variant"], { mode: "SUPERSEDED", reason: "variantă nouă" });
  assert.deepEqual(ids(vertical.updates), VERTICAL_CHAIN);
  // includeRoots: false leaves the root itself as it is (its children still change).
  assert.deepEqual(ids(cascade(ITEMS(), ["edit"], { mode: "SUPERSEDED", includeRoots: false }).updates), MEDIA_CHAIN.filter((id) => id !== "edit"));
});

test("M11-SG-05 currentView: an item is current evidence only with status CURRENT AND the delivery's verified snapshot", () => {
  const view = currentView(ITEMS(), DELIVERY);
  assert.equal(view.current.length, 18);
  assert.deepEqual(view.hidden, []);
  // A missed status write: the clip's rows still say CURRENT, but they were made from another snapshot → never shown as current.
  const other = "o".repeat(64);
  const drifted = ITEMS().map((i) => (["renderM", "renderV", "capD"].includes(i.id) ? { ...i, snapshot_sha: other } : i));
  const hidden = currentView(drifted, DELIVERY).hidden;
  assert.deepEqual(hidden, [{ id: "capD", kind: "capture", role: "desktop", why: "SNAPSHOT_MISMATCH" }, { id: "renderM", kind: "render", role: "master", why: "SNAPSHOT_MISMATCH" }, { id: "renderV", kind: "render", role: "vertical", why: "SNAPSHOT_MISMATCH" }]);
  // The same from the delivery's side: a new verified snapshot hides every old item except the brief.
  const moved = currentView(ITEMS(), { ...DELIVERY, snapshot_sha: other });
  assert.deepEqual(moved.current.map((i) => i.id), ["brief"]);
  assert.ok(moved.hidden.every((h) => h.why === "SNAPSHOT_MISMATCH"));
  // No verified snapshot yet: nothing but the brief is evidence.
  assert.deepEqual(currentView(ITEMS(), { ...DELIVERY, snapshot_sha: "" }).current.map((i) => i.id), ["brief"]);
  // A STALE or CLOSED delivery shows nothing as current, whatever the rows say.
  for (const [status, why] of [["STALE", "DELIVERY_STALE"], ["CLOSED", "DELIVERY_CLOSED"]]) {
    const v = currentView(ITEMS(), { ...DELIVERY, status });
    assert.deepEqual([v.current.length, new Set(v.hidden.map((h) => h.why)).size, v.hidden[0].why], [0, 1, why]);
  }
  // Status reasons: STALE and SUPERSEDED items are hidden with their status.
  const stale = applyUpdates(ITEMS(), cascade(ITEMS(), ["variant"], { mode: "SUPERSEDED" }).updates);
  assert.equal(notCurrentReason(stale.find((i) => i.id === "variant"), DELIVERY), "SUPERSEDED");
  assert.equal(notCurrentReason(stale.find((i) => i.id === "renderM"), DELIVERY), null);
  assert.equal(notCurrentReason(ITEMS()[6], { ...DELIVERY, snapshotSha: other, snapshot_sha: undefined }), null); // the brief, camelCase delivery
});

test("M11-SG-06 slotsComplete: bundle, both captures, the master edit and render, the variant and its render, QA ×2, export ×2", () => {
  assert.deepEqual(slotsComplete(ITEMS()), { complete: true, missing: [], slots: { bundle: "bundle", "capture:desktop": "capD", "capture:mobile": "capM", "edit:master": "edit", "render:master": "renderM",
    "variant:vertical": "variant", "render:vertical": "renderV", "qa:master": "qaM", "qa:vertical": "qaV", "export:master": "exportM", "export:vertical": "exportV" } });
  assert.equal(slotsComplete(ITEMS(), DELIVERY).complete, true);
  const without = (id) => ITEMS().filter((i) => i.id !== id);
  assert.deepEqual(slotsComplete(without("qaV")).missing, ["qa:vertical"]);
  assert.deepEqual(slotsComplete(without("capM")).missing, ["capture:mobile"]);
  // A superseded vertical chain leaves its four slots open until the new items are bound.
  const superseded = applyUpdates(ITEMS(), cascade(ITEMS(), ["variant"], { mode: "SUPERSEDED" }).updates);
  assert.deepEqual(slotsComplete(superseded).missing, ["variant:vertical", "render:vertical", "qa:vertical", "export:vertical"]);
  // With the delivery, an item from another snapshot does not fill a slot even if its row says CURRENT.
  const drifted = ITEMS().map((i) => (i.id === "renderM" ? { ...i, snapshot_sha: "o".repeat(64) } : i));
  assert.equal(slotsComplete(drifted).complete, true);
  assert.deepEqual(slotsComplete(drifted, DELIVERY), { ...slotsComplete(drifted, DELIVERY), complete: false, missing: ["render:master"] });
  assert.equal(slotsComplete([]).missing.length, 11);
  // previousOf: what a new item of the same kind and role supersedes.
  assert.equal(previousOf(ITEMS(), "render", "master").id, "renderM");
  assert.equal(previousOf(ITEMS(), "render", "square"), null);
  assert.equal(previousOf(superseded, "variant", "vertical").id, "variant"); // superseded, still its predecessor
  assert.equal(previousOf(applyUpdates(ITEMS(), cascade(ITEMS(), ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED" }).updates), "render", "master"), null);
});

test("M11-SG-07 variants are invalidated only for software or rights; documents go STALE or get their video section regenerated", () => {
  const software = cascade(ITEMS(), ["bundle"], { mode: "STALE", code: "SOFTWARE_CHANGED", reason: "software schimbat" }).updates;
  const rights = cascade(ITEMS(), ["capM"], { mode: "STALE", code: "RIGHTS_REVOKED", reason: "drepturi retrase" }).updates;
  const missing = cascade(ITEMS(), ["renderV"], { mode: "STALE", code: "FILE_MISSING", reason: "fișier lipsă" }).updates;
  const media = cascade(ITEMS(), ["edit"], { mode: "SUPERSEDED", reason: "montaj nou" }).updates;
  assert.deepEqual(variantsToInvalidate(software), ["mvr_1"]); // the media_variants id (ref_id), not the item id
  assert.deepEqual(variantsToInvalidate(rights), ["mvr_1"]);
  assert.deepEqual(variantsToInvalidate(missing), []);
  assert.deepEqual(variantsToInvalidate(media), []);
  assert.deepEqual(variantsToInvalidate(cascade(ITEMS(), ["variant"], { mode: "STALE", code: "FILE_MISSING" }).updates), []);
  assert.deepEqual(variantsToInvalidate(null), []);
  // Documents.
  assert.deepEqual(documentOf(DOCS()[0]), { id: "ddoc_1", status: "CURRENT", version: 1, itemIds: ["renderM", "renderV", "exportM", "exportV"], bundleSha: "b".repeat(64), serviceRefs: ["svc_detailing@3"] });
  assert.deepEqual(documentsToStale(software, DOCS()), [{ id: "ddoc_1", status: "STALE", reason: "software schimbat" }]); // only the CURRENT version
  assert.deepEqual(documentsToStale(missing, DOCS()), [{ id: "ddoc_1", status: "STALE", reason: "fișier lipsă" }]);
  assert.deepEqual(documentsToStale(media, DOCS()), []); // superseded is not stale
  assert.deepEqual(documentsToStale(cascade(ITEMS(), ["shot6"], { mode: "STALE", code: "FILE_MISSING" }).updates.filter((u) => u.id === "shot6"), DOCS()), []);
  assert.deepEqual(documentsToRegenerate(media, DOCS()), [{ id: "ddoc_1", only: ["video"] }]);
  assert.deepEqual(documentsToRegenerate(software, DOCS()), []);
  assert.deepEqual(documentsToStale([], DOCS()), []);
});

test("M11-SG-08 the delivery status machine: STALE and the closed states never lead back", () => {
  assert.deepEqual([...DELIVERY_STATUSES], ["PLANNED", "ARMED", "ACTIVE", "READY", "NEEDS_OWNER", "STALE", "CLOSED", "CANCELLED", "EXPIRED", "FAILED"]);
  assert.deepEqual(Object.keys(DELIVERY_TRANSITIONS).sort(), [...DELIVERY_STATUSES].sort());
  for (const [from, to] of [["PLANNED", "ARMED"], ["PLANNED", "ACTIVE"], ["PLANNED", "CANCELLED"], ["ARMED", "ARMED"], ["ARMED", "ACTIVE"], ["ARMED", "EXPIRED"], ["ARMED", "FAILED"], ["ACTIVE", "READY"], ["ACTIVE", "NEEDS_OWNER"],
    ["NEEDS_OWNER", "ACTIVE"], ["NEEDS_OWNER", "STALE"], ["READY", "STALE"], ["READY", "CLOSED"], ["STALE", "CLOSED"], ["NEEDS_OWNER", "CLOSED"]]) assert.equal(canTransition(from, to), true, `${from}→${to}`);
  for (const [from, to] of [["STALE", "READY"], ["STALE", "ACTIVE"], ["CLOSED", "READY"], ["CANCELLED", "ARMED"], ["EXPIRED", "ACTIVE"], ["FAILED", "ACTIVE"], ["READY", "ACTIVE"], ["PLANNED", "READY"], ["ACTIVE", "STALE"], ["X", "READY"]]) {
    assert.equal(canTransition(from, to), false, `${from}→${to}`);
  }
});

// ---------------------------------------------------------------- one rule per trigger

const state = (over = {}) => ({ items: ITEMS(), delivery: DELIVERY, documents: DOCS(), ...over });

test("M11-SG-09 rule software_changed / software_revision: the whole software-bound cascade STALE, variants invalidated, the summary STALE, the delivery STALE", () => {
  assert.deepEqual([...TRIGGERS], ["software_changed", "software_revision", "media_revision", "vertical_revision", "studio_correction", "rights_revoked", "file_missing", "catalog_changed", "accepted", "plan_stopped", "envelope_closed"]);
  assert.deepEqual(Object.keys(RULES), [...TRIGGERS]);
  const r = applyRule("software_changed", state(), { cause: "workspace-ul s-a schimbat după versiunea testată (README.md)" });
  assert.equal(r.reason, "software-ul s-a schimbat: workspace-ul s-a schimbat după versiunea testată (README.md)");
  assert.deepEqual(ids(r.itemUpdates, "STALE"), ALL_BUT_BRIEF);
  assert.ok(r.itemUpdates.every((u) => u.staleCode === "SOFTWARE_CHANGED" && u.statusReason === r.reason));
  assert.deepEqual(r.orphans, []);
  assert.deepEqual(r.variants, ["mvr_1"]);
  assert.deepEqual(r.documentUpdates, [{ id: "ddoc_1", status: "STALE", reason: r.reason }]);
  assert.deepEqual(r.delivery, { status: "STALE", reason: r.reason });
  assert.deepEqual(r.bundleMeta, []);
  // From NEEDS_OWNER too; an ACTIVE delivery is not moved by this rule (its plan step fails and stops it first).
  assert.equal(applyRule("software_changed", state({ delivery: { ...DELIVERY, status: "NEEDS_OWNER" } }), {}).delivery.status, "STALE");
  assert.equal(applyRule("software_changed", state({ delivery: { ...DELIVERY, status: "ACTIVE" } }), {}).delivery, null);
  // A missing link must not leave an old clip CURRENT: the sweep stales it and names it as an orphan.
  const unlinked = ITEMS().map((i) => (i.id === "exportV" ? { ...i, upstream_json: "[]" } : i));
  const swept = applyRule("software_changed", state({ items: unlinked }), { cause: "bundle nou" });
  assert.deepEqual(swept.orphans, ["exportV"]);
  assert.deepEqual(ids(swept.itemUpdates, "STALE"), ALL_BUT_BRIEF);
  // Idempotent: applied twice, the second run changes nothing.
  const again = applyRule("software_changed", state({ items: applyUpdates(ITEMS(), r.itemUpdates), delivery: { ...DELIVERY, status: "STALE" }, documents: [{ ...DOCS()[0], status: "STALE" }] }), { cause: "x" });
  assert.deepEqual([again.itemUpdates, again.variants, again.documentUpdates, again.delivery], [[], [], [], null]);
  // The owner's software revision: the same effect, with its own reason.
  const rev = applyRule("software_revision", state(), { missionId: "mis_m2" });
  assert.equal(rev.reason, "revizie software în curs: misiunea mis_m2");
  assert.deepEqual([ids(rev.itemUpdates, "STALE"), rev.delivery.status], [ALL_BUT_BRIEF, "STALE"]);
  throwsCode(() => applyRule("unknown_trigger", state(), {}), "STALE_TRIGGER_UNKNOWN");
});

test("M11-SG-10 rule media_revision / vertical_revision: SUPERSEDED with links kept, only the video section regenerated, the delivery stays READY", () => {
  const r = applyRule("media_revision", state(), {});
  assert.deepEqual(ids(r.itemUpdates, "SUPERSEDED"), MEDIA_CHAIN);
  assert.deepEqual([r.variants, r.documentUpdates, r.delivery, r.orphans], [[], [], null, []]);
  assert.deepEqual(r.documentRegenerations, [{ id: "ddoc_1", only: ["video"] }]);
  const v = applyRule("vertical_revision", state(), {});
  assert.deepEqual(ids(v.itemUpdates, "SUPERSEDED"), VERTICAL_CHAIN);
  assert.deepEqual([v.variants, v.delivery], [[], null]);
  // When the new items are already bound, they are named and kept out of the cascade.
  const withNew = [...ITEMS(), { ...it("edit2", "edit", "master", ["capD", "capM", "brief"]), supersedes_id: "edit" }, it("render2", "render", "master", ["edit2"])];
  const kept = applyRule("media_revision", state({ items: withNew }), { rootIds: ["edit"], keepIds: ["edit2", "render2"] });
  assert.deepEqual(ids(kept.itemUpdates), MEDIA_CHAIN);
  const all = applyRule("media_revision", state({ items: withNew }), { keepIds: ["edit2", "render2"] });
  assert.deepEqual(ids(all.itemUpdates), MEDIA_CHAIN);
});

test("M11-SG-11 rule studio_correction / rights_revoked / file_missing: roots by reference, the right code, the delivery asks the owner", () => {
  // A correction made in the Studio on the delivery's master edit version.
  const studio = applyRule("studio_correction", state(), { refIds: ["mev_1"] });
  assert.deepEqual(ids(studio.itemUpdates, "SUPERSEDED"), MEDIA_CHAIN);
  assert.deepEqual(studio.itemUpdates.filter((u) => u.staleCode === "STUDIO_CORRECTED").map((u) => u.id).sort(), ["renderM", "renderV"]);
  assert.deepEqual(studio.delivery, { status: "NEEDS_OWNER", reason: "clipul a fost corectat în Studio; randez din nou?" });
  assert.deepEqual(studio.variants, []);
  // …or on the variant's own edit version (kept in the variant item's meta).
  assert.deepEqual(ids(applyRule("studio_correction", state(), { refIds: ["mev_2"] }).itemUpdates), VERTICAL_CHAIN);
  // Rights revoked on the phone capture: it and everything made from it; the desktop capture and the software evidence stay.
  const rights = applyRule("rights_revoked", state(), { refIds: ["mav_mob"] });
  assert.deepEqual(ids(rights.itemUpdates, "STALE"), ["capM", ...MEDIA_CHAIN].sort());
  assert.ok(rights.itemUpdates.every((u) => u.staleCode === "RIGHTS_REVOKED"));
  assert.deepEqual([rights.variants, rights.delivery.status, rights.documentUpdates.map((d) => d.id)], [["mvr_1"], "NEEDS_OWNER", ["ddoc_1"]]);
  // A missing file: FILE_MISSING, the variant row is NOT invalidated.
  const gone = applyRule("file_missing", state(), { refIds: ["mav_render_v"] });
  assert.deepEqual(ids(gone.itemUpdates, "STALE"), ["exportV", "qaV", "renderV"]);
  assert.ok(gone.itemUpdates.every((u) => u.staleCode === "FILE_MISSING"));
  assert.deepEqual([gone.variants, gone.delivery.status, gone.documentUpdates.length], [[], "NEEDS_OWNER", 1]);
  // A file no item refers to changes nothing at all.
  const nothing = applyRule("file_missing", state(), { refIds: ["mav_other"] });
  assert.deepEqual([nothing.itemUpdates, nothing.delivery, nothing.documentUpdates], [[], null, []]);
});

test("M11-SG-12 rule catalog_changed / accepted / plan_stopped / envelope_closed: no item becomes stale", () => {
  const catalog = applyRule("catalog_changed", state(), { serviceId: "svc_detailing", serviceName: "Detailing complet" });
  assert.deepEqual([catalog.itemUpdates, catalog.variants, catalog.delivery], [[], [], null]);
  assert.deepEqual(catalog.documentUpdates, [{ id: "ddoc_1", status: "STALE", reason: "serviciul Detailing complet s-a schimbat" }]);
  assert.deepEqual(applyRule("catalog_changed", state(), { serviceId: "svc_detailing", version: 3 }).documentUpdates.length, 1);
  assert.deepEqual(applyRule("catalog_changed", state(), { serviceId: "svc_detailing", version: 2 }).documentUpdates, []); // another version than the one cited
  assert.deepEqual(applyRule("catalog_changed", state(), { serviceId: "svc_altceva" }).documentUpdates, []);
  // Acceptance: the bundle item's meta, nothing stale, nothing else approved.
  const accepted = applyRule("accepted", state(), {});
  assert.deepEqual([accepted.itemUpdates, accepted.variants, accepted.documentUpdates, accepted.delivery], [[], [], [], null]);
  assert.deepEqual(accepted.bundleMeta, [{ id: "bundle", meta: { bundleStatus: "OWNER_ACCEPTED" } }]);
  // The plan stopped: only the delivery's status, and only from ACTIVE.
  const stopped = applyRule("plan_stopped", state({ delivery: { ...DELIVERY, status: "ACTIVE" } }), { reason: "Sesiunea în care ai confirmat s-a închis" });
  assert.deepEqual([stopped.itemUpdates, stopped.delivery], [[], { status: "NEEDS_OWNER", reason: "Sesiunea în care ai confirmat s-a închis" }]);
  assert.equal(applyRule("plan_stopped", state(), {}).delivery, null); // READY: a stopped revision plan does not unready it
  // The envelope closed before activation — only ITS delivery, and a continuation that re-armed the row is not cancelled.
  const armed = { ...DELIVERY, status: "ARMED" };
  assert.deepEqual(applyRule("envelope_closed", state({ delivery: armed }), { envelopeId: "env_1", envelopeStatus: "REVOKED" }).delivery.status, "CANCELLED");
  assert.deepEqual(applyRule("envelope_closed", state({ delivery: armed }), { envelopeId: "env_1", envelopeStatus: "EXPIRED" }).delivery.status, "EXPIRED");
  assert.deepEqual(applyRule("envelope_closed", state({ delivery: armed }), { envelopeId: "env_1", envelopeStatus: "FAILED_TO_START" }).delivery.status, "CANCELLED");
  assert.equal(applyRule("envelope_closed", state({ delivery: armed }), { envelopeId: "env_1", envelopeStatus: "SUPERSEDED" }).delivery, null); // re-armed by the continuation
  assert.equal(applyRule("envelope_closed", state({ delivery: armed }), { envelopeId: "env_OLD", envelopeStatus: "REVOKED" }).delivery, null);
  assert.deepEqual(applyRule("envelope_closed", state({ delivery: { ...DELIVERY, status: "PLANNED" } }), { envelopeId: "env_1", envelopeStatus: "SUPERSEDED" }).delivery.status, "CANCELLED");
  assert.equal(applyRule("envelope_closed", state({ delivery: { ...DELIVERY, status: "ACTIVE" } }), { envelopeId: "env_1", envelopeStatus: "COMPLETED" }).delivery, null);
  assert.equal(applyRule("envelope_closed", state(), { envelopeId: "env_1", envelopeStatus: "REVOKED" }).itemUpdates.length, 0);
});
