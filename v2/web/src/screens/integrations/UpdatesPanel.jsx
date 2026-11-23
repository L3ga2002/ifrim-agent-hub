import { Download, RefreshCw } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction } from "../../store.js";
import { Panel, Chip, ErrorNotice } from "../../components/ui.jsx";

/** 2.20 — the installed version and the update channel (released tags only); the install button lives in the top banner. */
export default function UpdatesPanel() {
  const res = useResource("/api/updates", { reloadOn: (e) => e.type.startsWith("update.") || (e.type === "settings.changed" && e.payload?.key === "updateCheck") });
  const check = useAction(async () => { await api("/api/updates/check", { method: "POST", body: {} }); res.reload(); });
  const d = res.data;
  return (
    <Panel title="Versiune și actualizări" icon={Download} actions={d ? <Chip tone={d.available ? "warn" : d.last?.ok === false ? "error" : "ok"}>{d.available ? `disponibilă ${d.latest.version}` : d.last?.ok === false ? "verificare eșuată" : "la zi"}</Chip> : null}>
      {d && (
        <div className="stack">
          <dl className="kv">
            <dt>Instalată</dt><dd className="mono">{d.current}</dd>
            <dt>Ultima publicată</dt><dd className="mono">{d.latest?.version || "—"}</dd>
            <dt>Ultima verificare</dt><dd>{d.last?.checkedAt ? `${fmt.dateTime(d.last.checkedAt)}${d.last.ok === false ? ` · ${d.last.error}` : ""}` : "încă nu"}</dd>
            {d.apply && <><dt>Ultima actualizare</dt><dd>{d.apply.to?.version} · {d.apply.status}{d.apply.error ? ` · ${d.apply.error}` : ""}</dd></>}
          </dl>
          <p className="faint small" style={{ margin: 0 }}>Hub-ul primește doar versiunile publicate (tag-uri {d.channel}), verifică zilnic și instalează numai când apeși „Actualizează acum” în bara de sus.</p>
          <div className="row"><button className="btn sm" disabled={check.pending} onClick={check.run}><RefreshCw size={14} />{check.pending ? "Verific…" : "Verifică acum"}</button></div>
        </div>
      )}
      <ErrorNotice error={res.error || check.error} />
    </Panel>
  );
}
