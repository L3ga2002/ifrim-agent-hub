import { useState } from "react";
import { FolderInput, Check, FolderOpen } from "lucide-react";
import { Panel, Notice, Chip, ErrorNotice } from "../../components/ui.jsx";
import { studioPost, useBusy } from "./common.jsx";

/**
 * M10 „Importă proiectul”: a folder with a Studio bundle (proiect-studio.json) or an older delivery (edit plans + sources) → a
 * read-only preview (what comes in, hashes checked, labels kept, what is missing) → ONE confirmation in your session. Approvals are
 * never imported: the creative review stays yours. A folder outside the import folders gets a one-time access (Windows Hello).
 * The same works by voice: open the folder in Explorer and say „Importă din folderul acesta”.
 */
export function ProjectImport({ go }) {
  const [dir, setDir] = useState("");
  const [preview, setPreview] = useState(null);
  const [outside, setOutside] = useState(null);
  const [done, setDone] = useState(null);
  const b = useBusy();
  const show = () => b.run("preview", async () => {
    setDone(null); setOutside(null); setPreview(null);
    try { setPreview(await studioPost("/api/media/projects/preview", { dir: dir.trim() })); }
    catch (e) {
      if (e?.code === "IMPORT_OUTSIDE_ROOTS" || /folder de import permis/.test(e.message)) setOutside(await studioPost("/api/media/import-folders/preview", { dir: dir.trim() }));
      else throw e;
    }
  });
  const allowOnce = () => b.run("allow", async () => {
    await studioPost("/api/media/import-folders/authorize", { dir: outside.folder, mode: "once", previewSha256: outside.previewSha256 }, { owner: true, toast: "Acces o singură dată, pentru acest import" });
    setOutside(null);
    setPreview(await studioPost("/api/media/projects/preview", { dir: dir.trim() }));
  });
  const confirm = () => b.run("import", async () => {
    const out = await studioPost("/api/media/projects/import", { importId: preview.importId, previewHash: preview.previewHash }, { owner: true, toast: "Proiect importat în Studio" });
    setDone(out);
  });
  return (
    <Panel title="Importă un proiect" icon={FolderInput} id="studio-import">
      <form className="studio-form inline" onSubmit={(e) => { e.preventDefault(); if (dir.trim()) show(); }}>
        <label className="field grow"><span>Folderul proiectului</span>
          <input className="input mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\Users\…\Videos\Ifrim Digital - Clip M09" />
        </label>
        <button className="btn" type="submit" disabled={Boolean(b.busy) || !dir.trim()}><FolderOpen size={14} aria-hidden="true" />{b.busy === "preview" ? "Citesc…" : "Arată ce se importă"}</button>
      </form>
      <p className="faint small">Sau, prin voce: deschide folderul în Explorer și spune „Importă din folderul acesta”.</p>
      <ErrorNotice error={b.error} />
      {outside && (
        <Notice tone="warn" title="Folderul nu e printre folderele de import">
          <span className="small">{outside.folder}: {outside.files.length} fișiere ({Object.entries(outside.byType).map(([k, v]) => `${v} ${k}`).join(", ") || "niciunul"}){outside.skipped.secrets ? ` · ${outside.skipped.secrets} fișiere secrete ignorate` : ""}.</span>
          <div className="row wrap"><button className="btn sm approve" disabled={Boolean(b.busy)} onClick={allowOnce}>Acces o singură dată (Windows Hello)</button></div>
        </Notice>
      )}
      {preview && !done && (
        <div className="stack tight">
          <div className="row wrap"><strong>{preview.title}</strong><Chip tone={preview.format === "bundle" ? "ok" : "warn"}>{preview.format === "bundle" ? "pachet Studio" : "reconstruire din livrare veche"}</Chip>
            {preview.alreadyImported && <Chip tone="info">deja importat</Chip>}</div>
          <ul className="plain small">
            <li>{preview.assets.length} fișiere sursă ({preview.assets.filter((a) => a.ok).length} verificate prin hash)</li>
            <li>{preview.edits.reduce((n, e) => n + e.versions, 0)} versiuni de montaj · {preview.variants.length} variante (vin ca ciornă)</li>
            <li>Etichete păstrate: {preview.labels.join(", ") || "—"}</li>
            <li>{preview.approvals}</li>
            {preview.missing.length > 0 && <li>Nu se pot reface: {preview.missing.join("; ")}</li>}
          </ul>
          {preview.problems.length > 0 && <Notice tone="error" title="Probleme">{preview.problems.slice(0, 6).join(" · ")}</Notice>}
          <div className="row wrap"><button className="btn approve" disabled={Boolean(b.busy) || preview.problems.length > 0} onClick={confirm}><Check size={15} aria-hidden="true" />{b.busy === "import" ? "Import…" : preview.alreadyImported ? "Deschide proiectul" : "Importă (o confirmare)"}</button></div>
        </div>
      )}
      {done && <Notice tone="ok" title={done.duplicate ? "Era deja importat" : "Importat"}><button className="btn sm" onClick={() => go(`/studio/${done.contentProjectId}`)}>Deschide în Studio</button>{done.missing?.length ? <span className="faint small"> · lipsesc: {done.missing.join("; ")}</span> : null}</Notice>}
    </Panel>
  );
}
