// M10.2 (U10) Content Studio planner — no model, nothing generated (owner decision 5: no generated plates, no media AI role in this
// milestone). Live on 2026-10-04 a promo request reached no planner, became a project_management mission on the Hub through the
// model and could never be planned. Here a studio_create request ("Fă un videoclip de promovare de 30 de secunde") gets exactly one of:
//
//  - BLOCKED STUDIO_NO_MATERIAL when the library has no material and no edit plan: the server's own explanation (blockers.mjs) with
//    the two real options (import from a folder the owner names; capture after MB1), and the request is KEPT (a work request) and
//    re-proposed once material arrives (an import finishing) — a proposal only, never a start;
//  - ONE operation plan built only from executors that already exist (media.tools.pin when the tools are unpinned, media.render =
//    render + automated QA, media.variant.render for a vertical request, media.export.local when asked) on the content project the
//    owner means (the one chosen; the one named — never replaced by another clip when the name does not resolve; the last one acted
//    on; or the only one with an edit plan); its card says "fără
//    model" and shows exactly what is rendered from what — the requested duration is never faked, creative review stays the owner's;
//  - ONE question (several clips) or an honest message (material but no edit plan: nothing is montaged from scratch here).
//
// Everything a step does is authorized again at run time by the ops plan engine (plans.mjs authorize); publishing, upload and live
// capture stay outside plans (NEVER_IN_PLANS, MEDIA_C, MB1); originals are never modified (renders and variants are new versions).
import { explain } from "../blockers.mjs";
import { matchRef } from "../intents.mjs";
import { platformKeyFor, studioRenderReadiness } from "../../ops/intent-actions.mjs";
import { redactText } from "../../security/redact.mjs";

/** Content stages whose clip is no longer edited (never a plan target). */
const CLOSED_STAGES = new Set(["ARCHIVED", "PUBLISHED", "ANALYTICS"]);
/** Library categories that are not source material (renders and their by-products are outputs, not something to edit from). */
const NOT_MATERIAL = ["render", "export", "proxy", "thumbnail"];
const VERTICAL_WORDS = /\b(vertical[ăa]?|verticale|9\s*[:x/ ]\s*16|tiktok|reels?|shorts)\b/i;
const EXPORT_WORDS = /\bexport(?:[ăa]|ati|ați|eaz[ăa]|ul|at)?\b/i;
export const STUDIO_PLAN_KIND = "studio.create";

const clip = (s, n = 80) => redactText(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, n);

/** Duration in seconds of an IR v1 edit (the end of its last video clip), or null. Pure. */
export function durationOfIr(ir) {
  const fps = ir?.fps?.num && ir?.fps?.den ? ir.fps.num / ir.fps.den : null;
  if (!fps) return null;
  let end = 0;
  for (const t of ir.tracks || []) if (t.kind === "video") for (const c of t.clips || []) end = Math.max(end, Number(c.start || 0) + Math.max(0, Number(c.sourceOut || 0) - Number(c.sourceIn || 0)));
  return end > 0 ? Math.round((end / fps) * 10) / 10 : null;
}

