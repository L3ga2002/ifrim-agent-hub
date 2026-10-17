import { FolderCheck } from "lucide-react";
import { Chip } from "../../components/ui.jsx";
import { dossierStatusMeta } from "../../lib/salesPrepLogic.js";
import { SyntheticTag, when } from "./common.jsx";

/**
 * One revision of „Dosarul ofertei” (M12, S-06): its status, the folder name, the FULL manifest SHA (never a prefix), the contact
 * draft as DRAFT_ONLY (nothing sent), and the Word check said truthfully (APP_VERIFIED only when Word itself opened the document;
 * APP_NOT_RUN is not a Word verification). Read only: the dossier is written by the confirmed plan, never from this screen.
 */
export function DossierRow({ d }) {
  // Review F21: a READY revision whose inputs changed is shown as no longer current (warn), never as the green „Gata”.
  const meta = d.display || dossierStatusMeta(d.status);
  return (
    <li className="stack tight sales-dossier">
      <div className="row wrap">
        <FolderCheck size={14} aria-hidden="true" />
        <strong>Revizia {d.revision}</strong>
        <Chip tone={meta.tone} title={d.status}>{meta.label}</Chip>
        {d.syntheticData && <SyntheticTag />}
        {d.createdAt && <span className="faint small">{when(d.createdAt)}</span>}
      </div>
      {d.folderName && <div className="small break">Folder: <code className="mono break" style={{ overflowWrap: "anywhere" }}>{d.folderName}</code></div>}
      <div className="small break">Manifest SHA-256: <code className="mono break" style={{ overflowWrap: "anywhere" }}>{d.manifestSha256 || "— (încă nescris)"}</code></div>
      <div className="small break">Ciorna de contact: {d.draftOnly ? "DRAFT_ONLY" : "ciornă"}, netrimisă{d.sent ? "" : " (nimic nu a plecat din calculator)"}. {d.fileCount} fișiere{d.files.some((f) => f.reused) ? `, dintre care ${d.files.filter((f) => f.reused).length} refolosite cu dovada intrărilor identice` : ""}.</div>
      <div className="small break">{d.verification.file} {d.verification.label}</div>
      {d.verification.note && <div className="faint small break">{d.verification.note}</div>}
      {d.status === "READY" && d.inputsCurrent === false && <div className="faint small break">Intrările ofertei s-au schimbat de la scriere: revizia aceasta nu mai corespunde.</div>}
      {d.statusReason && d.status !== "READY" && <div className="faint small break">{d.statusReason}</div>}
    </li>
  );
}

/** Every revision of the opportunity's dossier, newest first. */
export function DossierList({ dossiers }) {
  if (!dossiers.length) return <p className="faint small" style={{ margin: 0 }}>Dosarul ofertei se face după aprobarea ta a versiunii exacte; nu există încă.</p>;
  return <ul className="plain-list stack">{dossiers.map((d) => <DossierRow key={d.id} d={d} />)}</ul>;
}
