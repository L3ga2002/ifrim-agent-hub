import { FileDiff } from "lucide-react";
import { Panel, Chip, Notice, Empty, DiffView } from "../../components/ui.jsx";
import { softwareView, isSimulated, sentence } from "../../lib/deliveryLogic.js";

/**
 * 2 · Software. The bundle, its diff, review and tests — every row bound to the exact snapshot that was verified, with an honest
 * evidence label (PASS_LOCAL / PASS_SIMULATED / PASS_LIVE / FAIL / BLOCKED / NOT_RUN / SKIPPED_ENV). When the workspace no longer
 * matches that snapshot the same rows stay visible as OLD evidence (never green): they prove the version that was tested, not the
 * code that exists now. Read-only: the acceptance itself is one of the separate decisions below.
 */
export function SoftwarePanel({ room }) {
  const sw = softwareView(room.view);
  const simulation = isSimulated(room.view);
  return (
    <Panel title="2 · Software verificat" icon={FileDiff} id="livrare-software-panel" actions={sw.present ? <Chip tone={sw.bundle.chip.tone}>{sw.bundle.chip.text}</Chip> : null}>
      {!sw.present ? <Empty title="Încă nu există un pachet de livrare">Pachetul apare când misiunea trece de verificări, review, QA, preview și E2E.</Empty> : (
        <div className="stack">
          {room.view.software?.bundleMismatch && <Notice tone="error" title="Pachet diferit">Livrarea rămâne legată de pachetul afișat mai jos. Misiunea are alt pachet; acceptarea este oprită.</Notice>}
          {!sw.current && (
            <Notice tone="error" title="Dovezi pentru versiunea veche">
              {sw.why?.text ? `${sentence(sw.why.text)} ` : ""}Testele, review-ul și criteriile de mai jos descriu pachetul <code className="mono">{sw.bundle.id}</code>, nu codul de acum.
            </Notice>
          )}
          {simulation && <Notice tone="warn" title="SIMULARE">Rezultatele vin din provideri și sandbox de test; un PASS aici este cel mult PASS_SIMULATED.</Notice>}
          <dl className="kv small delivery-ids" aria-label="Ce versiune dovedesc rezultatele">
            <dt>Pachet</dt><dd><code className="mono">{sw.bundle.id}</code>{sw.bundle.shaPrefix && <> · sha <code className="mono">{sw.bundle.shaPrefix}</code></>}</dd>
            <dt>Specificație</dt><dd>{sw.spec.version !== null ? `v${sw.spec.version}` : "—"}{sw.spec.shaPrefix && <> · sha <code className="mono">{sw.spec.shaPrefix}</code></>}</dd>
            <dt>Change set</dt><dd>{sw.changeSet.seq !== null ? `#${sw.changeSet.seq}` : "—"}{sw.changeSet.shaPrefix && <> · sha <code className="mono">{sw.changeSet.shaPrefix}</code></>}</dd>
            <dt>Snapshot verificat</dt><dd>{sw.snapshotPrefix ? <code className="mono">{sw.snapshotPrefix}</code> : <span className="faint">legat de change set-ul de mai sus</span>}</dd>
            <dt>Review independent</dt><dd><Chip tone={sw.review.chip.tone}>{sw.review.chip.text}</Chip>{sw.review.id && <> <code className="mono faint">{sw.review.id}</code></>}</dd>
          </dl>

          <section aria-labelledby="livrare-sw-files">
            <h3 id="livrare-sw-files" className="delivery-h3">Fișiere schimbate ({sw.files.length})</h3>
            {sw.files.length ? (
              <ul className="delivery-files">{sw.files.map((f) => <li key={f.path}><code className="mono">{f.path}</code> <span className="faint small">· {f.label}</span></li>)}</ul>
            ) : <p className="faint small">Pachetul nu listează fișiere schimbate.</p>}
            <details className="studio-details">
              <summary>Arată diferența (diff){sw.diff.truncated ? " — trunchiată" : ""}</summary>
              {sw.diff.truncated && <p className="small delivery-reason">Diff-ul complet e mai lung decât ce păstrează Hub-ul; aici vezi începutul lui.</p>}
              <DiffView diff={sw.diff.text} />
            </details>
          </section>

          <section aria-labelledby="livrare-sw-tests">
            <h3 id="livrare-sw-tests" className="delivery-h3">Teste și verificări ({sw.tests.length})</h3>
            {sw.tests.length ? (
              <div className="table-wrap">
                <table className="table small">
                  <thead><tr><th scope="col">Comanda</th><th scope="col">Dovadă</th><th scope="col">Trecute</th><th scope="col">Unde a rulat</th></tr></thead>
                  <tbody>
                    {sw.tests.map((t) => (
                      <tr key={t.key}>
                        <td className="mono break">{t.command || "—"}</td>
                        <td><Chip tone={t.evidence.tone}>{t.evidence.text}</Chip></td>
                        <td>{t.countsText}</td>
                        <td className="faint break">{[t.isolation, t.runner].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="faint small">Nicio verificare rulată pe acest pachet (NOT_RUN).</p>}
            <p className="faint small">Numerele vin din ieșirea testelor; unde nu există, celula rămâne „—”.</p>
          </section>

          <section aria-labelledby="livrare-sw-criteria">
            <h3 id="livrare-sw-criteria" className="delivery-h3">Criterii de acceptare ({sw.counts.pass}/{sw.counts.total} cu dovadă)</h3>
            {sw.criteria.length ? (
              <ul className="delivery-criteria">
                {sw.criteria.map((c) => (
                  <li key={c.id} className={c.pass ? undefined : "is-open"}>
                    <div className="row wrap">
                      <strong className="mono">{c.id}</strong>
                      <Chip tone={c.statusChip.tone}>{c.statusChip.text}</Chip>
                      <Chip tone={c.evidence.tone}>{c.evidence.text}</Chip>
                      <span className="faint small">{c.verifyLabel}</span>
                    </div>
                    <p className="small">{c.text}</p>
                    {c.note && <p className="small delivery-reason">{c.note}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="faint small">Specificația nu are criterii în acest pachet.</p>}
          </section>
        </div>
      )}
    </Panel>
  );
}
