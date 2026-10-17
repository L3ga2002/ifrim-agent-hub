import { HubError } from "../core/errors.mjs";
import { newId, nowIso } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * M09 Campaigns and the Content → Sales link.
 * - Campaigns are plans (objective, audience, calendar, approved budget record, CTA); nothing here spends or sends.
 * - linkOpportunity goes through the Sales service: `sales.getOpportunity` validates, `sales.addEvidence` records the link on the
 *   opportunity. This module never writes `sales_*` tables.
 * - Funnel events default to UNATTRIBUTED; any other attribution needs evidence. Revenue is recorded only manually or by
 *   import, with an explicitly declared attribution, an amount and a currency. Rates are computed only over measured
 *   denominators; fixture events are labelled and kept out of real totals.
 * - There is deliberately no DM / comment / outreach function.
 */

export const CAMPAIGN_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]);
const CAMPAIGN_TRANSITIONS = Object.freeze({ DRAFT: ["ACTIVE", "CLOSED"], ACTIVE: ["PAUSED", "CLOSED"], PAUSED: ["ACTIVE", "CLOSED"], CLOSED: [] });
export const FUNNEL_KINDS = Object.freeze(["click", "lead", "proposal", "contract", "revenue_received"]);
export const ATTRIBUTIONS = Object.freeze(["DIRECT_TRACKED_LINK", "SELF_REPORTED", "UNATTRIBUTED"]);
export const FUNNEL_SOURCES = Object.freeze(["manual", "import", "fixture"]);
const AMOUNT_KINDS = new Set(["proposal", "contract", "revenue_received"]);
const FIXTURE_LABEL = "DATE DE TEST (fixture)";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (v) => String(v ?? "").replace(CONTROL, "").trim();
const clip = (v, max) => { const s = clean(v); return s.length > max ? s.slice(0, max) : s; };
const bad = (message, code = "VALIDATION") => new HubError("validation", message, { code });
const conflict = (message, code = "CONFLICT") => new HubError("conflict", message, { code });
const normalizeRo = (text) => String(text ?? "").replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț");

