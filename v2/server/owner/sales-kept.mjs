// M12 final review (F7): an offer request kept because there is no approved exports folder yet (the Sales planner's blocker
// SALES_DOSSIER_NO_EXPORTS_DIR, „Cererea ta rămâne păstrată”). It is a work request of its own intent ("sales"), so:
//  - it is explained by ITS blocker — the folder — never by the model-run readiness (the execution gate, Windows Hello): the Sales
//    preparation runs no model and needs no gate;
//  - once the folder exists it is re-planned through the same Sales planner, a proposal only: ONE card the owner still confirms (the
//    work-request service's markPlanned + lega.plan, like every other kept request);
//  - choosing the folder (the media policy, a folder access, an import) re-plans the kept offer requests by itself.
// Nothing here confirms, starts, sends or approves anything.

export const SALES_KEPT_INTENT = "sales";
export const SALES_KEPT_SIGNATURE = "SALES_DOSSIER_NO_EXPORTS_DIR";
const FOLDER_EVENTS = new Set(["media.import.authorized", "media.asset.imported", "media.project.imported"]);

export function createSalesKeptRequests({ hub, plannerOf, requestStore }) {
  const folder = () => { try { return hub.media?.exportsDir?.() || null; } catch { return null; } };

  /** The work-request explainer for a kept offer request: blocked only while there is no approved exports folder. */
  function explain() {
    if (folder()) return { blocked: false, signature: "", causes: [], options: [] };
    const text = "Cererea ta de ofertă e păstrată: lipsește doar folderul de exporturi aprobat, unde se scrie „Dosarul ofertei” (îl alegi o dată în Studio, la importul unui folder). "
      + "Pregătirea nu pornește niciun model și nu are nevoie de poarta de execuție; când folderul există, îți propun singur cardul ofertei, pe care îl confirmi o dată.";
    return { blocked: true, signature: SALES_KEPT_SIGNATURE, cause: SALES_KEPT_SIGNATURE, causes: [SALES_KEPT_SIGNATURE], text,
      short: "Încă lipsește folderul de exporturi aprobat; cererea ta de ofertă e păstrată.", options: [], automaticOnly: false };
  }

  /** The re-planner: the same Sales planner on the kept words, once the folder exists → ONE ops card (a proposal only), or still blocked. */
  async function replan(r) {
    if (!folder()) return { blocked: true };
    const planner = plannerOf();
    if (typeof planner !== "function") return { blocked: true };
    const words = String(r?.text || "");
    const out = await planner({ step: { intent: "sales_prepare", effect: "plan", effectClass: "BOUNDED_WORKFLOW", args: { request: words }, constraints: {}, text: words }, text: words,
      projectId: null, source: "typed", ctx: { channel: "automation", actor: `readiness:${r?.id || "?"}` }, session: null, hub, lastTarget: null });
    if (out?.kind === "ops" && out.plan?.id) return { planRef: { kind: "ops", id: out.plan.id, preparationId: out.preparationId || null }, headline: out.plan.title, eligible: true };
    return { blocked: true };
  }

  /** A change that may have given the Hub its exports folder: the kept offer requests are re-planned (bounded, serialized per request). */
  function onEvent(event) {
    const relevant = (event?.type === "settings.changed" && event.payload?.key === "mediaPolicy") || FOLDER_EVENTS.has(event?.type);
    if (!relevant || !folder()) return;
    const service = requestStore();
    if (!service?.replan || !service.list) return;
    let rows = [];
    // Only the requests still BLOCKED (an OPEN one may be a plan the owner closed himself: it waits until he mentions it again).
    try { rows = service.list({ status: ["BLOCKED"], limit: 20 }).filter((w) => w.intent === SALES_KEPT_INTENT); } catch { rows = []; }
    for (const w of rows) setImmediate(() => { service.replan(w.id).catch(() => {}); });
  }

  return { explain, replan, onEvent };
}
