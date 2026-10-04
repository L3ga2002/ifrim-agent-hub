import { useRef, useState } from "react";
import { FolderInput, UploadCloud, Search, FileVideo, Scale, Captions, Undo2 } from "lucide-react";
import { apiRaw, fmt } from "../../api.js";
import { pushToast } from "../../store.js";
import { Panel, ErrorNotice, Empty, Chip, Notice, Loading } from "../../components/ui.jsx";
import { fmtSeconds } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy, Hash } from "./common.jsx";
import { Player } from "./Player.jsx";

const CATEGORIES = ["raw", "screen_recording", "b_roll", "music", "sfx", "voice", "generated", "brand", "thumbnail", "caption"];
const ORIGINS = [["UNKNOWN", "necunoscută (nu se poate exporta final)"], ["OWNED", "proprie"], ["LICENSED", "licențiată"], ["CLIENT_PROVIDED", "de la client"], ["AI_GENERATED", "generată cu AI"]];
const LABELS = ["NOT_APPLICABLE", "ORIGINAL_RECORDING", "REPLAY", "RECONSTRUCTION", "SIMULATION", "GENERATED"];
const RIGHT_PLATFORMS = ["*", "instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "website"];
const RIGHT_USES = ["*", "organic", "paid", "case_study", "portfolio", "internal"];
const SOURCE_LABEL = { transcript: "transcriere", marker: "marker", metadata: "metadate" };
const TX_TERMINAL = ["final", "failed", "timeout", "cancelled", "interrupted"];
const TX_LABEL = { queued: "în coadă", running: "rulează", final: "gata", failed: "eșuată", timeout: "timp depășit", cancelled: "oprită", interrupted: "întreruptă" };

/** Shared context fields for an import (path or upload). */
function ImportFields({ form, set }) {
  return (
    <div className="studio-form">
      <label className="field"><span>Titlu</span><input className="input" maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
      <label className="field"><span>Categorie</span><select className="select" value={form.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label className="field"><span>Origine (drepturi)</span><select className="select" value={form.origin} onChange={(e) => set("origin", e.target.value)}>{ORIGINS.map(([v, l]) => <option key={v} value={v}>{v} — {l}</option>)}</select></label>
      <label className="field"><span>Etichetă de captură</span><select className="select" value={form.captureLabel} onChange={(e) => set("captureLabel", e.target.value)}>{LABELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
    </div>
  );
}

function Importer({ status, contentProjectId }) {
  const [form, setForm] = useState({ sourcePath: "", title: "", category: "raw", origin: "UNKNOWN", captureLabel: "NOT_APPLICABLE" });
  const [drag, setDrag] = useState(false);
  const [uploads, setUploads] = useState([]);
  const file = useRef(null);
  const b = useBusy();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const roots = status?.importRoots || [];
  const importPath = (e) => {
    e.preventDefault();
    b.run("path", async () => {
      const out = await studioPost("/api/media/assets/import", { sourcePath: form.sourcePath.trim(), title: form.title.trim(), category: form.category, origin: form.origin,
        captureLabel: form.captureLabel, ...(contentProjectId ? { contentProjectId } : {}) }, { toast: "Fișier importat în bibliotecă (originalul rămâne neschimbat)" });
      if (out?.duplicateOf) pushToast("studio-dup", "ok", "Același conținut exista deja: fișierul a fost refolosit, cu context propriu");
      set("sourcePath", "");
    });
  };
  const upload = async (files) => {
    for (const f of [...files].slice(0, 10)) {
      const params = new URLSearchParams({ filename: f.name, title: form.title.trim() || f.name, category: form.category, origin: form.origin, captureLabel: form.captureLabel });
      if (contentProjectId) params.set("contentProjectId", contentProjectId);
      setUploads((u) => [{ name: f.name, size: f.size, state: "se încarcă" }, ...u].slice(0, 10));
      try {
        const out = await apiRaw(`/api/media/upload?${params}`, f);
        setUploads((u) => u.map((x) => (x.name === f.name && x.state === "se încarcă" ? { ...x, state: out?.version?.status === "QUARANTINED" ? "în carantină (nu se poate decoda)" : "importat" } : x)));
      } catch (error) {
        setUploads((u) => u.map((x) => (x.name === f.name && x.state === "se încarcă" ? { ...x, state: `refuzat: ${error.message}` } : x)));
      }
    }
  };
  return (
    <Panel title="Import" icon={FolderInput} id="studio-import">
      <ImportFields form={form} set={set} />
      {roots.length ? (
        <form className="studio-form inline" onSubmit={importPath} aria-label="Import dintr-o cale locală">
          <label className="field grow"><span>Cale locală (în folderele permise)</span><input className="input mono" required maxLength={1000} value={form.sourcePath} onChange={(e) => set("sourcePath", e.target.value)} placeholder={`${roots[0]}\\…`} /></label>
          <button className="btn" type="submit" disabled={Boolean(b.busy) || !form.sourcePath.trim()}>{b.busy ? "Se importă…" : "Importă"}</button>
        </form>
      ) : <Notice tone="info">Niciun folder de import local nu e configurat; folosește încărcarea de mai jos (folderele permise se stabilesc din sesiunea de proprietar).</Notice>}
      {roots.length > 0 && <p className="faint small">Foldere permise: {roots.map((r) => <code key={r} className="mono">{r}</code>).reduce((a, x) => (a.length ? [...a, ", ", x] : [x]), [])}</p>}
      <div className={`studio-drop${drag ? " is-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files); }}>
        <UploadCloud size={22} aria-hidden="true" />
        <span>Trage fișiere video, audio sau imagini aici</span>
        <button className="btn sm" type="button" onClick={() => file.current?.click()}>Alege fișiere</button>
        <input ref={file} type="file" multiple hidden accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} aria-label="Alege fișiere de încărcat" />
        <span className="faint small">Fișierul merge doar la Hub-ul local; se verifică (hash, tip, ffprobe) ca un import.</span>
      </div>
      {uploads.length > 0 && <ul className="studio-uploads">{uploads.map((u, i) => <li key={`${u.name}-${i}`} className="small"><span className="mono">{u.name}</span> · {fmt.bytes(u.size)} · {u.state}</li>)}</ul>}
      <ErrorNotice error={b.error} />
    </Panel>
  );
}

function RightsForm({ assetId }) {
  const [form, setForm] = useState({ status: "CLEARED_FOR_SCOPE", holder: "", platforms: ["*"], uses: ["organic"], startsAt: "", endsAt: "", licenseRef: "", documentRef: "", sourceRef: "", marketingConsent: false });
  const b = useBusy();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, v) => set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  const submit = (e) => {
    e.preventDefault();
    b.run("rights", async () => {
      const right = { assetId, status: form.status, holder: form.holder.trim(), platforms: form.platforms, uses: form.uses, licenseRef: form.licenseRef.trim(), documentRef: form.documentRef.trim(),
        sourceRef: form.sourceRef.trim(), marketingConsent: form.marketingConsent, sourceKind: "manual",
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}), ...(form.endsAt ? { endsAt: new Date(form.endsAt).toISOString() } : {}) };
      await studioPost("/api/media/rights", { right }, { toast: "Drept înregistrat" });
    });
  };
  return (
    <form className="studio-form" onSubmit={submit} aria-label="Înregistrează drepturi">
      <label className="field"><span>Stare</span><select className="select" value={form.status} onChange={(e) => set("status", e.target.value)}>
        {["CLEARED_FOR_SCOPE", "PENDING", "RESTRICTED", "EXPIRED"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="field"><span>Titular</span><input className="input" maxLength={200} value={form.holder} onChange={(e) => set("holder", e.target.value)} /></label>
      <fieldset className="studio-fieldset"><legend>Platforme</legend><div className="row wrap">{RIGHT_PLATFORMS.map((p) => <label key={p} className="radio-chip"><input type="checkbox" checked={form.platforms.includes(p)} onChange={() => toggle("platforms", p)} />{p === "*" ? "toate" : p}</label>)}</div></fieldset>
      <fieldset className="studio-fieldset"><legend>Folosiri</legend><div className="row wrap">{RIGHT_USES.map((u) => <label key={u} className="radio-chip"><input type="checkbox" checked={form.uses.includes(u)} onChange={() => toggle("uses", u)} />{u === "*" ? "toate" : u}</label>)}</div></fieldset>
      <label className="field"><span>De la (opțional)</span><input className="input" type="date" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></label>
      <label className="field"><span>Până la (opțional)</span><input className="input" type="date" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></label>
      <label className="field"><span>Referință licență</span><input className="input" maxLength={500} value={form.licenseRef} onChange={(e) => set("licenseRef", e.target.value)} /></label>
      <label className="field"><span>Document</span><input className="input" maxLength={500} value={form.documentRef} onChange={(e) => set("documentRef", e.target.value)} /></label>
      <label className="field"><span>Sursă</span><input className="input" maxLength={500} value={form.sourceRef} onChange={(e) => set("sourceRef", e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={form.marketingConsent} onChange={(e) => set("marketingConsent", e.target.checked)} /> Acord de marketing (cere document sau sursă)</label>
      <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy)}><Scale size={15} aria-hidden="true" />{b.busy ? "Se înregistrează…" : "Înregistrează dreptul"}</button></div>
      <ErrorNotice error={b.error} />
    </form>
  );
}

/** Rights of one asset: active / history, the evaluation, revoke (fail-safe; shows what is affected). */
export function AssetRights({ assetId }) {
  const data = useStudio(`/api/media/assets/${encodeURIComponent(assetId)}`, ["media.rights.", "media.asset."]);
  const b = useBusy();
  const [impact, setImpact] = useState(null);
  if (data.loading && !data.data) return <Loading lines={2} />;
  if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
  const rights = data.data?.rights || {};
  const ev = data.data?.evaluation || {};
  return (
    <div className="stack tight">
      <div className="row wrap"><span className="small">Origine:</span><Chip tone={rights.origin === "UNKNOWN" ? "warn" : "info"}>{rights.origin}</Chip><span className="small">Evaluare (orice platformă, organic):</span>
        <Chip tone={ev.allowed ? "ok" : "error"}>{ev.allowed ? "permis" : "nepermis"}</Chip>{ev.requiresDisclosure && <Chip tone="warn">necesită declarare AI</Chip>}</div>
      {Array.isArray(ev.reasons) && ev.reasons.length > 0 && <ul className="faint small">{ev.reasons.map((r, i) => <li key={i}>{typeof r === "string" ? r : r.message || r.code}</li>)}</ul>}
      {(rights.history || []).length ? (
        <ul className="intel-list">
          {rights.history.map((r) => (
            <li key={r.id} className="row wrap between">
              <span className="row wrap"><Chip tone={r.status === "CLEARED_FOR_SCOPE" ? "ok" : r.status === "REVOKED" ? "neutral" : "warn"}>{r.status}</Chip>
                <span className="small">{(r.platforms || []).join(", ") || "—"} · {(r.uses || []).join(", ") || "—"}{r.endsAt ? ` · până la ${fmt.dateTime(r.endsAt)}` : ""}{r.holder ? ` · ${r.holder}` : ""}</span></span>
              {r.status !== "REVOKED" && !r.revokedAt && <button className="btn sm danger" type="button" disabled={Boolean(b.busy)} onClick={() => b.run(r.id, async () => {
                const out = await studioPost(`/api/media/rights/${encodeURIComponent(r.id)}/revoke`, { reason: "revocat din Studio" }, { toast: "Drept revocat" });
                setImpact(out?.impact || out?.right?.impact || null);
              })}><Undo2 size={13} aria-hidden="true" />Revocă</button>}
            </li>
          ))}
        </ul>
      ) : <p className="faint small">Niciun drept înregistrat.</p>}
      {impact && (
        <Notice tone="warn" title="Materiale afectate de revocare (nimic nu se șterge)">
          derivate {impact.counts?.derivatives ?? 0} · versiuni de montaj {impact.counts?.editVersions ?? 0} · variante {impact.counts?.variants ?? 0} · randări {impact.counts?.renderJobs ?? 0} · manifeste {impact.counts?.manifests ?? 0} · încercări de distribuție {impact.counts?.releaseAttempts ?? 0}
          {(impact.plan || []).length > 0 && <ul className="small">{impact.plan.slice(0, 20).map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
        </Notice>
      )}
      <ErrorNotice error={b.error} />
      <details className="studio-details"><summary>Înregistrează un drept</summary><RightsForm assetId={assetId} /></details>
    </div>
  );
}

function AssetDetail({ asset, seekMs }) {
  const v = asset.current || null;
  const transcripts = useStudio(v ? `/api/media/transcripts?assetVersionId=${encodeURIComponent(v.id)}` : null, ["media.transcript", "media.asset."]);
  const b = useBusy();
  const playable = v && v.status === "READY" && ["video", "audio"].includes(asset.kind);
  return (
    <div className="stack">
      <div className="row wrap"><strong>{asset.title || asset.id}</strong><Chip>{asset.kind}</Chip><Chip>{asset.category}</Chip>{asset.captureLabel && asset.captureLabel !== "NOT_APPLICABLE" && <Chip tone="warn">{asset.captureLabel}</Chip>}{v && <Chip tone={v.status === "READY" ? "ok" : "warn"}>{v.status}</Chip>}</div>
      {playable && <Player key={`${v.id}:${seekMs ?? ""}`} assetVersionId={v.id} fps={v.probe?.video?.fps} initialMs={seekMs} label={asset.title || "Material"} />}
      {asset.kind === "image" && v?.status === "READY" && <img className="studio-image" src={`/api/media/files/${encodeURIComponent(v.id)}`} alt={asset.title || "imagine din bibliotecă"} />}
      {v && <p className="faint small">sha256 <Hash value={v.sha256} /> · {fmt.bytes(v.bytes)}{v.durationMs ? ` · ${fmtSeconds(v.durationMs)}` : ""}{v.isOriginal ? " · original (imutabil)" : " · derivat"}</p>}
      {v && ["video", "audio"].includes(asset.kind) && (
        <div className="row wrap">
          <button className="btn sm" type="button" disabled={Boolean(b.busy) || v.status !== "READY"} onClick={() => b.run("tx", () => studioPost("/api/media/transcripts", { assetVersionId: v.id, language: "ro" }, { toast: "Transcriere locală pornită" }))}>
            <Captions size={14} aria-hidden="true" />{b.busy ? "Se pornește…" : "Transcrie local"}</button>
          <span className="faint small">whisper local, fără rețea; nu e o comandă vocală și nu confirmă nimic.</span>
        </div>
      )}
      {(transcripts.data?.transcripts || []).length > 0 && (
        <ul className="intel-list">{transcripts.data.transcripts.map((t) => (
          <li key={t.id} className="stack tight"><div className="row wrap"><Chip tone={t.status === "final" ? "ok" : ["failed", "timeout"].includes(t.status) ? "error" : t.status === "cancelled" ? "neutral" : "info"}>{TX_LABEL[t.status] || t.status}</Chip><span className="faint small">{t.language} · {fmt.dateTime(t.createdAt)}</span>
            {!TX_TERMINAL.includes(t.status) &&<button className="btn sm danger" type="button" onClick={() => b.run(`txc-${t.id}`, () => studioPost(`/api/media/transcripts/${encodeURIComponent(t.id)}/cancel`, {}))}>Oprește</button>}</div>
            {t.text && <p className="small studio-transcript">{t.text.slice(0, 600)}{t.text.length > 600 ? "…" : ""}</p>}{t.error && <span className="faint small">{String(t.error).slice(0, 200)}</span>}</li>
        ))}</ul>
      )}
      <ErrorNotice error={b.error} />
      <h3 className="block-title small">Drepturi</h3>
      <AssetRights assetId={asset.id} />
    </div>
  );
}

/** Bibliotecă: search (timecoded), the asset list, import / upload, and the selected asset (preview, transcripts, rights). */
export function Library({ status, contentProjectId = null }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState(null);
  const params = new URLSearchParams({ limit: "100" });
  if (contentProjectId) params.set("contentProjectId", contentProjectId);
  if (category) params.set("category", category);
  const assets = useStudio(`/api/media/assets?${params}`, ["media.asset.", "media.rights.", "media.render."]);
  const sp = new URLSearchParams({ q: query, limit: "50" });
  if (contentProjectId) sp.set("contentProjectId", contentProjectId);
  const search = useStudio(query.length >= 2 ? `/api/media/search?${sp}` : null, ["media.transcript", "media.asset."]);
  const list = assets.data?.assets || [];
  const quota = assets.data?.quota || status?.quota;
  const pick = (assetId, seekMs = null) => setSelected({ assetId, seekMs });
  const chosen = selected ? list.find((a) => a.id === selected.assetId) : null;
  return (
    <div className="stack">
      {quota && (
        <p className="faint small">Spațiu: {fmt.bytes(quota.usedBytes)} folosiți{quota.freeBytes !== undefined ? ` · ${fmt.bytes(quota.freeBytes)} liberi` : ""}{status?.storage?.synced ? " · atenție: biblioteca pare într-un folder sincronizat în cloud" : ""}</p>
      )}
      {(quota?.warnings || []).map((w, i) => <Notice key={i} tone="warn">{typeof w === "string" ? w : w.message}</Notice>)}
      <Importer status={status} contentProjectId={contentProjectId} />
      <Panel title="Caută în materiale" icon={Search} id="studio-search">
        <form className="studio-form inline" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} role="search">
          <label className="field grow"><span>Text (titlu, etichete, transcrieri, markere)</span><input className="input" type="search" minLength={2} maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn" type="submit" disabled={q.trim().length < 2}>Caută</button>
        </form>
        {search.error && <ErrorNotice error={search.error} />}
        {query && search.data && (!search.data.results?.length ? <p className="faint small">Niciun rezultat pentru „{query}”.</p> : (
          <ul className="intel-list">
            {search.data.results.map((r, i) => (
              <li key={`${r.versionId}-${r.fromMs}-${i}`} className="row wrap">
                <Chip>{SOURCE_LABEL[r.source] || r.source}</Chip>
                {Number.isFinite(r.fromMs) ? <button type="button" className="link-btn mono small" onClick={() => pick(r.assetId, r.fromMs)}>{fmtSeconds(r.fromMs)}{Number.isFinite(r.toMs) ? `–${fmtSeconds(r.toMs)}` : ""}</button>
                  : <button type="button" className="link-btn small" onClick={() => pick(r.assetId)}>deschide</button>}
                <span className="small">{String(r.text || "").slice(0, 200)}</span>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
      <Panel title="Materiale" icon={FileVideo} id="studio-assets" actions={
        <label className="field inline"><span>Categorie</span><select className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">toate</option>{[...CATEGORIES, "render", "proxy", "export"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}>
        {assets.loading && !assets.data ? <Loading lines={3} /> : assets.error ? <ErrorNotice error={assets.error} onRetry={assets.reload} />
          : !list.length ? <Empty title="Niciun material">Importă un fișier dintr-un folder permis sau încarcă-l din pagină.</Empty> : (
            <div className="table-wrap">
              <table className="table table-mobile-cards">
                <thead><tr><th>Titlu</th><th>Tip</th><th>Origine</th><th>Stare</th><th>Durată</th><th><span className="sr-only">Acțiuni</span></th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={selected?.assetId === a.id ? "row-selected" : undefined}>
                      <td data-label="Titlu">{a.title || a.id}<div className="sub">{a.category}{a.captureLabel && a.captureLabel !== "NOT_APPLICABLE" ? ` · ${a.captureLabel}` : ""}</div></td>
                      <td data-label="Tip">{a.kind}</td>
                      <td data-label="Origine"><Chip tone={a.origin === "UNKNOWN" ? "warn" : "neutral"}>{a.origin}</Chip></td>
                      <td data-label="Stare">{a.current ? <Chip tone={a.current.status === "READY" ? "ok" : "warn"}>{a.current.status}</Chip> : "—"}</td>
                      <td data-label="Durată">{a.current?.durationMs ? fmtSeconds(a.current.durationMs) : "—"}</td>
                      <td data-label="Acțiuni"><button className="btn sm" type="button" aria-pressed={selected?.assetId === a.id} onClick={() => pick(a.id)}>Deschide</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
      {chosen && <Panel title="Material selectat" id="studio-asset"><AssetDetail asset={chosen} seekMs={selected.seekMs} /></Panel>}
      {selected && !chosen && !assets.loading && <Notice tone="info">Materialul selectat nu e în lista curentă (filtru sau alt proiect).</Notice>}
    </div>
  );
}
