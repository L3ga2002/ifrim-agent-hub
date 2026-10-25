import { useResource, usePref } from "../../store.js";
import Sheet from "../command/Sheet.jsx";
export default function SheetCard({ sheetId }) {
  const [pid] = usePref("lega.project", "");
  const { data, error } = useResource(`/api/process-sheets${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`);
  return <section className="lega-one-panel sheet-card">{error ? <p>Fișa nu e disponibilă: {error.message}</p> : !data ? <p>Se citește fișa…</p> : <Sheet data={data} sheetId={sheetId} compact/>}</section>;
}
