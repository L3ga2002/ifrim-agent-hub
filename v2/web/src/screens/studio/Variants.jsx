import { useState } from "react";
import { Layers, Wand2 } from "lucide-react";
import { Panel, ErrorNotice, Empty, Chip, Notice, Loading } from "../../components/ui.jsx";
import { RENDER_STATUS, RENDER_ACTIVE, renderProgress, SEVERITY } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy, StateChip } from "./common.jsx";
import { useRenderProgress } from "./Renders.jsx";

const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

/** One platform variant: what changed against the master, its findings, and its own renders (draft / final). */
function VariantRow({ variant, profile, progress }) {
  const renders = useStudio(`/api/media/renders?editVersionId=${encodeURIComponent(variant.variantVersionId)}&limit=10`, ["media.render."]);
  const b = useBusy();
  const notes = variant.notes || {};
  const findings = Array.isArray(notes.findings) ? notes.findings : [];
  const list = renders.data?.renders || [];
  const request = (profileKey) => b.run(profileKey, () => studioPost("/api/media/renders", { editVersionId: variant.variantVersionId, profile: profileKey }, { toast: `Randare ${profileKey === "final" ? "finală" : "schiță"} cerută pentru ${profile?.label || variant.platformKey}` }));
  return (
    <li className="stack tight studio-variant">
      <div className="row wrap between">
        <span className="row wrap"><strong>{profile?.label || variant.platformKey}</strong><Chip>{variant.status}</Chip>{profile?.canvas && <span className="faint small">{profile.canvas.width}×{profile.canvas.height}</span>}</span>
        <span className="row wrap">
          <button className="btn sm" type="button" disabled={Boolean(b.busy)} onClick={() => request("draft")}>Schiță</button>
          <button className="btn sm primary" type="button" disabled={Boolean(b.busy)} onClick={() => request("final")}>Finală</button>
        </span>
      </div>
      <p className="small">Diferențe față de master: <strong>{Number(notes.changes) || 0}</strong> modificări (încadrare reîncadrată pe focus, text în zona sigură{notes.layout?.captionAnchor ? `, subtitrări ${notes.layout.captionAnchor === "bottom" ? "jos" : notes.layout.captionAnchor}` : ""}).</p>
      {notes.layout?.safeArea && <p className="faint small">Zona sigură: sus {pct(notes.layout.safeArea.top)}, jos {pct(notes.layout.safeArea.bottom)}, stânga {pct(notes.layout.safeArea.left)}, dreapta {pct(notes.layout.safeArea.right)} — {notes.layout.source || "estimare internă — verifică regulile actuale"}</p>}
      {findings.length > 0 && (
        <ul className="studio-findings compact">
          {findings.map((f, i) => { const [tone, label] = SEVERITY[f.severity] || ["neutral", f.severity]; return <li key={i}><Chip tone={tone}>{label}</Chip> <span className="small">{f.message}</span></li>; })}
        </ul>
      )}
      {renders.loading && !renders.data ? <Loading lines={1} /> : list.length > 0 && (
        <ul className="row wrap studio-mini-renders" aria-label="Randările variantei">
          {list.map((r) => { const live = renderProgress(progress[r.id]); return (
            <li key={r.id} className="row"><StateChip map={RENDER_STATUS} value={r.status} /><span className="faint small">{r.profile === "final" ? "finală" : "schiță"}{RENDER_ACTIVE.includes(r.status) && live?.percent !== null && live?.percent !== undefined ? ` · ${live.percent}%` : ""}</span></li>
          ); })}
        </ul>
      )}
      <ErrorNotice error={b.error} />
    </li>
  );
}

/** Variante: derive a native variant per platform from a main-line version and render each one. */
export function Variants({ editProjectId, masterVersion, profiles }) {
  const edit = useStudio(`/api/media/edits/${encodeURIComponent(editProjectId)}`, ["media.variant.", "media.edit.", "media.render."]);
  const progress = useRenderProgress();
  const keys = Object.keys(profiles || {});
  const [platformKey, setPlatformKey] = useState("");
  const [hookText, setHook] = useState("");
  const [ctaText, setCta] = useState("");
  const b = useBusy();
  const isVariant = Boolean(masterVersion?.variantKey);
  const derive = (e) => {
    e.preventDefault();
    const overrides = {};
    if (hookText.trim()) overrides.hookText = hookText.trim();
    if (ctaText.trim()) overrides.ctaText = ctaText.trim();
    b.run("derive", async () => {
      await studioPost(`/api/media/edit-versions/${encodeURIComponent(masterVersion.id)}/variants`, { platformKey, overrides }, { toast: "Variantă creată (versiune nouă, masterul rămâne)" });
      setHook(""); setCta("");
    });
  };
  const variants = edit.data?.variants || [];
  return (
    <div className="stack">
      <Panel title="Variantă nouă pentru o platformă" icon={Wand2} id="studio-variant-new">
        {isVariant ? <Notice tone="info">Versiunea selectată este deja o variantă ({masterVersion.variantKey}); derivă din versiunea principală.</Notice> : !masterVersion ? <Empty title="Nicio versiune selectată" /> : (
          <form className="studio-form" onSubmit={derive} aria-label="Derivă o variantă">
            <label className="field"><span>Platformă (profil)</span>
              <select className="select" required value={platformKey} onChange={(e) => setPlatformKey(e.target.value)}>
                <option value="">— alege —</option>
                {keys.map((k) => <option key={k} value={k}>{profiles[k].label || k}</option>)}
              </select>
            </label>
            <label className="field"><span>Hook propriu (opțional)</span><input className="input" maxLength={200} value={hookText} onChange={(e) => setHook(e.target.value)} /></label>
            <label className="field"><span>Îndemn final propriu (opțional)</span><input className="input" maxLength={200} value={ctaText} onChange={(e) => setCta(e.target.value)} /></label>
            <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !platformKey}>{b.busy ? "Se derivă…" : "Derivă varianta"}</button></div>
            <p className="faint small">O variantă nu e o copie redenumită: încadrarea, poziția textului, subtitrările și durata se adaptează profilului (estimare internă — verifică regulile actuale).</p>
            <ErrorNotice error={b.error} />
          </form>
        )}
      </Panel>
      <Panel title="Variante" icon={Layers} id="studio-variants">
        {edit.loading && !edit.data ? <Loading lines={3} /> : edit.error ? <ErrorNotice error={edit.error} onRetry={edit.reload} />
          : !variants.length ? <Empty title="Nicio variantă">Derivă o variantă pentru fiecare platformă pe care o vizezi.</Empty>
            : <ul className="intel-list">{variants.map((v) => <VariantRow key={v.id} variant={v} profile={profiles?.[v.platformKey]} progress={progress} />)}</ul>}
      </Panel>
    </div>
  );
}
