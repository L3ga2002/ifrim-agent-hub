// M11 „Deciziile mele” — every result that waits for the owner, in one read-only list: what it is, why it waits, what accepting or
// rejecting (closing, keeping) does, and which files / effects it touches. It decides nothing and has no button of its own: each row
// links to the place where the existing owner-session command lives (the Software Factory's accept / reject, the Delivery Room's
// creative and summary decisions). Never a list of grants.
import { parse } from "../storage/db.mjs";

const lineOf = (c) => `${c.id}: ${String(c.status || "")}`;

export function decisionsInbox(hub) {
  const { db, factory, deliveries, projects } = hub;
  const items = [];
  for (const f of factory.list()) {
    const project = projects.get(f.projectId);
    const real = project?.source !== "hub-test";
    if (f.stage === "DELIVERY_READY") {
      const bundle = db.prepare("SELECT * FROM factory_bundles WHERE mission_id = ? AND status = 'READY_FOR_OWNER_ACCEPTANCE' ORDER BY created_at DESC LIMIT 1").get(f.missionId);
      if (!bundle) continue;
      const manifest = parse(bundle.manifest_json, {});
      const files = (manifest.changeSet?.files || []).map((x) => `${x.status === "added" ? "nou" : x.status === "deleted" ? "șters" : "modificat"}: ${x.path}`);
      const criteria = manifest.spec?.criteria || [];
      const passed = criteria.filter((c) => String(c.status).startsWith("PASS")).length;
      items.push({ kind: "software_bundle", id: bundle.id, missionId: f.missionId, projectId: f.projectId, projectName: project?.name || "?", real, title: f.title, waitingSince: bundle.created_at,
        what: `Pachet software verificat pe ${project?.name || "proiect"}${real ? " (proiect REAL)" : " (proiect de test)"}: „${f.title}”. ${passed} din ${criteria.length} criterii trecute.`,
        why: "Așteaptă acceptarea ta locală. Nimic nu e comis, urcat sau publicat.",
        ifAccept: "Pachetul devine acceptat (OWNER_ACCEPTED), preview-ul se oprește; fișierele rămân cum sunt acum în folderul proiectului. Commit, push sau deploy rămân acțiuni separate, cu aprobarea ta.",
        ifReject: "Pachetul devine respins, misiunea se închide; modificările rămân în folder (revenirea la bază nu se face automat; snapshot-ul de bază e păstrat în Hub).",
        effects: files.length ? files : ["fără fișiere modificate"], criteria: criteria.map(lineOf), link: `/missions/${f.missionId}` });
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
      items.push({ kind: 'delivery_correction', id: v.correction.plan.id, projectId: d.projectId, projectName: v.delivery.projectName, real: false, title: 'Corectură afirmații (clip + rezumat)', waitingSince: d.updatedAt, what: 'Corectură propusă de Hub pentru afirmațiile livrării.', why: proposed ? 'Așteaptă confirmarea ta.' : 'Corectura rulează.', ifAccept: 'Scrie versiuni noi; păstrează software-ul și istoricul.', ifReject: proposed ? 'Nimic nu pornește.' : 'Corectura rulează; o poți opri din locul deciziei.', effects: v.correction.defects.map(f => f.plain), link: '/livrare/' + d.id });
    }
    const pending = [];
    if (v.decisions.creativeMaster !== "APPROVED") pending.push("aprobarea creativă a clipului 16:9");
    if (v.decisions.creativeVertical !== "APPROVED") pending.push("aprobarea creativă a variantei verticale");
    if (v.decisions.summaryReady !== "READY") pending.push("rezumatul „gata de prezentare”");
    if (v.decisions.software !== "ACCEPTED") pending.push("acceptarea locală a software-ului");
    if (!pending.length) continue;
    items.push({ kind: "delivery", id: d.id, projectId: d.projectId, projectName: v.delivery.projectName, real: false, title: d.title, waitingSince: d.updatedAt,
      what: `Livrarea pregătită: ${d.title} (software, clip 16:9 + vertical, rezumat comercial).`, why: `Așteaptă: ${pending.join(", ")}.`,
      ifAccept: "Fiecare decizie e separată: acceptarea software-ului nu aprobă clipul, iar aprobarea clipului nu publică nimic.",
      ifReject: "O poți lăsa așa sau o închizi; nimic nu se șterge.", effects: ["fișiere locale în folderul de exporturi; nimic publicat"], link: `/livrare/${d.id}` });
  }
  items.sort((a, b) => String(b.waitingSince || "").localeCompare(String(a.waitingSince || "")));
  return { items, total: items.length, note: "Doar citire: deciziile se iau din locul fiecăruia, în sesiunea ta de proprietar. Hub-ul nu acceptă nimic în locul tău." };
}
