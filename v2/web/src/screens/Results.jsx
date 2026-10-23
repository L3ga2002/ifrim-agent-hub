import { History } from "lucide-react";
import { usePref } from "../store.js";
import { Panel } from "../components/ui.jsx";
import { StatePill, MeaningChip } from "../components/StatePill.jsx";
import { HistoryList } from "./lega/Attention.jsx";
import { STATE_KEYS, MEANINGS } from "../lib/stateVocab.js";

/**
 * M15 „Rezultate”: every result and revision the Hub keeps (deliveries, Sales offers, desk records), by name and date, newest first, with a
 * search by words — no id to remember. Read-only: a row opens the place where the result lives (the Delivery Room, the offer, the desk
 * record on the L3ga screen).
 */
export default function Results({ go }) {
  const [, setDeskFocus] = usePref("lega.deskFocus", null);
  const openDesk = (id) => { setDeskFocus({ id, at: Date.now() }); go("/lega"); };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Rezultate și istoric</h1><p>Livrările, ofertele, dosarele și devizele, cu data și starea lor. Caută după cuvinte („deviz”, „Brutăria”, „OPS-0001”); nu ai nevoie de ID-uri.</p></div></div>
      <Panel title="Toate rezultatele" icon={History}>
        <HistoryList go={go} onOpenDesk={openDesk} />
      </Panel>
      <Panel title="Ce înseamnă etichetele">
        <div className="stack tight">
          <div className="row wrap">{STATE_KEYS.map((k) => <StatePill key={k} state={k} />)}</div>
          <p className="faint small" style={{ margin: 0 }}>Stările spun unde e lucrul. „Rezultat gata” nu înseamnă acceptat; „Depășit” are mereu motivul și următoarea acțiune.</p>
          <div className="row wrap">{Object.keys(MEANINGS).map((m) => <MeaningChip key={m} meaning={m} />)}</div>
          <p className="faint small" style={{ margin: 0 }}>Etichetele cu contur spun ce înseamnă o decizie deja luată: aprobarea internă a unei oferte nu e acceptarea clientului, un text aprobat nu e trimis, un document generat nu e trimis.</p>
        </div>
      </Panel>
    </div>
  );
}
