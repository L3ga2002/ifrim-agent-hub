// M15: the plainer phrasings the owner uses (an engineering request said with „Fă …”, „Care e starea proiectului?”, „Unde e devizul?”, „Arată-mi
// rezultatele”, „Ce e gata?”) and „Ce decizii am?” answered from the same list as „Deciziile mele” — on the owner's channels only, never on the
// agent / cli channels, and never broken by that list. Synthetic test hub; no model.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent } from "../server/owner/intents.mjs";
import { acceptanceHub, seedReady } from "./accept-helpers.mjs";

const CTX = { projects: [{ id: "p", name: "Accept synthetic", source: "hub-test" }], currentProjectId: "p" };
const intentsOf = (s) => resolveIntent(s, CTX).steps.map((x) => x.intent).join(",");

test("M15-INT-01 plainer phrasings resolve to the existing reads / one engineering plan; the old meanings stay", () => {
  const table = [
    ["Fă formularul de contact cu validarea emailului", "engineering_request"],
    ["Construiește pagina de programări", "engineering_request"],
    ["Repară bug-ul: un nume format doar din spații trece de validare.", "engineering_request"],
    ["Care e starea proiectului?", "status"],
    ["Cum stă proiectul?", "status"],
    ["Unde e devizul?", "desk_show"],
    ["Arată devizul", "desk_show"],
    ["Arată-mi rezultatele", "results_show"],
    ["Arată istoricul", "results_show"],
    ["Ce e gata?", "results_show"],
    ["Ce decizii am?", "decisions"],
    ["Ce am de decis?", "decisions"],
    // Unchanged meanings (a video, an offer, a deviz, a refusal, a confirmation never become an engineering plan).
    ["Fă un videoclip de promovare de 30 de secunde", "studio_create"],
    ["Fă un clip pentru pagina de contact", "studio_create"],
    ["Fă-mi un deviz", "sales_prepare"],
    ["Arată-mi oferta", "sales_show"],
    ["Care e ultima livrare?", "last_delivery"],
    ["Oprește tot", "stop_all"],
  ];
  for (const [s, want] of table) assert.equal(intentsOf(s), want, s);
  // Too loose to be a request: a clarification, never a plan.
  for (const s of ["Fă pagina", "Fă un plan cu butonul", "Ce e gata de aprobat", "Ce e gata, confirm"]) assert.doesNotMatch(intentsOf(s), /engineering_request|results_show|confirm/, s);
  for (const s of ["Nu, nu face pagina de contact", "\"Fă pagina de contact\""]) assert.doesNotMatch(intentsOf(s), /engineering_request/, s);
});

test("M15-INT-02 „Ce decizii am?” names what waits in „Deciziile mele” on the owner's channels; the agent / cli channels get no inbox (like the route)", async (c) => {
  const t = await acceptanceHub({ seedProject: true });
  c.after(() => t.cleanup());
  const seeded = await seedReady(t);
  const ask = (channel) => t.hub.intake.handle({ text: "Ce decizii am?", source: "typed" }, { channel, actor: channel === "owner" ? "owner:test" : channel });
  const owner = await ask("owner");
  const step = owner.results.find((r) => r.decisions);
  assert.ok(step, JSON.stringify(owner).slice(0, 400));
  assert.ok(step.inbox.some((it) => it.kind === "software_bundle" && it.link && it.title), JSON.stringify(step.inbox));
  assert.ok(step.inbox.every((it) => Object.keys(it).sort().join() === "kind,link,title"), "titles and links only");
  for (const channel of ["agent", "cli"]) {
    const r = await ask(channel).catch((e) => ({ refused: e }));
    const s = r.refused ? null : r.results.find((x) => x.decisions);
    assert.ok(!s || s.inbox === undefined, `${channel}: no inbox`);
  }
  // Read-only: the package still waits, nothing decided.
  assert.equal(t.hub.db.prepare("SELECT status FROM factory_bundles WHERE id = ?").get(seeded.bundleId).status, "READY_FOR_OWNER_ACCEPTANCE");
});
