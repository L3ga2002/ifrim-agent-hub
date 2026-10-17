import { useState } from "react";
import { Send, PackageCheck, ShieldCheck, Link2, XCircle, CloudOff } from "lucide-react";
import { Panel, ErrorNotice, Empty, Chip, Notice, Loading, Dialog } from "../../components/ui.jsx";
import { MANIFEST_STATUS, ATTEMPT_STATUS, ATTEMPT_OPEN, OPERATION_STATUS, manifestRows, platformOfProfile } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy, StateChip, Hash } from "./common.jsx";
import { fmt } from "../../api.js";

/** Why there is no upload button: the server's limitations + each platform's documented API status (nothing VERIFIED_LIVE). */
export function UploadUnavailable({ limitations = [], registry }) {
  const upload = (limitations || []).find((l) => l.code === "LIVE_UPLOAD_DISABLED");
  const auto = (limitations || []).find((l) => l.code === "AUTO_PUBLISH_OFF");
  const platforms = Object.values(registry?.platforms || {});
  return (
    <Notice tone="info" title="Încărcarea prin API nu este disponibilă">
      {upload?.text || "Încărcarea pe platforme e oprită."} {auto?.text || ""} Se pregătesc pachete manuale; tu postezi și înregistrezi linkul.
      {platforms.length > 0 && (
        <ul className="studio-api-status">
          {platforms.map((p) => { const op = p.operations?.api_upload; const [tone, label] = OPERATION_STATUS[op?.status] || ["neutral", op?.status || "—"]; return (
            <li key={p.id}><span className="small">{p.label}:</span> <Chip tone={tone}>{label}</Chip>{op?.notes ? <span className="faint small"> {op.notes}</span> : null}</li>
          ); })}
        </ul>
      )}
    </Notice>
  );
}

/** Build a manifest from the variants that have a successful FINAL render (the manifest binds their media sha256). */
function BuildManifest({ projectId, editProjectId, profiles }) {
  const edit = useStudio(`/api/media/edits/${encodeURIComponent(editProjectId)}`, ["media.variant.", "media.render."]);
  const done = useStudio("/api/media/renders?status=DONE&limit=200", ["media.render."]);
  const [rows, setRows] = useState({});
  const b = useBusy();
  const finals = new Set((done.data?.renders || []).filter((r) => r.profile === "final").map((r) => r.editVersionId));
  const variants = (edit.data?.variants || []).filter((v) => v.status !== "INVALIDATED");
  const eligible = variants.filter((v) => finals.has(v.variantVersionId));
  const set = (id, patch) => setRows((r) => ({ ...r, [id]: { include: true, account: "", caption: "", scheduleAt: "", ai: false, ...r[id], ...patch } }));
  const chosen = eligible.filter((v) => rows[v.id]?.include);
  const platforms = chosen.map((v) => platformOfProfile(profiles, v.platformKey));
  const duplicate = platforms.find((p, i) => p && platforms.indexOf(p) !== i);
  const submit = (e) => {
    e.preventDefault();
    b.run("build", async () => {
      const list = chosen.map((v) => {
        const r = rows[v.id];
        return { variantId: v.id, platform: platformOfProfile(profiles, v.platformKey), account: r.account.trim(), caption: r.caption,
          ...(r.scheduleAt ? { scheduleAt: r.scheduleAt, timezone: "Europe/Bucharest" } : {}), disclosure: { aiGenerated: r.ai === true } };
      });
      await studioPost("/api/content/manifests", { contentProjectId: projectId, variants: list }, { toast: "Manifest construit (ciornă)" });
      setRows({});
    });
  };
  if (edit.loading && !edit.data) return <Loading lines={2} />;
  if (edit.error) return <ErrorNotice error={edit.error} onRetry={edit.reload} />;
  if (!eligible.length) return <Empty title="Nicio variantă cu randare finală">Un manifest cuprinde doar variante randate final (hash-ul fișierului intră în ce aprobi). Randează varianta „Finală” în tabul Variante.</Empty>;
  return (
    <form className="stack" onSubmit={submit} aria-label="Construiește manifestul">
      {eligible.map((v) => {
        const r = rows[v.id] || {};
        const platform = platformOfProfile(profiles, v.platformKey);
        return (
          <fieldset key={v.id} className="studio-fieldset">
            <legend><label className="check"><input type="checkbox" checked={Boolean(r.include)} onChange={(e) => set(v.id, { include: e.target.checked })} /> {profiles?.[v.platformKey]?.label || v.platformKey} → {platform || "?"}</label></legend>
            {r.include && (
              <div className="studio-form">
                <label className="field"><span>Cont (nume / handle, nu token)</span><input className="input" required maxLength={120} value={r.account || ""} onChange={(e) => set(v.id, { account: e.target.value })} /></label>
                <label className="field"><span>Textul postării</span><textarea className="textarea" rows={3} maxLength={5000} value={r.caption || ""} onChange={(e) => set(v.id, { caption: e.target.value })} /></label>
                <label className="field"><span>Programare (ora locală, Europe/Bucharest; opțional)</span><input className="input" type="datetime-local" value={r.scheduleAt || ""} onChange={(e) => set(v.id, { scheduleAt: e.target.value })} /></label>
                <label className="check"><input type="checkbox" checked={Boolean(r.ai)} onChange={(e) => set(v.id, { ai: e.target.checked })} /> Conține material generat cu AI (se declară pe platformă)</label>
              </div>
            )}
          </fieldset>
        );
      })}
      {duplicate && <Notice tone="warn">Două variante merg pe aceeași platformă ({duplicate}); un manifest are o singură variantă pe platformă.</Notice>}
      <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !chosen.length || Boolean(duplicate)}><Send size={15} aria-hidden="true" />{b.busy ? "Se construiește…" : "Construiește manifestul"}</button></div>
      <ErrorNotice error={b.error} />
    </form>
  );
}