export function createContentPlanner(hub, { opsActions = null } = {}) {
  const count = (sql) => { try { return hub.db.prepare(sql).get()?.n ?? 0; } catch { return 0; } };

  /**
   * Verified media facts: source material (READY originals that are not renders / exports), edit plans, and — only when there is
   * material to render — the tools' state from a read-only inspection (nothing is pinned by a read).
   */
  async function mediaFacts({ inspectTools = true } = {}) {
    const assets = count(`SELECT COUNT(DISTINCT a.id) AS n FROM media_assets a JOIN media_asset_versions v ON v.asset_id = a.id
      WHERE v.status = 'READY' AND v.is_original = 1 AND a.category NOT IN (${NOT_MATERIAL.map((c) => `'${c}'`).join(",")})`);
    const editProjects = count("SELECT COUNT(*) AS n FROM media_edit_projects");
    let tools = null, identity = null, prepend = [];
    if (assets > 0 || editProjects > 0) {
      // #28/#30: the same readiness helper as the variant / correction / capture plans (one place decides pin step vs. blocker), and
      // the identity carries libsSha256 so the pin step checks the shared libraries the card showed.
      const r = await studioRenderReadiness(hub, { inspect: inspectTools });
      ({ tools, identity, prepend } = r);
    }
    return { assets, editProjects, tools, identity, prepend };
  }

  /**
   * The Studio explanation (server text, blockers.mjs): only what blocks a Studio plan. The execution gate, autonomy, isolation and
   * billing are about model runs and never block a local render plan; unpinned tools are not a blocker either — the pin is a step
   * of the same card (automatic readiness inside the one confirmation).
   */
  function explainStudio(m) {
    return explain({ intent: "studio", media: { assets: m.assets, editProjects: m.editProjects, tools: m.tools === "UNPINNED" ? null : m.tools } });
  }

  /** Content projects a plan can render: open stage, exactly one edit plan with a current version (else Studio decides). */
  function openProjects() {
    try { return (hub.media?.content?.listProjects({ limit: 200 }) || []).filter((p) => !CLOSED_STAGES.has(p.stage)); } catch { return []; }
  }
  function candidates() {
    const list = openProjects();
    const out = [];
    for (const p of list) {
      let m = null;
      try { m = opsActions?.masterOf ? opsActions.masterOf(p.id) : null; } catch { m = null; }
      if (!m || m.question) continue;
      // The edit's version list carries no IR; the duration is read from the version itself (never guessed).
      let ir = m.version?.ir || null;
      if (!ir) { try { ir = hub.media.edits.getVersion(m.version.id)?.ir || null; } catch { ir = null; } }
      out.push({ project: p, edit: m.edit, version: m.version, durationSec: durationOfIr(ir), updatedAt: p.updatedAt || p.createdAt || "" });
    }
    return out;
  }

  /**
   * planner(studio_create): { step, ctx, lastTarget?, prefer? } → { kind: blocked|ops|question|message, … }. `prefer: "newest"`
   * (a re-plan after an import) takes the most recently updated clip instead of asking — the one the import just created.
   */
  async function plan({ step, text = "", ctx = {}, lastTarget = null, prefer = null } = {}) {
    if (!hub.media || !hub.opsPlans) return { kind: "message", text: "Content Studio nu e disponibil pe acest Hub." };
    const m = await mediaFacts();
    const ex = explainStudio(m);
    if (ex.blocked) return { kind: "blocked", blocker: ex, workIntent: "studio", projectId: null };
    const usable = candidates();
    const args = step?.args || {};
    const newestFirst = (list) => [...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const ask = (list, lead = "Din ce clip pregătesc") => {
      const opts = newestFirst(list).slice(0, 4);
      return { kind: "question", question: `${lead}: ${opts.map((c) => `„${clip(c.project.title, 60)}”`).join(" sau ")}? Folosesc montajul lui existent (fără model).`,
        options: opts.map((c) => ({ id: c.project.id, label: clip(c.project.title, 60) })), forIntent: "studio_create" };
    };
    let pick = null;
    if (args.chosenId) {
      pick = usable.find((c) => c.project.id === args.chosenId) || null;
      if (!pick) return { kind: "message", text: "Clipul ales nu mai are un plan de montaj gata de randat; spune din nou ce vrei." };
    }
    // #29: a clip the owner NAMES („din Promo”, „despre lansare hub”) is a name reference. It is matched over ALL open content projects
    // (not only the renderable ones), and it never falls through to the last target, the newest clip or the only renderable one — that
    // silently planned a different clip than the one named. 0 matches → not found + ask; 1 match not renderable → the honest reason;
    // 2+ → ONE question among those matches only.
    const nameRef = !pick ? (args.clipRef || args.about || null) : null;
    if (nameRef) {
      const open = openProjects();
      const named = matchRef(nameRef, open, { name: (p) => p.title });
      if (!named.length) {
        if (!usable.length) return { kind: "message", navigate: "/studio", text: `Nu găsesc clipul „${clip(nameRef, 60)}” în Studio și niciun clip nu are încă un plan de montaj gata de randat. Spune-mi titlul exact sau creează planul de montaj în Studio.` };
        return ask(usable, `Nu găsesc clipul „${clip(nameRef, 60)}”. Din ce clip pregătesc`);
      }
      if (named.length === 1) {
        pick = usable.find((c) => c.project.id === named[0].id) || null;
        if (!pick) {
          let n = null;
          try { n = (hub.media.edits.list({ contentProjectId: named[0].id }) || []).length; } catch { n = null; }
          const why = n === 0 ? "nu are încă un plan de montaj (nu montez de la zero)." : n > 1 ? `are ${n} planuri de montaj; alege-l pe cel dorit în Studio și spune din nou.` : "planul lui de montaj nu are o versiune curentă.";
          return { kind: "message", navigate: `/studio/${named[0].id}`,
            text: `„${clip(named[0].title, 60)}” nu e gata de randat: ${why} Nu pregătesc alt clip în locul lui; îl deschid în Studio.` };
        }
      } else {
        const matched = named.slice(0, 4);
        return { kind: "question", question: `Care clip: ${matched.map((p) => `„${clip(p.title, 60)}”`).join(" sau ")}? Folosesc montajul lui existent (fără model).`,
          options: matched.map((p) => ({ id: p.id, label: clip(p.title, 60) })), forIntent: "studio_create" };
      }
    }
    if (!usable.length) {
      return { kind: "message", navigate: "/studio",
        text: "Am materiale în bibliotecă, dar niciun clip cu un singur plan de montaj gata de randat. În acest milestone nu montez de la zero și nu generez imagini: creează planul de montaj în Studio (sau importă un proiect Studio dintr-un folder) și îți pregătesc randarea cu o singură confirmare." };
    }
    // A purpose („de promovare”) or an audience („pentru clienți”) only narrows: one match is taken; several → the last target only
    // when it is among them, the newest of them after an import, otherwise ONE question among them; none → the ordinary fallbacks.
    let pool = usable;
    for (const soft of [args.forWhom, args.purpose].filter(Boolean)) {
      if (pick) break;
      const matches = matchRef(soft, pool, { name: (c) => c.project.title });
      if (matches.length === 1) pick = matches[0];
      else if (matches.length > 1) pool = matches;
    }
    if (!pick && lastTarget?.kind === "clip") pick = pool.find((c) => c.project.id === lastTarget.id) || null;
    if (!pick && prefer === "newest") pick = newestFirst(pool)[0];
    if (!pick && pool.length === 1) pick = pool[0];
    if (!pick) return ask(pool);

    const words = `${text || ""} ${step?.text || ""}`;
    const vertical = VERTICAL_WORDS.test(words);
    const platformKey = vertical ? platformKeyFor(words) : null;
    const steps = [];
    steps.push(...(m.prepend || []));
    if (vertical) steps.push({ kind: "media.variant.render", params: { masterVersionId: pick.version.id, platformKey } });
    else steps.push({ kind: "media.render", params: { editVersionId: pick.version.id, profile: "draft" } });
    let exportNote = "";
    if (EXPORT_WORDS.test(words)) {
      if (hub.media.exportsDir?.()) steps.push({ kind: "media.export.local", params: { assetVersionId: `$pas:${steps.length}.assetVersionId`, name: clip(pick.project.title, 60) } });
      else exportNote = " Exportul local cere întâi un folder de exporturi aprobat; îl fac după ce alegi folderul de import.";
    }
    const title = `Clip din „${clip(pick.project.title, 60)}”: ${vertical ? `varianta ${platformKey} (randare finală)` : "randare ciornă"} + QA automat`;
    const proposed = await hub.opsPlans.propose({ kind: STUDIO_PLAN_KIND, title, steps, actor: ctx.actor || "owner", via: ctx.channel || "owner" });
    const dur = pick.durationSec;
    const asked = Number(args.durationSec) || null;
    const durationNote = asked && dur && Math.abs(asked - dur) > 1
      ? ` Durata cerută (${asked} s) nu o impun: montajul are ~${dur} s; o schimbi cu o corectură („taie de la … la …”).` : "";
    const note = `${m.tools === "UNPINNED" ? "Întâi fixez ffmpeg/ffprobe (versiunea și sha256 arătate în card), ca pas al acestui plan. " : ""}`
      + `Folosesc montajul existent „${clip(pick.edit.title, 60)}” (v${pick.version.version}${dur ? `, ~${dur} s` : ""}) din „${clip(pick.project.title, 60)}”: ${vertical ? `varianta ${platformKey}, randare finală` : "randare ciornă"} și QA automat, fără model. `
      + `Nu generez material nou.${durationNote}${exportNote} Revizuirea creativă rămâne a ta; nimic nu se publică. O singură confirmare.`;
    return { kind: "ops", plan: proposed, note, contentProjectId: pick.project.id };
  }

  /** The explanation a preserved Studio request is re-checked with (work requests' explainer for intent "studio"). */
  async function explainRequest() { return explainStudio(await mediaFacts({ inspectTools: false })); }

  /**
   * lega.studio_overview data (U08): bounded counts and the newest items, titles redacted and truncated, no paths, no file contents,
   * no model. Never spawns a tool (the tools' state is the last inspection, if any).
   */
  function overview() {
    const db = hub.db;
    const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || null; } catch { return null; } };
    const contentProjects = count("SELECT COUNT(*) AS n FROM content_projects WHERE stage <> 'ARCHIVED'");
    const editProjects = count("SELECT COUNT(*) AS n FROM media_edit_projects");
    const rendersDone = count("SELECT COUNT(*) AS n FROM media_render_jobs WHERE status = 'DONE'");
    const rendersActive = count("SELECT COUNT(*) AS n FROM media_render_jobs WHERE status IN ('REQUESTED','CLAIMED','RUNNING','VALIDATING')");
    const assets = count(`SELECT COUNT(DISTINCT a.id) AS n FROM media_assets a JOIN media_asset_versions v ON v.asset_id = a.id
      WHERE v.status = 'READY' AND v.is_original = 1 AND a.category NOT IN (${NOT_MATERIAL.map((c) => `'${c}'`).join(",")})`);
    const r = one(`SELECT j.id, j.profile, j.finished_at, j.created_at, ep.title AS edit_title, ep.content_project_id, cp.title AS project_title
      FROM media_render_jobs j JOIN media_edit_versions v ON v.id = j.edit_version_id JOIN media_edit_projects ep ON ep.id = v.edit_project_id
      LEFT JOIN content_projects cp ON cp.id = ep.content_project_id WHERE j.status = 'DONE' ORDER BY COALESCE(j.finished_at, j.created_at) DESC LIMIT 1`);
    const c = one("SELECT id, title, stage, updated_at FROM content_projects WHERE stage <> 'ARCHIVED' ORDER BY updated_at DESC LIMIT 1");
    let tools = null;
    try { const t = hub.media?.tools?.lastResolved?.(); tools = t?.states ? { ...t.states } : null; } catch { tools = null; }
    let plans = [];
    try { plans = (hub.opsPlans?.list?.({}) || []).filter((p) => /^studio\./.test(p.kind) && ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"].includes(p.status)).slice(0, 5).map((p) => ({ id: p.id, kind: p.kind, status: p.status, title: clip(p.title, 80) })); } catch { plans = []; }
    return {
      counts: { contentProjects, editProjects, rendersDone, rendersActive, assets },
      latestRender: r ? { jobId: r.id, profile: r.profile, at: r.finished_at || r.created_at, edit: clip(r.edit_title, 80), contentProjectId: r.content_project_id || null, clip: r.project_title ? clip(r.project_title, 80) : null } : null,
      latestClip: c ? { id: c.id, title: clip(c.title, 80), stage: c.stage, updatedAt: c.updated_at } : null,
      tools, plans,
      empty: assets === 0 && editProjects === 0,
      note: "Fără model: Studio montează, randează și verifică local; nu generez material și nu public nimic.",
    };
  }

  return { plan, explainRequest, overview, mediaFacts, candidates };
}
