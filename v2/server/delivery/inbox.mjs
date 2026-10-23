// M11 „Deciziile mele” — every result that waits for the owner, in one read-only list: what it is, why it waits, what accepting or
// rejecting (closing, keeping) does, and which files / effects it touches. It decides nothing and has no button of its own: each row
// links to the place where the existing owner-session command lives (the Software Factory's accept / reject, the Delivery Room's
// creative and summary decisions). Never a list of grants.
import { parse } from "../storage/db.mjs";
import { deskDecisions } from "../desk/desk-commands.mjs";

const lineOf = (c) => `${c.id}: ${String(c.status || "")}`;
const minutesLeft = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/**
 * M12 final review (C1): the owner's one Sales decision — the internal approval of EXACTLY the offer a WAITING_OWNER preparation waits for
 * (id, version, full SHA) — while it is still that decision: the offer is the current version, DRAFT, not STALE, the opportunity waits for
 * his review, and the confirmed plan's window has not passed. Decided (APPROVED_INTERNAL), STALE, stopped, expired or cancelled → gone.
 * Read only: the row links to the Opportunity screen, where „Aprob intern” runs in the owner session.
 */
export function salesOfferDecisions(hub, now = new Date()) {
  const { salesPreparations: preparations, sales } = hub;
  if (!preparations?.list || !sales?.latestProposal) return [];
  const items = [];
  for (const p of preparations.list({ status: "WAITING_OWNER" })) {
    if (!p.awaited || !p.opportunityId || !preparations.awaitedCurrent(p)) continue;
    const at = p.activateBy ? Date.parse(p.activateBy) : NaN;
    if (Number.isFinite(at) && at <= now.getTime()) continue;
    const latest = sales.latestProposal(p.opportunityId);
    if (!latest || latest.status !== "DRAFT") continue;
    let view = null;
    try { view = sales.getOpportunity(p.opportunityId); } catch { view = null; }
    if (view?.opportunity?.status !== "READY_FOR_OWNER_REVIEW") continue;
    const remainingMin = Number.isFinite(at) ? Math.max(0, Math.floor((at - now.getTime()) / 60000)) : null;
    const client = String(p.brief?.fields?.clientType?.value || view.org?.displayName || "cerere de ofertă").slice(0, 80);
    const window = remainingMin === null ? "" : ` Dacă o aprobi până la ${p.activateBy} (încă ${minutesLeft(remainingMin)}), ciorna și dosarul se fac singure; după aceea, o continuare cere un card nou.`;
    items.push({ kind: "sales_offer", id: latest.id, preparationId: p.id, opportunityId: p.opportunityId, projectId: null, projectName: "Vânzări (date sintetice)", real: false, synthetic: true,
      title: `Oferta v${latest.version} (sintetic): ${client}`, waitingSince: p.updatedAt,
      target: { proposalId: latest.id, version: latest.version, proposalSha: latest.contentSha }, activateBy: p.activateBy || null, remainingMin,
      what: `Oferta sintetică pregătită de planul confirmat de tine (${client}), versiunea ${latest.version}; ținta exactă a aprobării e mai jos (id, versiune, SHA complet).`,
      why: `Așteaptă aprobarea ta internă („Aprob intern”, în sesiunea de proprietar, pe pagina oportunității).${window}`,
      acceptLabel: "Dacă o aprobi:", rejectLabel: "Dacă nu o aprobi:",
      ifAccept: "Oferta devine aprobată intern, legată de exact acest SHA; apoi ciorna de contact (netrimisă, DRAFT_ONLY) și „Dosarul ofertei” se fac local, fără altă întrebare. Nu se trimite nimic și nu înseamnă CONTACTED sau WON.",
      ifReject: "Nimic nu pornește; după fereastra planului pregătirea expiră, iar o continuare cere un card nou. Oferta rămâne ciornă.",
      effects: ["date sintetice (domeniu .test, CUI fictiv)", "după aprobare: o ciornă netrimisă și un dosar local în folderul de exporturi", "nimic trimis, publicat sau cheltuit"],
      link: `/sales?tab=opp&id=${encodeURIComponent(p.opportunityId)}` });
  }
  return items;
}