export function createCampaigns({ db, bus, clock = () => new Date(), sales = null }) {
  const now = () => nowIso(clock);
  const emit = (type, scopeId, payload, source = "campaigns") => bus.append({ type, scopeType: "content", scopeId, source, payload });
  const rowToCampaign = (r) => r && ({ id: r.id, name: r.name, objective: r.objective, audience: r.audience, theme: r.theme, calendar: parse(r.calendar_json, []),
    budget: parse(r.budget_json, { approved: 0, currency: "EUR" }), cta: parse(r.cta_json, {}), status: r.status, createdBy: r.created_by, createdAt: r.created_at,
    updatedAt: r.updated_at, version: r.version });
  const rowToFunnel = (r) => r && ({ id: r.id, contentProjectId: r.content_project_id, releaseAttemptId: r.release_attempt_id, opportunityId: r.opportunity_id, kind: r.kind,
    attribution: r.attribution, amount: r.amount, currency: r.currency, source: r.source, evidence: parse(r.evidence_json, []), occurredAt: r.occurred_at,
    fixture: r.source === "fixture", label: r.source === "fixture" ? FIXTURE_LABEL : null, createdBy: r.created_by, createdAt: r.created_at });
  const getCampaign = (id) => rowToCampaign(db.prepare("SELECT * FROM content_campaigns WHERE id = ?").get(id));
  const needCampaign = (id) => { const c = getCampaign(id); if (!c) throw new HubError("not_found", "Campania nu există"); return c; };
  const needProject = (id) => {
    const p = db.prepare("SELECT id, title, stage, opportunity_id, campaign_id FROM content_projects WHERE id = ?").get(id);
    if (!p) throw new HubError("not_found", "Proiectul de conținut nu există");
    return p;
  };
  const needSales = () => {
    if (!sales || typeof sales.getOpportunity !== "function" || typeof sales.addEvidence !== "function") throw new HubError("internal", "Serviciul Sales nu e disponibil pentru legătura cu oportunitățile");
    return sales;
  };
  /** Through the Sales service only (throws not_found for an unknown opportunity). */
  const opportunityOf = (opportunityId) => {
    const view = needSales().getOpportunity(opportunityId);
    const opp = view?.opportunity || view;
    if (!opp?.id) throw new HubError("not_found", "Oportunitatea nu există");
    return { opp, org: view?.org || null };
  };

  function campaignFields(input, partial) {
    const out = {};
    if (!partial || input.name !== undefined) {
      const name = normalizeRo(clip(input.name, 120));
      if (name.length < 3) throw bad("Numele campaniei: minimum 3 caractere");
      out.name = name;
    }
    for (const [k, max] of [["objective", 1000], ["audience", 500], ["theme", 300]]) if (!partial || input[k] !== undefined) out[k] = normalizeRo(clip(input[k] ?? "", max));
    if (!partial || input.calendar !== undefined) {
      const cal = input.calendar ?? [];
      if (!Array.isArray(cal) || cal.length > 200) throw bad("Calendarul trebuie să fie o listă (maximum 200 de intrări)");
      out.calendar = cal.map((e, i) => {
        const date = clean(e?.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw bad(`Calendar, intrarea ${i + 1}: data trebuie să fie AAAA-LL-ZZ`);
        const contentProjectId = e.contentProjectId ? clean(e.contentProjectId) : null;
        if (contentProjectId) needProject(contentProjectId);
        return { date, contentProjectId, platform: e.platform ? clip(e.platform, 20) : null, note: normalizeRo(clip(e.note, 200)) };
      }).sort((a, b) => a.date.localeCompare(b.date));
    }
    if (!partial || input.budget !== undefined) {
      const b = input.budget ?? { approved: 0, currency: "EUR" };
      const approved = Number(b.approved ?? 0);
      if (!Number.isFinite(approved) || approved < 0 || approved > 1e9) throw bad("Bugetul aprobat trebuie să fie un număr ≥ 0");
      const currency = clean(b.currency || "EUR").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad("Moneda trebuie să fie un cod de 3 litere (ex. EUR, RON)");
      out.budget = { approved, currency, note: "Buget înregistrat de proprietar; Hub-ul nu cheltuie nimic." };
    }
    if (!partial || input.cta !== undefined) {
      const c = input.cta ?? {};
      let url = null;
      if (c.url) {
        try { const u = new URL(String(c.url)); if (u.protocol !== "https:") throw new Error("https"); url = u.toString().slice(0, 500); } catch { throw bad("Linkul CTA trebuie să fie un URL https valid"); }
      }
      out.cta = { text: normalizeRo(clip(c.text, 200)), url };
    }
    return out;
  }

  /** Create (no id) or update a campaign; status changes follow DRAFT → ACTIVE ⇄ PAUSED → CLOSED. */
  function saveCampaign(input = {}, actor = "owner") {
    if (!input.id) {
      const f = campaignFields(input, false);
      if (input.status && input.status !== "DRAFT") throw bad("O campanie nouă începe în DRAFT");
      return bus.transaction(() => {
        const id = newId("ccp");
        const at = now();
        db.prepare(`INSERT INTO content_campaigns (id, name, objective, audience, theme, calendar_json, budget_json, cta_json, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`).run(id, f.name, f.objective, f.audience, f.theme, json(f.calendar), json(f.budget), json(f.cta), actor, at, at);
        emit("content.campaign.saved", id, { created: true }, actor);
        return getCampaign(id);
      });
    }
    const cur = needCampaign(input.id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== cur.version) throw conflict("Campania a fost modificată între timp; reîncarcă", "STALE_VERSION");
    if (cur.status === "CLOSED") throw conflict("Campania e închisă și nu se mai modifică");
    const f = campaignFields(input, true);
    let status = cur.status;
    if (input.status && input.status !== cur.status) {
      if (!CAMPAIGN_STATUSES.includes(input.status)) throw bad(`Stare de campanie necunoscută: ${input.status}`);
      if (!CAMPAIGN_TRANSITIONS[cur.status].includes(input.status)) throw conflict(`Tranziție nepermisă: ${cur.status} → ${input.status}`);
      status = input.status;
    }
    const cols = { name: "name", objective: "objective", audience: "audience", theme: "theme", calendar: "calendar_json", budget: "budget_json", cta: "cta_json" };
    const entries = Object.entries(f);
    return bus.transaction(() => {
      const res = db.prepare(`UPDATE content_campaigns SET ${entries.map(([k]) => `${cols[k]} = ?, `).join("")}status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
        .run(...entries.map(([k, v]) => (["calendar", "budget", "cta"].includes(k) ? json(v) : v)), status, now(), cur.id, cur.version);
      if (!res.changes) throw conflict("Campania a fost modificată între timp; reîncarcă", "STALE_VERSION");
      emit("content.campaign.saved", cur.id, { fields: entries.map(([k]) => k), from: cur.status, to: status }, actor);
      return getCampaign(cur.id);
    });
  }

  function attachProject({ campaignId, contentProjectId, actor = "owner" } = {}) {
    const c = needCampaign(campaignId);
    if (c.status === "CLOSED") throw conflict("Campania e închisă");
    const p = needProject(contentProjectId);
    if (p.campaign_id === campaignId) return { campaignId, contentProjectId, already: true };
    return bus.transaction(() => {
      db.prepare("UPDATE content_projects SET campaign_id = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(campaignId, now(), contentProjectId);
      emit("content.campaign.project_attached", campaignId, { contentProjectId, previous: p.campaign_id }, actor);
      return { campaignId, contentProjectId, already: false };
    });
  }

  /**
   * Content → Sales: validated by sales.getOpportunity, evidenced by sales.addEvidence (label USER_PROVIDED, manual source
   * `content:<id>`). Re-linking to another opportunity needs `replace: true`.
   */
  function linkOpportunity({ contentProjectId, opportunityId, actor = "owner", note = "", replace = false } = {}) {
    const p = needProject(contentProjectId);
    const { opp } = opportunityOf(opportunityId);
    if (p.opportunity_id === opp.id) return { contentProjectId, opportunityId: opp.id, already: true };
    if (p.opportunity_id && !replace) throw conflict(`Proiectul e deja legat de oportunitatea ${p.opportunity_id}; confirmă înlocuirea`, "ALREADY_LINKED");
    return bus.transaction(() => {
      const evidence = needSales().addEvidence("opportunity", opp.id, {
        claim: `Conținut asociat: ${clip(p.title, 200)}`, label: "USER_PROVIDED", sourceKind: "manual", sourceRef: `content:${p.id}`,
        excerpt: normalizeRo(clip(note, 300)), method: "legătură Content → Sales înregistrată în Hub",
      }, actor);
      db.prepare("UPDATE content_projects SET opportunity_id = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(opp.id, now(), p.id);
      emit("content.opportunity.linked", p.id, { opportunityId: opp.id, previous: p.opportunity_id, evidenceId: evidence?.id || null }, actor);
      return { contentProjectId: p.id, opportunityId: opp.id, evidenceId: evidence?.id || null, already: false };
    });
  }

  function normalizeEvidence(list) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 10) throw bad("Dovezile trebuie să fie o listă (maximum 10)");
    return list.map((e, i) => {
      const kind = clean(e?.kind); const ref = clean(e?.ref);
      if (!["tracked_link", "utm", "client_statement", "invoice", "contract", "crm_note", "document", "import_row"].includes(kind)) throw bad(`Dovada ${i + 1}: tip necunoscut „${kind}”`);
      if (!ref || ref.length > 300) throw bad(`Dovada ${i + 1}: referința lipsește sau e prea lungă`);
      return { kind, ref, note: normalizeRo(clip(e.note, 200)) };
    });
  }

  /** One funnel event. `attribution` defaults to UNATTRIBUTED, but revenue must declare it explicitly. */
  function recordFunnelEvent({ kind, contentProjectId = null, releaseAttemptId = null, opportunityId = null, attribution, amount = null, currency = null, source, evidence = [], occurredAt = null, actor = "owner" } = {}) {
    if (!FUNNEL_KINDS.includes(kind)) throw bad(`Tip de eveniment necunoscut: ${kind}`);
    if (!FUNNEL_SOURCES.includes(source)) throw bad(`Sursa evenimentului trebuie declarată: ${FUNNEL_SOURCES.join(", ")} (niciun eveniment nu se creează automat)`);
    const attr = attribution === undefined ? "UNATTRIBUTED" : attribution;
    if (!ATTRIBUTIONS.includes(attr)) throw bad(`Atribuire necunoscută: ${attr}`);
    const ev = normalizeEvidence(evidence);
    if (attr !== "UNATTRIBUTED" && !ev.length) throw bad(`Atribuirea ${attr} are nevoie de o dovadă (link urmărit, declarația clientului etc.)`, "ATTRIBUTION_NEEDS_EVIDENCE");
    if (attr === "DIRECT_TRACKED_LINK" && !ev.some((e) => e.kind === "tracked_link" || e.kind === "utm")) throw bad("DIRECT_TRACKED_LINK cere dovada unui link urmărit (tracked_link sau utm)", "ATTRIBUTION_NEEDS_EVIDENCE");
    if (kind === "revenue_received") {
      if (source === "fixture") throw bad("Încasările nu se înregistrează din date de test", "REVENUE_SOURCE");
      if (attribution === undefined) throw bad("O încasare cere atribuirea declarată explicit (inclusiv UNATTRIBUTED, dacă nu se știe)", "REVENUE_ATTRIBUTION_REQUIRED");
      if (!(typeof amount === "number" && Number.isFinite(amount) && amount > 0)) throw bad("Încasarea cere o sumă pozitivă");
    }
    if (amount !== null && amount !== undefined) {
      if (!AMOUNT_KINDS.has(kind)) throw bad(`Evenimentul ${kind} nu are sumă`);
      if (!(typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= 1e10)) throw bad("Suma trebuie să fie un număr ≥ 0");
      if (!/^[A-Z]{3}$/.test(clean(currency).toUpperCase())) throw bad("Suma cere moneda (cod de 3 litere)");
    }
    let projectId = contentProjectId;
    if (releaseAttemptId) {
      const a = db.prepare("SELECT m.content_project_id FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id WHERE a.id = ?").get(releaseAttemptId);
      if (!a) throw new HubError("not_found", "Încercarea de publicare nu există");
      if (projectId && projectId !== a.content_project_id) throw bad("Încercarea aparține altui proiect de conținut");
      projectId = a.content_project_id;
    }
    if (projectId) needProject(projectId);
    let oppId = null;
    if (opportunityId) oppId = opportunityOf(opportunityId).opp.id;
    if (!projectId && !oppId) throw bad("Evenimentul trebuie legat de un proiect de conținut, o publicare sau o oportunitate");
    const at = occurredAt ? new Date(occurredAt) : clock();
    if (!Number.isFinite(at.getTime())) throw bad("Momentul evenimentului nu e valid");
    if (at.getTime() > clock().getTime() + 5 * 60000) throw bad("Momentul evenimentului e în viitor");
    return bus.transaction(() => {
      const id = newId("cfe");
      db.prepare(`INSERT INTO content_funnel_events (id, content_project_id, release_attempt_id, opportunity_id, kind, attribution, amount, currency, source, evidence_json, occurred_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId || null, releaseAttemptId || null, oppId, kind, attr,
        amount === null || amount === undefined ? null : amount, amount === null || amount === undefined ? null : clean(currency).toUpperCase(), source, json(ev), at.toISOString(), actor, now());
      emit("content.funnel.recorded", projectId || oppId, { eventId: id, kind, attribution: attr, source, opportunityId: oppId }, actor);
      return rowToFunnel(db.prepare("SELECT * FROM content_funnel_events WHERE id = ?").get(id));
    });
  }

  /** Counts per kind and attribution; a rate only when its denominator was measured (> 0 real events). */
  function funnel(contentProjectId) {
    needProject(contentProjectId);
    const rows = db.prepare("SELECT * FROM content_funnel_events WHERE content_project_id = ? ORDER BY occurred_at").all(contentProjectId).map(rowToFunnel);
    const real = rows.filter((r) => !r.fixture);
    const count = (list, kind) => list.filter((r) => r.kind === kind).length;
    const counts = Object.fromEntries(FUNNEL_KINDS.map((k) => [k, count(real, k)]));
    const byAttribution = Object.fromEntries(ATTRIBUTIONS.map((a) => [a, Object.fromEntries(FUNNEL_KINDS.map((k) => [k, real.filter((r) => r.attribution === a && r.kind === k).length]))]));
    const rate = (num, den) => (counts[den] > 0
      ? { value: counts[num] / counts[den], numerator: counts[num], denominator: counts[den], basis: `${num}/${den}` }
      : { value: null, numerator: counts[num], denominator: null, basis: `${num}/${den}`, reason: `Numitorul (${den}) nu e măsurat` });
    const revenue = {};
    for (const r of real.filter((x) => x.kind === "revenue_received")) {
      revenue[r.currency] ||= { total: 0, byAttribution: Object.fromEntries(ATTRIBUTIONS.map((a) => [a, 0])) };
      revenue[r.currency].total += r.amount;
      revenue[r.currency].byAttribution[r.attribution] += r.amount;
    }
    return {
      contentProjectId, counts, byAttribution,
      rates: { leadPerClick: rate("lead", "click"), proposalPerLead: rate("proposal", "lead"), contractPerProposal: rate("contract", "proposal") },
      revenue, fixtureEvents: rows.length - real.length,
      note: "Fără atribuire inventată: evenimentele fără dovadă rămân UNATTRIBUTED; încasările sunt doar cele înregistrate manual sau importate; ratele apar doar cu numitor măsurat.",
    };
  }

  return {
    saveCampaign, getCampaign: needCampaign, attachProject, linkOpportunity, recordFunnelEvent, funnel,
    listCampaigns: ({ status = null } = {}) => {
      if (status && !CAMPAIGN_STATUSES.includes(status)) throw bad(`Stare de campanie necunoscută: ${status}`);
      return (status ? db.prepare("SELECT * FROM content_campaigns WHERE status = ? ORDER BY updated_at DESC").all(status) : db.prepare("SELECT * FROM content_campaigns ORDER BY updated_at DESC LIMIT 200").all()).map(rowToCampaign);
    },
    listFunnelEvents: ({ contentProjectId = null, opportunityId = null } = {}) => {
      if (!contentProjectId && !opportunityId) throw bad("Indică un proiect de conținut sau o oportunitate");
      return (contentProjectId ? db.prepare("SELECT * FROM content_funnel_events WHERE content_project_id = ? ORDER BY occurred_at DESC").all(contentProjectId)
        : db.prepare("SELECT * FROM content_funnel_events WHERE opportunity_id = ? ORDER BY occurred_at DESC").all(opportunityId)).map(rowToFunnel);
    },
  };
}
