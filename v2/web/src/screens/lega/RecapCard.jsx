import { useHub, usePref } from "../../store.js";
import { controlRecap, cacheRecap, setCommand, useRecapVisibility } from "../../shell/CommandBridge.jsx";
import { api } from "../../api.js";
import { Indicator, RecapText } from "../command/Recap.jsx";
export default function RecapCard({ go, visible = true }) {
  const recap = useHub((s) => s.command?.recap), snapshots = useHub((s) => s.recapSnapshots), voice = useHub((s) => s.recapVoice), [hideNumbers] = usePref("command.hideNumbers", false);
  const voiceOff = useHub((s) => s.legaStatus !== "active");
  const snapshot = snapshots?.[recap?.snapshotId];
  useRecapVisibility("lega", visible && Boolean(recap && !recap.stopped));
  if (!visible || !recap || recap.stopped) return null;
  return <section className="lega-one-panel recap-card" aria-label="Rezumat"><RecapText snapshot={snapshot} recap={recap} voice={voice} voiceOff={voiceOff} onControl={(a) => controlRecap(a, go)} onRefresh={async () => { const next = await api(`/api/recap?period=${snapshot.period.kind}`); cacheRecap(next); setCommand({ recap: { snapshotId: next.id, index: 0, stopped: false } }); }}/>{snapshot?.chapters?.[recap.index]?.indicators.map((i) => <Indicator key={i.id} indicator={i} hideNumbers={hideNumbers}/>)}<button className="btn" onClick={() => go("/comanda")}>Mod Comandă</button></section>;
}
