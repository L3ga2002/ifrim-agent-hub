import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ListTodo, Check, RotateCcw, Trash2, Plus } from "lucide-react";
import { api } from "../../api.js";
import { useResource, pushToast } from "../../store.js";

/**
 * 2.19.1: the owner's wishlist on the L3ga screen — what he asked for and the Hub cannot do yet, in his own words (said to L3ga:
 * „Pune pe wishlist …”, „Pune asta pe wishlist”, or written here). A note per idea: marking it done or removing it changes only the
 * list; nothing starts from it.
 */
export function WishlistPanel({ focusAt = 0 }) {
  const wishlist = useResource("/api/wishlist", { reloadOn: (e) => e.type === "wishlist.added" || e.type === "wishlist.status" });
  const [open, setOpen] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  // A wishlist answer in the conversation brings the list into view (and opens it), so „o vezi la Wishlist” is true.
  useEffect(() => { if (!focusAt) return; setOpen(true); wishlist.reload(); box.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [focusAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = wishlist.data?.items || [];
  const openItems = items.filter((x) => x.status === "OPEN");
  const done = items.filter((x) => x.status === "DONE");
  const call = async (path, body, okText) => {
    setBusy(true);
    try { await api(path, { method: "POST", body }); if (okText) pushToast("wishlist", "ok", okText); wishlist.reload(); return true; }
    catch (e) { pushToast("wishlist", "error", e.message); return false; }
    finally { setBusy(false); }
  };
  const add = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (value.length < 3 || busy) return;
    if (await call("/api/wishlist", { text: value }, "Am trecut ideea pe wishlist.")) setText("");
  };
  const when = (iso) => { try { return new Date(iso).toLocaleDateString("ro-RO", { day: "numeric", month: "short" }); } catch { return ""; } };
  return (
    <section ref={box} className={`lega-one-panel wishlist-panel${focusAt && Date.now() - focusAt < 4000 ? " is-flash" : ""}`} aria-label="Wishlist">
      <button type="button" className="link-btn row stage-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<ListTodo size={13} aria-hidden="true" /> Wishlist ({openItems.length})
      </button>
      {open && <>
        {wishlist.error && <p className="faint small">Lista nu s-a putut citi: {wishlist.error.message}</p>}
        {!wishlist.error && !openItems.length && <p className="faint small" style={{ margin: 0 }}>Gol. Spune „Pune pe wishlist …” sau scrie mai jos.</p>}
        <ul className="lega-one-list wishlist-list">
          {openItems.map((x) => (
            <li key={x.id}>
              <span className="break">{x.text}<span className="faint small"> · {when(x.createdAt)}{x.source === "voice" ? " · prin voce" : ""}</span></span>
              <span className="row nowrap">
                <button type="button" className="btn sm icon ghost" disabled={busy} onClick={() => call(`/api/wishlist/${x.id}/status`, { status: "DONE" })} aria-label={`Marchează ca făcut: ${x.text}`} title="Făcut"><Check size={13} /></button>
                <button type="button" className="btn sm icon ghost" disabled={busy} onClick={() => call(`/api/wishlist/${x.id}/status`, { status: "REMOVED" }, "Am scos ideea de pe wishlist.")} aria-label={`Scoate de pe wishlist: ${x.text}`} title="Scoate de pe listă"><Trash2 size={13} /></button>
              </span>
            </li>
          ))}
        </ul>
        {done.length > 0 && <button type="button" className="link-btn faint small" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>{showDone ? "Ascunde" : "Arată"} ce e făcut ({done.length})</button>}
        {showDone && <ul className="lega-one-list wishlist-list is-done">
          {done.map((x) => (
            <li key={x.id}><span className="break">{x.text}</span>
              <button type="button" className="btn sm icon ghost" disabled={busy} onClick={() => call(`/api/wishlist/${x.id}/status`, { status: "OPEN" })} aria-label={`Redeschide: ${x.text}`} title="Redeschide"><RotateCcw size={13} /></button></li>
          ))}
        </ul>}
        <form className="row nowrap wishlist-add" onSubmit={add}>
          <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="O idee nouă…" aria-label="Idee nouă pentru wishlist" disabled={busy} />
          <button type="submit" className="btn sm icon" disabled={busy || text.trim().length < 3} aria-label="Adaugă pe wishlist"><Plus size={14} /></button>
        </form>
      </>}
    </section>
  );
}
