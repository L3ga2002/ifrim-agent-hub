import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

export const LEAD_STATUSES = Object.freeze(["new", "researching", "qualified", "not_a_fit", "contacted_manually", "archived"]);

export function normalizeDomain(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  try { return new URL(text.includes("://") ? text : `https://${text}`).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function leadKey(company, domain) {
  const d = normalizeDomain(domain);
  if (d) return `d:${d}`;
  return `c:${String(company).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(s\.?r\.?l|s\.?a|pfa|ii|srl|sa)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/**
 * Lead registry: import with deduplication and statuses. Facts about a lead are only stored as
 * evidence entries with a source and date; nothing is inferred or invented. Nothing is ever sent.
 */
export function createLeads({ db, bus, clock }) {
  const rowTo = (row) => row && ({ id: row.id, company: row.company, domain: row.domain, status: row.status, source: row.source, notes: row.notes,
    evidence: parse(row.evidence_json, []), demo: Boolean(row.demo), createdAt: row.created_at, updatedAt: row.updated_at });

  /** Accepts lines "Company; domain" or "Company, domain". Returns created and duplicates. */
  function importText(text, { source = "manual-import", demo = false } = {}) {
    const created = [];
    const duplicates = [];
    const rejected = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const [company, domain = ""] = line.split(/[;,\t]/).map((s) => s.trim());
      if (!company || company.length > 200) { rejected.push(line.slice(0, 80)); continue; }
      const key = leadKey(company, domain);
      const existing = db.prepare("SELECT * FROM leads WHERE normalized_key = ?").get(key);
      if (existing) { duplicates.push({ company, existingId: existing.id }); continue; }
      const id = newId("lead");
      const now = clock().toISOString();
      db.prepare("INSERT INTO leads (id, company, domain, normalized_key, status, source, demo, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)")
        .run(id, company, normalizeDomain(domain), key, source, demo ? 1 : 0, now, now);
      created.push(id);
    }
    if (created.length) bus.append({ type: "leads.imported", scopeType: "leads", scopeId: "registry", source, payload: { created: created.length, duplicates: duplicates.length } });
    return { created: created.length, duplicates, rejected };
  }

  function addEvidence(id, { claim, sourceUrl, observedAt }) {
    const lead = get(id);
    if (!lead) throw new HubError("not_found", "Lead not found");
    if (!claim?.trim() || !/^https?:\/\//.test(sourceUrl || "") || !observedAt) throw new HubError("validation", "Evidence needs a claim, an http(s) source URL and the observation date");
    const evidence = [...lead.evidence, { claim: claim.trim().slice(0, 500), sourceUrl, observedAt, addedAt: clock().toISOString() }];
    db.prepare("UPDATE leads SET evidence_json = ?, updated_at = ? WHERE id = ?").run(json(evidence), clock().toISOString(), id);
    return get(id);
  }

  function setStatus(id, status, notes = null) {
    if (!LEAD_STATUSES.includes(status)) throw new HubError("validation", "Unknown lead status");
    db.prepare("UPDATE leads SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?").run(status, notes, clock().toISOString(), id);
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM leads WHERE id = ?").get(id));
  const list = () => db.prepare("SELECT * FROM leads ORDER BY updated_at DESC LIMIT 500").all().map(rowTo);
  return { importText, addEvidence, setStatus, get, list };
}
