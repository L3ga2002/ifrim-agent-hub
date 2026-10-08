// M11 „Ifrim Delivery” planner: the owner's words → ONE card. Nothing here starts a model, a capture or a render; it only proposes.
//
// prepare („Lega, pregătește demo-ul de detailing pentru prezentare… fă un clip și pregătește-mi rezumatul comercial. Nu publica
// nimic.”):
//   1. the project: the one named or open in the cockpit, else the only synthetic test project with a delivery template, else ONE question;
//   2. the work: a mission already verified (DELIVERY_READY / ACCEPTED) → the delivery-only card (capture → clip → summary, one
//      confirmation); otherwise the agreed issue as a factory draft (the fixture's approved spec, the pilot's explicit models) and ONE
//      envelope that carries the hashed delivery section — engineering and delivery under the same single confirmation;
//   3. a blocker is explained once in the owner's words and the request is kept (work requests), never a form.
// revise („Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.”): revision.classify on the delivery's
//   current clip → feedback is only noted (never an acceptance); a summary edit is applied as a new version (owner session); a clip
//   change becomes ONE small ops card (no code, no model, no capture); a software change shows the difference and proposes the
//   engineering plan (nothing runs before the owner confirms it).
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../../core/errors.mjs";
import { TEST_PROJECT_MARKER } from "../../domain/projects.mjs";
import { FACTORY_DEMOS, demoSpec } from "../../factory/fixtures.mjs";
import { defaultModelLimits } from "../../factory/plan.mjs";
import { packageSteps, PACKAGE_KIND, DELIVERY_LIMITS } from "../../delivery/template.mjs";
import { classify, REVISION_RECORD_STATUS } from "../../delivery/revision.mjs";

const READY_STAGES = new Set(["DELIVERY_READY", "ACCEPTED"]);
const markerOf = (project) => { try { return JSON.parse(fs.readFileSync(path.join(project.path, TEST_PROJECT_MARKER), "utf8")); } catch { return null; } };
const portOf = (project) => { try { return Number(JSON.parse(fs.readFileSync(path.join(project.path, "config.json"), "utf8")).port) || null; } catch { return null; } };

