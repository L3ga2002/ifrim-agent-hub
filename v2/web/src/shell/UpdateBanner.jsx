import { useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction } from "../store.js";
import { withReauth } from "../lib/ownerSession.js";

/**
 * 2.20 — „Actualizare disponibilă”: shown only when the Hub found a newer RELEASED version (tag hub-release/*), or while / after an
 * update ran. Installing asks for the owner session (Windows Hello); the Hub then restarts on its own and the page reloads.
 */
const STATUS_RO = { running: "rulează", done: "instalată", rolled_back: "a eșuat și Hub-ul a revenit la versiunea anterioară", refused: "refuzată (nimic nu s-a schimbat)", failed: "a eșuat; revenirea nu s-a încheiat — vezi jurnalul", rolling_back: "revine la versiunea anterioară" };

export function UpdateBanner() {
  const res = useResource("/api/updates", { reloadOn: (e) => e.type.startsWith("update.") || (e.type === "settings.changed" && e.payload?.key === "updateCheck") });
  const [hidden, setHidden] = useState(null);
  const check = useAction(async () => { await api("/api/updates/check", { method: "POST", body: {} }); res.reload(); });
  const apply = useAction(async (version) => { await withReauth(() => api("/api/owner/updates/apply", { method: "POST", body: { version } })); res.reload(); });
  const d = res.data;
  if (!d) return null;
  const last = d.apply;
  const recent = last && last.finishedAt && Date.now() - Date.parse(last.finishedAt) < 3 * 24 * 3600 * 1000;
  const showApply = Boolean(last) && (["running", "rolling_back"].includes(last.status) || recent);
  if (!d.available && !showApply) return null;
  const key = `${d.latest?.version || ""}:${last?.id || ""}:${last?.status || ""}`;
  if (hidden === key) return null;
  return (
    <div className="notice info" role="status" style={{ margin: "8px 16px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-lega-target="update">
      <Download size={16} aria-hidden="true" />
      {d.available && (!last || !["running", "rolling_back"].includes(last.status)) ? (
        <>
          <span><strong>Actualizare disponibilă:</strong> {d.latest.version} (acum rulează {d.current}). Hub-ul face backup, instalează, repornește și revine singur dacă ceva nu merge.</span>
          <button className="btn sm primary" disabled={apply.pending} onClick={() => apply.run(d.latest.version)}>{apply.pending ? "Pornesc…" : "Actualizează acum"}</button>
          <button className="btn sm ghost" disabled={check.pending} onClick={check.run} title="Citește din nou versiunile publicate"><RefreshCw size={14} /></button>
        </>
      ) : (
        <span><strong>Actualizarea {last?.to?.version || ""}</strong> {STATUS_RO[last?.status] || last?.status}{last?.finishedAt ? ` · ${fmt.dateTime(last.finishedAt)}` : ""}{last?.error && last.status !== "done" ? ` · ${last.error}` : ""}</span>
      )}
      {(apply.error || check.error) && <span className="muted small">{String((apply.error || check.error).message || apply.error || check.error)}</span>}
      <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setHidden(key)} aria-label="Ascunde mesajul de actualizare"><X size={14} /></button>
    </div>
  );
}
