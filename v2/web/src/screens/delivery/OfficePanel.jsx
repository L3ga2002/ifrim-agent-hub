import { FileText } from "lucide-react";
import { Panel, Chip } from "../../components/ui.jsx";

/** What each verification level means, in the owner's words (never „Word control verified” for a file that was only written). */
const LEVELS = Object.freeze({
  APP_VERIFIED: { tone: "ok", label: "verificat în aplicație" },
  FILE_CHECKED: { tone: "neutral", label: "fișier verificat (aplicația nu a rulat)" },
});
const STATUS = Object.freeze({ DONE: { tone: "ok", label: "gata" }, RUNNING: { tone: "info", label: "în lucru" }, FAILED: { tone: "error", label: "eșuat" }, PENDING: { tone: "neutral", label: "în așteptare" } });

/**
 * 5b · Dosar: the office part of the package the owner asked for in the same sentence (Word, Excel, campaign, the folder index), each
 * with the level it actually reached and the file it wrote. Read-only: nothing here publishes, sends or approves.
 */
export function OfficePanel({ room }) {
  const office = room.view?.office;
  if (!office?.requested?.length) return null;
  return (
    <Panel title="5b · Dosarul prezentării" icon={FileText} id="livrare-dosar-panel">
      <div className="stack">
        {office.folder && <p className="faint small">Totul e în <code>{office.folder}</code>. Nimic nu e publicat.</p>}
        <ul className="delivery-observations" aria-label="Fișierele dosarului">
          {office.items.map((it) => {
            const st = STATUS[it.status] || { tone: "neutral", label: it.status };
            const lv = it.level ? LEVELS[it.level] || { tone: "neutral", label: it.level } : null;
            const extra = [it.pages ? `${it.pages} pagini` : null, it.formulasChecked ? `${it.formulasChecked} formule recalculate de Excel` : null,
              it.channels ? `${it.channels} canale, ${it.posts} postări planificate` : null, typeof it.files === "number" ? `${it.files} fișiere` : null].filter(Boolean).join(" · ");
            return (
              <li key={it.kind}>
                <span className="row wrap">
                  <strong>{it.label}</strong>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {lv && <Chip tone={lv.tone}>{lv.label}</Chip>}
                </span>
                {extra && <span className="faint small">{extra}</span>}
                {it.file && <span className="faint small"><code>{it.file}</code>{it.pdf ? <> · PDF: <code>{it.pdf}</code></> : null}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