/** One manifest: its hash, the per-platform rows and the actions its state allows. */
function ManifestCard({ manifest }) {
  const detail = useStudio(`/api/content/manifests/${encodeURIComponent(manifest.id)}`, ["content."]);
  const attempts = useStudio(`/api/content/releases?manifestId=${encodeURIComponent(manifest.id)}`, ["content."]);
  const b = useBusy();
  const [confirm, setConfirm] = useState(false);
  const [urls, setUrls] = useState({});
  const m = detail.data?.manifest || manifest;
  const rows = manifestRows(m, detail.data?.releases);
  const list = attempts.data?.releases || [];
  const approve = () => b.run("approve", async () => {
    await studioPost(`/api/content/manifests/${encodeURIComponent(m.id)}/approve`, { manifestSha256: m.manifestSha256 }, { owner: true, toast: "Manifest aprobat din sesiunea ta" });
    setConfirm(false);
  });
  return (
    <li className="stack tight studio-manifest">
      <div className="row wrap between">
        <span className="row wrap"><StateChip map={MANIFEST_STATUS} value={m.status} /><span className="faint small">{fmt.dateTime(m.createdAt)}</span></span>
        <span className="small">hash <Hash value={m.manifestSha256} n={16} /></span>
      </div>
      {m.invalidatedReason && <Notice tone="warn">{m.invalidatedReason}</Notice>}
      <div className="table-wrap">
        <table className="table table-mobile-cards">
          <thead><tr><th>Platformă</th><th>Cont</th><th>Text</th><th>Media</th><th>Programare</th><th>Stare</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.platform}>
                <td data-label="Platformă">{r.platform}{r.disclosure && <div className="sub">{r.disclosure}</div>}</td>
                <td data-label="Cont">{r.account}</td>
                <td data-label="Text"><span className="studio-caption">{r.caption || "—"}</span><div className="sub">sha <Hash value={r.captionSha256} n={8} /></div></td>
                <td data-label="Media">{r.rendered ? <Hash value={r.mediaSha256} n={8} /> : <Chip tone="error">fără randare finală</Chip>}</td>
                <td data-label="Programare">{r.schedule}</td>
                <td data-label="Stare"><StateChip map={ATTEMPT_STATUS} value={r.release.status} />{r.release.url && <div className="sub"><a href={r.release.url} target="_blank" rel="noreferrer noopener">{r.release.url}</a></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        {m.status === "DRAFT" && <button className="btn approve" type="button" disabled={Boolean(b.busy)} onClick={() => setConfirm(true)}><ShieldCheck size={15} aria-hidden="true" />Aprobă exact acest pachet</button>}
        {m.status === "APPROVED" && rows.map((r) => (
          <button key={r.platform} className="btn sm" type="button" disabled={Boolean(b.busy) || ATTEMPT_OPEN.includes(r.release.status) || r.release.status === "PUBLISHED"}
            onClick={() => b.run(`pack-${r.platform}`, () => studioPost(`/api/content/manifests/${encodeURIComponent(m.id)}/packs`, { platform: r.platform }, { toast: `Pachet manual pregătit pentru ${r.platform}` }))}>
            <PackageCheck size={14} aria-hidden="true" />Pachet manual · {r.platform}</button>
        ))}
      </div>
      {list.length > 0 && (
        <ul className="intel-list" aria-label="Încercări de distribuție">
          {list.map((a) => (
            <li key={a.id} className="stack tight">
              <div className="row wrap between"><span className="row wrap"><strong>{a.platform}</strong><StateChip map={ATTEMPT_STATUS} value={a.status} /><span className="faint small">{a.route}</span></span>
                {ATTEMPT_OPEN.includes(a.status) && <button className="btn sm danger" type="button" disabled={b.busy === `x-${a.id}`} onClick={() => b.run(`x-${a.id}`, () => studioPost(`/api/content/releases/${encodeURIComponent(a.id)}/cancel`, { reason: "anulat din Studio" }, { toast: "Încercare anulată" }))}><XCircle size={13} aria-hidden="true" />Anulează</button>}
              </div>
              {a.status === "PACK_READY" && (
                <form className="studio-form inline" onSubmit={(e) => { e.preventDefault(); b.run(`u-${a.id}`, () => studioPost(`/api/content/releases/${encodeURIComponent(a.id)}/manual`, { url: (urls[a.id] || "").trim() }, { owner: true, toast: "Publicarea manuală a fost înregistrată" })); }}>
                  <label className="field grow"><span>Linkul postării (după ce ai postat manual)</span><input className="input" type="url" required maxLength={500} value={urls[a.id] || ""} onChange={(e) => setUrls((u) => ({ ...u, [a.id]: e.target.value }))} placeholder="https://…" /></label>
                  <button className="btn" type="submit" disabled={Boolean(b.busy) || !(urls[a.id] || "").trim()}><Link2 size={14} aria-hidden="true" />Înregistrează</button>
                </form>
              )}
              {a.error && <span className="faint small">{a.error}</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={b.error} />
      {confirm && (
        <Dialog title="Aprobă pachetul de distribuție" onClose={() => setConfirm(false)} labelledBy={`approve-${m.id}`} footer={<>
          <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Renunță</button>
          <button className="btn approve" type="button" disabled={Boolean(b.busy)} onClick={approve}>{b.busy === "approve" ? "Se verifică sesiunea…" : "Aprob (Windows Hello)"}</button>
        </>}>
          <p>Aprobi exact manifestul cu hash-ul:</p>
          <p className="mono studio-hash-full">{m.manifestSha256}</p>
          <p className="small">Orice schimbare ulterioară (text, cont, programare, randare, drepturi, QA) invalidează aprobarea. Aprobarea nu încarcă nimic: pachetele se postează manual, fiecare cu acțiunea ei.</p>
          <ErrorNotice error={b.error} />
        </Dialog>
      )}
    </li>
  );
}

/** Distribuție for a content project. */
export function Distribution({ projectId, editProjectId, manifests = [], profiles, limitations }) {
  const registry = useStudio("/api/content/platforms", []);
  return (
    <div className="stack">
      <UploadUnavailable limitations={limitations} registry={registry.data?.platforms} />
      <Panel title="Manifest nou" icon={Send} id="studio-manifest-new">
        {editProjectId ? <BuildManifest projectId={projectId} editProjectId={editProjectId} profiles={profiles} /> : <Empty title="Niciun montaj">Creează un plan de montaj și variantele lui mai întâi.</Empty>}
      </Panel>
      <Panel title="Manifeste" icon={CloudOff} id="studio-manifests">
        {!manifests.length ? <Empty title="Niciun manifest">Manifestul leagă exact variantele, textele și fișierele pe care le aprobi.</Empty>
          : <ul className="intel-list">{manifests.map((m) => <ManifestCard key={m.id} manifest={m} />)}</ul>}
      </Panel>
    </div>
  );
}