export function decisionsInbox(hub) {
  const { db, factory, deliveries, projects } = hub;
  const items = [];
  // M15: a delivery row says real / test from its project (a fixed false was shown as „proiect de test” for a real delivery); a hub view
  // without projects (some unit stubs) keeps the old answer.
  const realProject = (projectId) => (typeof projects?.get === "function" ? projects.get(projectId)?.source !== "hub-test" : false);
  for (const f of factory.list()) {
    const project = projects.get(f.projectId);
    const real = project?.source !== "hub-test";
    if (f.stage === "DELIVERY_READY") {
      const bundle = db.prepare("SELECT * FROM factory_bundles WHERE mission_id = ? AND status = 'READY_FOR_OWNER_ACCEPTANCE' ORDER BY created_at DESC LIMIT 1").get(f.missionId);
      if (!bundle) continue;
      const manifest = parse(bundle.manifest_json, {});
      const room = db.prepare("SELECT id FROM deliveries WHERE bundle_id = ? AND status IN ('PLANNED','ARMED','ACTIVE','READY','NEEDS_OWNER') ORDER BY created_at DESC LIMIT 1").get(bundle.id);
      const files = (manifest.changeSet?.files || []).map((x) => `${x.status === "added" ? "nou" : x.status === "deleted" ? "șters" : "modificat"}: ${x.path}`);
      const criteria = manifest.spec?.criteria || [];
      const passed = criteria.filter((c) => String(c.status).startsWith("PASS")).length;
      items.push({ kind: "software_bundle", id: bundle.id, missionId: f.missionId, projectId: f.projectId, projectName: project?.name || "?", real, title: f.title, waitingSince: bundle.created_at,
        what: `Pachet software verificat pe ${project?.name || "proiect"}${real ? " (proiect REAL)" : " (proiect de test)"}: „${f.title}”. ${passed} din ${criteria.length} criterii trecute.`,
        why: "Așteaptă acceptarea ta locală. Nimic nu e comis, urcat sau publicat.",
        ifAccept: "Pachetul devine acceptat (OWNER_ACCEPTED), preview-ul se oprește; fișierele rămân cum sunt acum în folderul proiectului. Commit, push sau deploy rămân acțiuni separate, cu aprobarea ta.",
        ifReject: "Pachetul devine respins, misiunea se închide; modificările rămân în folder (revenirea la bază nu se face automat; snapshot-ul de bază e păstrat în Hub).",
        effects: files.length ? files : ["fără fișiere modificate"], criteria: criteria.map(lineOf), link: room ? `/livrare/${room.id}` : `/missions/${f.missionId}` });
    } else if (f.stage === "NEEDS_OWNER_DECISION") {
      const runs = db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id IN (SELECT id FROM tasks WHERE mission_id = ?)").get(f.missionId).n;
      const changes = db.prepare("SELECT COUNT(*) AS n FROM factory_change_sets WHERE mission_id = ?").get(f.missionId).n;
      items.push({ kind: "mission_decision", id: f.missionId, missionId: f.missionId, projectId: f.projectId, projectName: project?.name || "?", real, title: f.title, waitingSince: f.updatedAt || null,
        what: `Misiune oprită pentru decizia ta pe ${project?.name || "proiect"}: „${f.title}”.`, why: f.stageReason || "Hub-ul nu continuă fără tine.",
        facts: [`Modele pornite: ${runs ? `DA (${runs})` : "NU"}`, `Modificări în proiect: ${changes ? `DA (${changes} seturi)` : "NU"}`],
        ifAccept: "Dacă o închizi: misiunea se anulează și dispare din listă; nimic nu se schimbă în proiect.",
        ifReject: "Dacă o lași: rămâne aici, în așteptare; nu blochează alte lucrări.",
        effects: changes ? ["modificări în proiect (vezi misiunea)"] : ["niciun fișier schimbat"], link: `/missions/${f.missionId}` });
    }
  }
  for (const d of deliveries.list().filter((x) => ["READY", "NEEDS_OWNER"].includes(x.status))) {
    const v = deliveries.view(d.id);
    if (v.correction?.plan && v.revisions.some(r => r.planId === v.correction.plan.id && r.source === 'hub')) {
      const proposed = v.correction.plan.status === 'PROPOSED';
      items.push({ kind: 'delivery_correction', id: v.correction.plan.id, projectId: d.projectId, projectName: v.delivery.projectName, real: realProject(d.projectId), title: 'Corectură afirmații (clip + rezumat)', waitingSince: d.updatedAt, what: 'Corectură propusă de Hub pentru afirmațiile livrării.', why: proposed ? 'Așteaptă confirmarea ta.' : 'Corectura rulează.', ifAccept: 'Scrie versiuni noi; păstrează software-ul și istoricul.', ifReject: proposed ? 'Nimic nu pornește.' : 'Corectura rulează; o poți opri din locul deciziei.', effects: v.correction.defects.map(f => f.plain), link: '/livrare/' + d.id });
    }
    const pending = [];
    if (v.decisions.creativeMaster !== "APPROVED") pending.push("aprobarea creativă a clipului 16:9");
    if (v.decisions.creativeVertical !== "APPROVED") pending.push("aprobarea creativă a variantei verticale");
    if (v.decisions.summaryReady !== "READY") pending.push("rezumatul „gata de prezentare”");
    if (v.decisions.software !== "ACCEPTED") pending.push("acceptarea locală a software-ului");
    if (!pending.length) continue;
    items.push({ kind: "delivery", id: d.id, projectId: d.projectId, projectName: v.delivery.projectName, real: realProject(d.projectId), title: d.title, waitingSince: d.updatedAt,
      what: `Livrarea pregătită: ${d.title} (software, clip 16:9 + vertical, rezumat comercial).`, why: `Așteaptă: ${pending.join(", ")}.`,
      ifAccept: "Fiecare decizie e separată: acceptarea software-ului nu aprobă clipul, iar aprobarea clipului nu publică nimic.",
      ifReject: "O poți lăsa așa sau o închizi; nimic nu se șterge.", effects: ["fișiere locale în folderul de exporturi; nimic publicat"], link: `/livrare/${d.id}` });
  }
  items.push(...salesOfferDecisions(hub, typeof hub.config?.now === "function" ? hub.config.now() : new Date()));
  // M13: a support reply / deviz waiting for the owner's approval of exactly its current text.
  items.push(...deskDecisions(hub));
  items.sort((a, b) => String(b.waitingSince || "").localeCompare(String(a.waitingSince || "")));
  return { items, total: items.length, note: "Doar citire: deciziile se iau din locul fiecăruia, în sesiunea ta de proprietar. Hub-ul nu acceptă nimic în locul tău." };
}