export function registerDeliveryPlanner(hub, intake) {
  const { projects, factory, envelopes, deliveries, opsPlans, media } = hub;

  /** Synthetic test projects whose fixture has a delivery template. */
  const deliverable = () => projects.list().filter((p) => p.source === "hub-test").map((p) => ({ p, marker: markerOf(p) }))
    .filter(({ marker }) => marker?.data === "synthetic" && FACTORY_DEMOS[marker.fixture]?.delivery).map(({ p }) => p);

  /** A demo the sentence names by a distinctive word of its name („demo-ul de detailing”) wins over the project open in the cockpit. */
  const GENERIC = new Set(["demo", "livrare", "factory", "test", "proiect", "proiectul", "programari"]);
  const words = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  function namedIn(text, list) {
    const said = new Set(words(text));
    const hits = list.filter((p) => words(p.name).some((w) => said.has(w)));
    return hits.length === 1 ? hits[0] : null;
  }

  function pickProject(projectId, text = "") {
    const list = deliverable();
    const named = namedIn(text, list);
    if (named) return { project: named };
    if (projectId) {
      const p = list.find((x) => x.id === projectId);
      if (p) return { project: p };
      const other = projects.get(projectId);
      if (other) return { refused: `${other.name} nu are un demo cu date sintetice pentru prezentare; livrarea M11 filmează doar proiecte de test (niciodată un proiect real sau un client).` };
    }
    if (list.length === 1) return { project: list[0] };
    if (!list.length) return { refused: "Nu există încă un demo de test pentru prezentare (de exemplu „Demo Livrare — Detailing”). Îl pot crea din fixture-ul de programări, cu aprobarea ta." };
    return { question: { question: `Pentru care demo pregătesc livrarea: ${list.slice(0, 4).map((p) => `„${p.name}”`).join(" sau ")}?`, options: list.slice(0, 4).map((p) => ({ id: p.id, label: p.name })) } };
  }

  async function prepare({ step, text, projectId }) {
    const picked = pickProject(projectId, text);
    if (picked.question) return { kind: "question", ...picked.question, forIntent: "delivery_prepare" };
    if (picked.refused) return { kind: "message", text: picked.refused };
    const project = picked.project;
    const marker = markerOf(project);
    const missionsOf = factory.list().filter((f) => f.projectId === project.id);
    // factory.list() is newest first.
    const ready = missionsOf.find((f) => READY_STAGES.has(f.stage)) || null;
    const draft = missionsOf.find((f) => f.stage === "SPEC_DRAFT") || null;
    const running = missionsOf.find((f) => !READY_STAGES.has(f.stage) && !["SPEC_DRAFT", "CANCELLED", "REJECTED", "FAILED"].includes(f.stage));
    if (running) return { kind: "message", projectId: project.id, text: `Pe ${project.name} lucrez deja la „${running.title || "misiunea curentă"}” (${running.stage}). Livrarea pornește singură când software-ul e gata, dacă planul tău o include; altfel o cer după.` };
    const open = deliveries.list({ projectId: project.id }).find((d) => ["ARMED", "ACTIVE"].includes(d.status));
    if (open) return { kind: "message", projectId: project.id, text: `Livrarea pentru ${project.name} e deja în curs (${open.status === "ARMED" ? "pornește când software-ul e gata" : "rulează"}).`, navigate: `/livrare/${open.id}` };

    // A verified version already exists: the delivery-only card (one confirmation; no code, no model).
    if (ready) {
      const r = await deliveries.readiness({ projectId: project.id, missionId: ready.missionId });
      if (!r.ok) return blocked(project, r.blockers);
      const d = await deliveries.createPlanned({ projectId: project.id, missionId: ready.missionId, actor: "intake" });
      const plan = await opsPlans.propose({ kind: PACKAGE_KIND, title: d.title, steps: packageSteps(d.template, d.id), limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions }, actor: "intake", via: "intake" });
      // The confirmed card starts THIS delivery (startDirect at its first step); a newer card for the same delivery replaces the binding.
      if (plan?.id) deliveries.patch(d.id, { ops_plan_id: plan.id });
      return { kind: "ops", plan, projectId: project.id, note: `Software-ul e deja verificat (${ready.stage === "ACCEPTED" ? "acceptat de tine" : "gata de verificarea ta"}): planul face doar captura, clipul 16:9 + vertical și rezumatul comercial. Fără model, fără publicare. O singură confirmare.` };
    }

    // The agreed issue as a factory draft (the fixture's approved spec; the pilot's explicit models), then ONE envelope with the delivery.
    let missionId = draft?.missionId || null;
    if (!missionId) {
      const spec = demoSpec(marker.fixture, { port: portOf(project) });
      const demo = FACTORY_DEMOS[marker.fixture];
      if (typeof hub.prepareFactoryMission !== "function") throw new HubError("internal", "Software Factory nu e disponibil");
      // The same body as factory.prepare (a DRAFT mission + spec v1, nothing runs), with the planner's provenance recorded.
      // The models: the project's override when the owner set one, else the role defaults (the engineering planner's rule; explicit, hashed).
      const models = defaultModelLimits((hub.settings.get("factoryDefaultBindings") || {})[project.id] || null);
      const view = hub.prepareFactoryMission({ projectId: project.id, ...spec, limits: { ...(demo.limits || {}), ...models.limits } },
        { actor: "planner:delivery", provenance: { createdBy: "intake", source: "delivery", channel: "intake" } });
      missionId = view?.mission?.id || null;
      if (!missionId) return { kind: "message", projectId: project.id, text: "Nu am putut pregăti misiunea demo-ului; nimic nu a pornit." };
    }
    const r = await deliveries.readiness({ projectId: project.id, missionId });
    if (!r.ok) return blocked(project, r.blockers);
    const d = await deliveries.createPlanned({ projectId: project.id, missionId, actor: "intake" });
    const proposal = await envelopes.propose({ projectId: project.id, missionIds: [missionId], deliveryId: d.id, constraints: { ...(step?.constraints || {}), noPublish: true }, actor: "intake", via: "intake" });
    if (!proposal?.envelope) return { kind: "blocked", projectId: project.id, text: `Planul nu poate fi prezentat încă: ${(proposal?.summary?.blockers || []).slice(0, 3).join(" · ")}. Cererea ta rămâne păstrată.`,
      blocker: { signature: "DELIVERY_PLAN_INCOMPLETE", text: (proposal?.summary?.blockers || []).join(" · ") }, request: { planRef: null } };
    return { kind: "envelope", proposal, projectId: project.id,
      note: "Un singur plan: repar problema (Codex scrie, Claude verifică doar citind), testele, preview-ul și verificarea pe telefon; apoi, fără altă întrebare și fără model: capturile, clipul 16:9 + vertical și rezumatul comercial. Nu public nimic; acceptarea rămâne a ta." };
  }

  function blocked(project, blockers) {
    const text = `Nu pot pregăti livrarea pentru ${project.name}: ${blockers.map((b) => b.title).join("; ")}. ${blockers[0]?.detail || ""} Cererea ta rămâne păstrată.`.trim();
    return { kind: "blocked", projectId: project.id, text, blocker: { signature: `DELIVERY:${blockers.map((b) => b.code).join(",")}`, cause: blockers[0]?.code, text, causes: blockers.map((b) => b.code) }, request: { planRef: null } };
  }

  /** The delivery a revision is about: the last target, the project's open/ready one, or the newest overall. */
  function deliveryFor({ projectId, lastTarget }) {
    if (lastTarget?.kind === "delivery" && lastTarget.id) { const d = deliveries.get(lastTarget.id); if (d) return d; }
    if (projectId) { const d = deliveries.latestForProject(projectId); if (d) return d; }
    return deliveries.list().find((d) => ["READY", "STALE", "NEEDS_OWNER"].includes(d.status)) || null;
  }

  async function revise({ step, text, projectId, session, lastTarget, room = null }) {
    const d0 = deliveryFor({ projectId, lastTarget });
    if (!d0) return { kind: "message", text: "Nu am încă o livrare pregătită la care să aplic schimbarea. Spune „pregătește demo-ul pentru prezentare” și o fac." };
    const d = deliveries.need(d0.id);
    const v = deliveries.view(d.id);
    const editVersionId = v.clip.master?.editVersionId || null;
    const irOf = (id) => { try { return JSON.parse(hub.db.prepare("SELECT ir_json FROM media_edit_versions WHERE id = ?").get(id).ir_json); } catch { return null; } };
    const out = classify(String(text || step?.args?.request || ""), { master: editVersionId ? { versionId: editVersionId, ir: irOf(editVersionId) } : null, texts: d.template.story.texts,
      tone: deliveries.currentItem(d.id, "brief")?.meta?.prefs?.tone || d.template.story.tone, summary: v.summary ? { documentId: v.summary.documentId, version: v.summary.version, sections: v.summary.sections } : null,
      // The Room's own context (a selected text, a moment in a player, the answer to ONE question): no question when it already says.
      ...(room?.selection ? { selection: room.selection } : {}), ...(Number.isFinite(room?.timecodeMs) ? { timecodeMs: room.timecodeMs } : {}), ...(room?.player ? { player: room.player } : {}), ...(room?.choice ? { choice: room.choice } : {}) });
    const status = REVISION_RECORD_STATUS[out.status] || "NOTED";
    const base = { text: out.textRedacted || text, classes: out.classes, target: out.target || {}, source: "owner", channel: "intake" };
    const lines = [...(out.messages || [])];
    if (out.feedback?.some((f) => f.subject === "software" && f.polarity === "positive")) lines.unshift("Notat că site-ul e bine. Acceptarea software-ului rămâne decizia ta („Accept local” în camera de livrare).");
    if (out.status === "CLARIFY") { deliveries.recordRevision(d.id, { ...base, status: "CLARIFY", clarification: out.clarification }); return { kind: "question", question: out.clarification.question, options: out.clarification.options || [], forIntent: "delivery_revise", projectId: d.projectId }; }
    if (out.status === "SUMMARY_EDIT" && out.summary?.edits?.length) {
      if (!session) return { kind: "message", text: "Rezumatul îl schimb în sesiunea ta de proprietar (Windows Hello)." };
      const doc = deliveries.editDocument(d.id, { sections: out.summary.edits, session });
      deliveries.recordRevision(d.id, { ...base, status: "APPLIED", documentId: doc.id });
      return { kind: "message", projectId: d.projectId, text: [...lines, `Am făcut versiunea ${doc.version} a rezumatului (${out.summary.edits.map((e) => v.summary.sections.find((s) => s.id === e.id)?.heading || e.id).join(", ")}). Software-ul, testele și clipurile rămân la fel.`].join(" "), navigate: `/livrare/${d.id}` };
    }
    if (out.status === "PROPOSE" && out.media?.ops?.length && editVersionId) {
      const review = media.reviews.proposeOps({ editVersionId, ops: out.media.ops, text: out.textRedacted || text, provenance: "lega", actor: "intake" });
      if (review.patch?.preview && review.patch.preview.valid === false) return { kind: "message", text: `Schimbarea nu poate fi aplicată pe montaj: ${review.patch.preview.errors?.[0]?.message || "montaj invalid"}. Nimic nu s-a schimbat.` };
      const rev = deliveries.recordRevision(d.id, { ...base, status: "PROPOSED", reviewId: review.id, delta: { prefs: out.media.prefs || (out.media.brief ? { tone: out.media.brief.audience } : null) } });
      const plan = await hub.commands.dispatch({ type: "delivery.revision.propose", payload: { deliveryId: d.id, revisionId: rev.id }, channel: session ? "owner" : "test", actor: "intake", ownerSession: session });
      return { kind: "ops", plan: plan.result, projectId: d.projectId,
        note: [...lines, `Schimb doar clipul: ${(out.media.lines || []).join("; ") || "textele și montajul"}. Refac randarea 16:9, varianta verticală, QA și secțiunea video a rezumatului. Rămân la fel: software-ul, testele, capturile și restul rezumatului — fără cod nou, fără model. O singură confirmare.`].join(" ") };
    }
    if (out.status === "ROUTE_SOFTWARE" && out.software?.request) {
      // §25: a changed requirement — the difference first, nothing runs; the engineering plan is proposed for ONE confirmation.
      const items = deliveries.items(d.id).filter((i) => i.status === "CURRENT");
      const diff = ["cerința se schimbă: criteriile de acceptanță trebuie revăzute (testul se rescrie, nu se refolosește)", "e nevoie de o misiune nouă de cod (Codex + review Claude)",
        `devin învechite după ea: preview-ul, ${items.filter((i) => i.kind === "capture").length} capturi, clipul și varianta verticală, afirmațiile din rezumat`, "nu încep nimic până nu confirmi planul"];
      const rev = deliveries.recordRevision(d.id, { ...base, status: "ROUTED_SOFTWARE" });
      // The new mission keeps the demo's own proof (preview + browser flows), so the refresh delivery can film the new version.
      const parentSpec = factory.view(d.missionId)?.spec?.spec || null;
      const inheritDemo = parentSpec ? { preview: parentSpec.verification?.preview || null, criteria: (parentSpec.acceptance || []).filter((c) => ["preview", "e2e"].includes(c.verify)) } : null;
      let eng = hub.engineeringPlanner ? await hub.engineeringPlanner.plan({ step: { ...step, args: { ...(step?.args || {}), request: out.software.request, ...(inheritDemo ? { inheritDemo } : {}) } }, text: out.software.request, projectId: d.projectId, session }).catch((e) => ({ kind: "message", text: e.message })) : null;
      // §25 complete (2026-10-08): the same ONE card also carries a refresh delivery linked to this one (parent → child), so after the
      // new code is verified the capture, clips and summary are redone without another question. If the refresh cannot be planned,
      // the engineering card stays as it was and the owner asks for the demo again afterwards.
      let refresh = "";
      const newMission = eng?.kind === "envelope" ? eng.proposal?.envelope?.missionIds?.[0] : null;
      if (newMission) {
        try {
          const child = await deliveries.createPlanned({ projectId: d.projectId, missionId: newMission, parentId: d.id, actor: "intake" });
          const withDelivery = await envelopes.propose({ projectId: d.projectId, missionIds: [newMission], deliveryId: child.id, constraints: { ...(step?.constraints || {}), noPublish: true }, actor: "intake", via: "intake" });
          if (withDelivery?.envelope) {
            eng = { ...eng, proposal: withDelivery };
            deliveries.updateRevision(rev.id, { childDeliveryId: child.id });
            refresh = " Planul include și livrarea nouă (capturi, clipuri, rezumat) pentru versiunea reparată, legată de cea de acum: o singură confirmare pentru tot.";
          } else refresh = ` Livrarea nouă o cer după ce codul e gata (${(withDelivery?.summary?.blockers || []).slice(0, 2).join(" · ") || "planul cu livrare nu s-a putut prezenta"}).`;
        } catch (error) { refresh = ` Livrarea nouă o cer după ce codul e gata (${String(error.message).slice(0, 160)}).`; }
      }
      const head = `${[...lines].join(" ")} Asta schimbă software-ul: ${diff.join("; ")}.${refresh}`.trim();
      if (eng && (eng.kind === "envelope" || eng.kind === "question")) return { ...eng, note: `${head} ${eng.note || ""}`.trim(), ...(eng.kind === "question" ? { question: `${head} ${eng.question}` } : {}) };
      return { kind: "message", projectId: d.projectId, text: `${head} ${eng?.text || ""}`.trim() };
    }
    deliveries.recordRevision(d.id, { ...base, status: status === "PROPOSED" ? "NOTED" : status });
    return { kind: "message", projectId: d.projectId, text: lines.join(" ") || "Notat. Nimic nu se schimbă în livrare până nu spui ce anume să refac." };
  }

  /** „Arată-mi ce ai pregătit” / „Deciziile mele” — navigation only. */
  function open({ step, projectId, lastTarget }) {
    if (step?.args?.decisions) return { kind: "message", text: "Deciziile tale, într-un singur loc.", navigate: "/livrare/decizii" };
    const d = deliveryFor({ projectId, lastTarget });
    if (!d) return { kind: "message", text: "Nu am încă o livrare pregătită. Spune „pregătește demo-ul pentru prezentare”." };
    return { kind: "message", projectId: d.projectId, text: summaryLine(deliveries.view(d.id)), navigate: `/livrare/${d.id}` };
  }

  /** What Lega says about a delivery: the result in plain words, never ids or grants (§26). */
  function summaryLine(v) {
    const crit = v.software?.criteria || [];
    const passed = crit.filter((c) => String(c.status).startsWith("PASS"));
    const mobile = crit.find((c) => c.verify === "e2e" && /telefon/i.test(c.text));
    const parts = [];
    if (v.delivery.status === "READY") {
      if (mobile && String(mobile.status).startsWith("PASS")) parts.push("Programarea pe telefon funcționează și a trecut testul de acceptanță și verificarea în browser.");
      else parts.push(`Software-ul a trecut ${passed.length} din ${crit.length} criterii.`);
      if (v.software?.review?.verdict === "PASS") parts.push("Reviewerul nu a găsit probleme blocante.");
      if (v.clip.master && v.clip.vertical) parts.push("Am pregătit clipul 16:9 și varianta verticală.");
      if (v.summary) parts.push(`Rezumatul comercial e la versiunea ${v.summary.version}.`);
      const obs = v.observations.filter((o) => o.kind !== "summary").length;
      if (obs) parts.push(`Mai există ${obs} ${obs === 1 ? "observație" : "observații"} de văzut.`);
      parts.push("Nimic nu e acceptat sau publicat: decizia e a ta.");
    } else if (v.delivery.status === "STALE") parts.push(`Livrarea e învechită: ${v.delivery.statusReason}.`);
    else parts.push(`Livrarea: ${v.delivery.statusReason || v.delivery.status}.`);
    return parts.join(" ");
  }

  intake.registerPlanner("delivery", async (args) => {
    const intent = args.step?.intent;
    if (intent === "delivery_revise") return revise(args);
    if (intent === "delivery_open" || intent === "delivery_status" || intent === "delivery_decisions") return open(args);
    return prepare(args);
  });
  return { prepare, revise, open, summaryLine, deliverable };
}
