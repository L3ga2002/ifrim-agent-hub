import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * Allowance tracking from provider-reported data only. Unknown stays unknown; allowances of
 * different providers are never added together, and one provider's per-app limit is not treated as
 * a separate pool.
 */
export function createUsage({ db, settings, clock }) {
  function record(provider, snapshot, route = "subscription") {
    if (!snapshot) return;
    db.prepare("INSERT INTO usage_snapshots (id, provider, route, source, data_json, captured_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("use"), provider, route, snapshot.source || "provider", json(snapshot), snapshot.capturedAt || clock().toISOString());
  }

  function latest(provider) {
    const row = db.prepare("SELECT * FROM usage_snapshots WHERE provider = ? ORDER BY captured_at DESC LIMIT 1").get(provider);
    return row ? { ...parse(row.data_json, {}), capturedAt: row.captured_at, source: row.source } : null;
  }

  /** Decides whether a turn may start/continue given the reserve kept for interactive work. */
  function admit(provider, snapshot) {
    if (!snapshot) return { ok: true, reason: "No usage data reported" };
    record(provider, snapshot);
    const reserve = settings.get("usageReservePercent");
    const ceiling = 100 - reserve;
    if (snapshot.ordinaryUsageAllowed === false) return { ok: false, reason: "Provider reports ordinary plan usage is not allowed right now" };
    if (snapshot.limitReached) return { ok: false, reason: `Provider limit reached (${snapshot.limitReachedType})` };
    if (snapshot.spendControlReached) return { ok: false, reason: "Provider spend control reached" };
    const credits = snapshot.creditsReported;
    if (credits?.unlimited || (credits?.hasCredits && Number(credits.balance) > 0)) return { ok: false, reason: "Account reports purchased credits that would be consumed past the plan allowance" };
    const worst = Math.max(0, ...(snapshot.windows || []).map((w) => Number(w.usedPercent) || 0));
    if (worst >= ceiling) return { ok: false, reason: `Usage ${worst}% reached the Hub ceiling ${ceiling}% (reserve ${reserve}% for interactive work)` };
    return { ok: true, reason: `Highest window ${worst}% below ceiling ${ceiling}%` };
  }

  function overview() {
    return ["codex", "claude"].map((provider) => {
      const snap = latest(provider);
      return { provider, snapshot: snap, known: Boolean(snap?.windows?.length),
        note: snap ? null : provider === "claude" ? "Claude Code does not expose plan usage through the CLI; unknown until a run reports limits." : "Run an account check to read Codex rate limits." };
    });
  }

  return { record, latest, admit, overview };
}
