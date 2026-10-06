import { useEffect, useRef } from "react";
import { Wrench, Pin, ShieldCheck } from "lucide-react";
import { Panel, ErrorNotice, Notice, Loading, Chip } from "../../components/ui.jsx";
import { mediaToolsPanel } from "../../lib/uiLogic.js";
import { studioPost, useBusy, useStudio, Hash } from "./common.jsx";
import { fmt } from "../../api.js";

/**
 * M10.2 (#27) — Studio → Unelte. The render path refuses an unpinned (TOOLS_NOT_PINNED) or changed (TOOL_CHANGED) ffmpeg/ffprobe, and
 * the refusal, the Studio blocker and Lega all send the owner here (#/studio?panel=tools). Reading the panel only inspects (GET
 * /api/media/tools never writes); the two writes are explicit:
 *  - „Fixează” records the identity shown (version + sha256 + shared libraries); a binary that changed meanwhile is refused;
 *  - „Confirmă schimbarea” is the owner's decision (Windows Hello when the session is missing) for exactly the identity shown;
 *    a second change in between is refused (TOOL_CHANGED_AGAIN) and the panel reloads.
 * Nothing is installed or downloaded here; a missing ffmpeg is installed outside the Hub.
 */
export function ToolsPanel({ focus = false, onChanged = null }) {
  const res = useStudio("/api/media/tools", ["media.tool."]);
  const b = useBusy();
  const ref = useRef(null);
  useEffect(() => { if (focus && !res.loading) ref.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [focus, res.loading]);
  const view = res.data ? mediaToolsPanel(res.data) : null;
  const act = (action, toast) => b.run(action.type === "pin" ? "pin" : `ack-${action.path}`, async () => {
    try { await studioPost(action.path, action.body, { owner: action.owner, toast }); }
    finally { res.reload(); onChanged?.(); }
  });
  return (
    <div ref={ref} id="studio-tools" tabIndex={-1}>
      <Panel title="Unelte de randare" icon={Wrench} actions={view?.pin && (
        <button className="btn sm primary" type="button" disabled={Boolean(b.busy)} onClick={() => act(view.pin, "ffmpeg/ffprobe fixate")}>
          <Pin size={13} aria-hidden="true" />{b.busy === "pin" ? "Se fixează…" : view.pin.label}</button>
      )}>
        <p className="faint small">Randarea pornește doar cu ffmpeg și ffprobe fixate (versiune, sha256 și bibliotecile de lângă ele). Un binar schimbat îți e arătat aici; nu îl adopt singur.</p>
        {res.error && <ErrorNotice error={res.error} onRetry={res.reload} />}
        <ErrorNotice error={b.error} />
        {res.loading && !view ? <Loading lines={2} /> : view && (
          <>
            {view.missing && <Notice tone="warn" title="ffmpeg lipsește">Instalează ffmpeg și ffprobe în afara Hub-ului (de exemplu cu winget), apoi revino aici. Nu instalez nimic singur.</Notice>}
            {view.usable && <Notice tone="info">Uneltele sunt fixate; randarea poate porni.</Notice>}
            <ul className="intel-list">
              {view.rows.map((r) => (
                <li key={r.tool} className="stack tight">
                  <div className="row wrap between">
                    <span className="row wrap"><strong>{r.tool}</strong><Chip tone={r.tone}>{r.label}</Chip>{r.version && <span className="small">{r.version}</span>}</span>
                    {r.action && (
                      <button className="btn sm primary" type="button" disabled={Boolean(b.busy)} onClick={() => act(r.action, `${r.tool}: schimbarea e confirmată`)}>
                        <ShieldCheck size={13} aria-hidden="true" />{b.busy === `ack-${r.action.path}` ? "Se confirmă…" : r.action.label}</button>
                    )}
                  </div>
                  {r.sha256 && (
                    <div className="row wrap small faint">
                      <span>sha256 <Hash value={r.sha256} /></span>
                      <span>biblioteci {r.libsSha256 ? <Hash value={r.libsSha256} n={8} /> : "fără (build static)"}</span>
                      {r.pinnedAt && <span>fixat {fmt.dateTime(r.pinnedAt)}{r.pinnedBy ? ` de ${r.pinnedBy}` : ""}</span>}
                    </div>
                  )}
                  {r.state === "CHANGED" && (
                    <p className="small">Binarul de pe disc nu mai e cel fixat{r.previous?.sha256 ? <> (înainte: {r.previous.version || "?"}, <Hash value={r.previous.sha256} n={8} />)</> : null}. Dacă tu l-ai actualizat, confirmă schimbarea; altfel verifică de unde a venit.</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}
