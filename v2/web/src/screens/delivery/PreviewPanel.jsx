import { useState } from "react";
import { ExternalLink, MonitorPlay, MonitorSmartphone, Play, Square } from "lucide-react";
import { Panel, Chip, Notice, ErrorNotice, Empty } from "../../components/ui.jsx";
import { previewState, shotRows, softwareView, sentence, PHONE_WORDING, PHONE_CAVEAT, SYNTHETIC_BADGE } from "../../lib/deliveryLogic.js";

/**
 * 1 · Demo local. The preview of the VERIFIED version: open it (a new tab, never inside the Hub page: it is generated code running on
 * synthetic data), start it (owner session; only from the verified snapshot) or stop it, plus the start command from the bundle.
 */
export function PreviewPanel({ room }) {
  const p = previewState(room.view, { hubOrigin: room.hubOrigin, session: room.session, owner: room.owner, busy: Boolean(room.busy) });
  const sw = softwareView(room.view);
  const start = () => room.run("preview-start", () => room.client.act(room.id, "previewStart", {}), { owner: true, toast: "Preview pornit din versiunea verificată" });
  const stop = () => room.run("preview-stop", () => room.client.act(room.id, "previewStop", {}), { toast: "Preview oprit" });
  return (
    <Panel title="1 · Demo local" icon={MonitorPlay} id="livrare-demo-panel" actions={<Chip tone={p.running ? "ok" : "neutral"}>{p.running ? "rulează local" : "oprit"}</Chip>}>
      <div className="stack">
        <p className="small"><Chip tone="warn">{SYNTHETIC_BADGE}</Chip> {p.note}</p>
        {p.running ? (
          <div className="stack tight">
            {p.url ? (
              <p>Demo-ul rulează pe acest calculator la <code className="mono">{p.url}</code>{sw.snapshotPrefix ? <> · din snapshot-ul <code className="mono">{sw.snapshotPrefix}</code></> : null}.</p>
            ) : (
              <Notice tone="warn" title="Adresa de preview nu poate fi deschisă de aici">Hub-ul a raportat „{p.rawUrl || "—"}”. Deschid doar o adresă locală (127.0.0.1 sau localhost, cu port) care nu este Hub-ul însuși.</Notice>
            )}
            <div className="row wrap">
              {p.open.enabled && <a className="btn primary" href={p.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Deschide preview-ul<span className="sr-only"> (filă nouă)</span></a>}
              <button type="button" className="btn" disabled={!p.stop.enabled} onClick={stop}><Square size={14} aria-hidden="true" />{room.busy === "preview-stop" ? "Se oprește…" : p.stop.label}</button>
            </div>
          </div>
        ) : (
          <div className="stack tight">
            <div className="row wrap">
              <button type="button" className="btn primary" disabled={!p.start.enabled} onClick={start} aria-describedby={p.start.reason ? "livrare-preview-reason" : undefined}>
                <Play size={15} aria-hidden="true" />{room.busy === "preview-start" ? "Se pornește…" : p.start.label}
              </button>
            </div>
            {p.start.reason && <p id="livrare-preview-reason" className="small delivery-reason">{p.start.reason}</p>}
          </div>
        )}
        <ErrorNotice error={room.errorOf("preview-start") || room.errorOf("preview-stop")} />
        <dl className="kv small">
          <dt>Cum îl pornești tu</dt>
          <dd>{p.startCommand ? <>în folderul proiectului: <code className="mono">{p.startCommand}</code> <span className="faint">(comanda din pachetul de livrare)</span></> : <span className="faint">pachetul nu are o comandă de pornire</span>}</dd>
          <dt>Adresa locală</dt>
          <dd>{p.url ? <code className="mono">{p.url}</code> : <span className="faint">{p.rawUrl || "—"}</span>}</dd>
          <dt>Versiunea</dt>
          <dd>{sw.present ? <><code className="mono">{sw.bundle.id}</code>{sw.bundle.shaPrefix && <> · sha <code className="mono">{sw.bundle.shaPrefix}</code></>}</> : <span className="faint">încă nu există un pachet verificat</span>}</dd>
        </dl>
      </div>
    </Panel>
  );
}

/** One E2E screenshot. The image is fetched only when it is shown; a file that is gone says so instead of a broken picture. */
function Shot({ row }) {
  const [failed, setFailed] = useState(false);
  if (!row.src) return <p className="faint small">Fără imagine pentru această verificare.</p>;
  if (failed) return <p className="small delivery-reason">Captura nu mai este disponibilă pe disc.</p>;
  return <img className="delivery-shot-img" src={row.src} alt={row.alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** A screenshot of an older version: collapsed, and its image is not even requested until the owner opens it. */
function OldShot({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="delivery-old" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Captură pentru versiunea veche — nu dovedește codul nou</summary>
      <p className="small delivery-reason">{sentence(row.why?.text)}</p>
      {open && <Shot row={row} />}
    </details>
  );
}

/**
 * 3 · Preview pe desktop și la lățimea unui telefon: the E2E screenshot of each criterion, with its criterion, honest viewport wording
 * and evidence label. The narrow viewport is always named as a width in Chromium — it is not a phone and has no touch.
 */
export function ShotsPanel({ room }) {
  const rows = shotRows(room.view);
  const anyPhone = rows.some((r) => r.phone);
  return (
    <Panel title={`3 · Preview pe desktop și la ${PHONE_WORDING}`} icon={MonitorSmartphone} id="livrare-capturi-panel">
      {!rows.length ? <Empty title="Nicio captură E2E">Capturile apar după ce verificarea în browser rulează pe versiunea testată.</Empty> : (
        <div className="stack">
          <ul className="delivery-shots">
            {rows.map((row) => (
              <li key={row.key} className={`delivery-shot${row.phone ? " is-phone" : ""}${row.current ? "" : " is-old"}`}>
                <figure>
                  {row.current ? <Shot row={row} /> : <OldShot row={row} />}
                  <figcaption className="stack tight">
                    <span className="row wrap">
                      <Chip tone="neutral">{row.criterion || "criteriu"}</Chip>
                      <Chip tone={row.evidence.tone}>{row.evidence.text}</Chip>
                    </span>
                    <span className="small"><strong>{row.wording}</strong>{row.caveat && <span className="faint"> — {row.caveat}</span>}</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
          <p className="faint small">
            Capturile sunt făcute de verificarea automată în Chromium, pe demo-ul local cu date sintetice.
            {anyPhone ? ` „Telefon” înseamnă aici ${PHONE_WORDING} (${PHONE_CAVEAT}).` : ` Nu există nicio captură la ${PHONE_WORDING}.`}
          </p>
        </div>
      )}
    </Panel>
  );
}
