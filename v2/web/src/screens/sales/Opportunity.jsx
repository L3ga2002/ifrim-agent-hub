import { useState, useCallback } from "react";
import { ChevronLeft, FileText, Mail, Send, PenLine, PhoneCall, Handshake, Rocket, CalendarClock, History, ShieldCheck, ClipboardCheck } from "lucide-react";
import { api } from "../../api.js";
import { pushToast, useResource, useAction } from "../../store.js";
import { useViewport } from "../../components/Layout.jsx";
import { Panel, Empty, Loading, ErrorNotice, Notice } from "../../components/ui.jsx";
import {
  oppView, orgView, proposalView, draftView, contactView, followupView, transitionView, handoffView, listOf, newestFirst, statusMeta, salesHref,
  OUTREACH_DISABLED_REASON, confirmationText, confirmationMatches, acceptanceReadiness, contactReadiness, handoffReadiness, handoffMissionId,
  oppManualTargets, followupState, FOLLOWUP_STATE_META, CONTACT_CHANNELS, contactChannelLabel, textExcerpt, proposalApproved, proposalApprovalReadiness,
  hasRealContact, followupPayload, followupDraftable, FOLLOWUP_BASIS_RO, FOLLOWUP_DAYS, REASON_MIN, approvalFrom, draftReadiness, draftBasis,
} from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource, useSalesCommand, ApprovalGate, SalesError, when, localNowInput, inputToIso } from "./common.jsx";

import { ProposalDecision } from "./ProposalDecision.jsx";
import { Preparation } from "./Preparation.jsx";

const opPath = (id) => `/api/sales/opportunities/${encodeURIComponent(id)}`;

/**
 * One proposal version: sections as plain text, claims to verify, warnings. The internal approval is ALWAYS_ASK and bound
 * to the displayed content hash (`displayedSha` = the server's `contentSha`); it is offered for the latest DRAFT version
 * once the opportunity is "ready for review". Also shown on the Lega screen (one L3ga screen, 2026-10-18), the same view.
 */
export function ProposalView({ opp, proposal, proposals, onChanged }) {
  const review = useSalesCommand(useCallback(async () => { pushToast("sales-proposal-review", "ok", "Propunerea e gata de revizuire"); onChanged(); }, [onChanged]));
  const ready = proposalApprovalReadiness(opp, proposal, proposals);
  const approved = proposalApproved(proposal);
  return (
    <div className="stack tight">
      <div className="row wrap"><strong className="break">{proposal.title || `Propunere v${proposal.version}`}</strong><SalesChip kind="proposal" status={proposal.status} /><span className="faint small mono" title="Amprenta conținutului afișat">{proposal.sha.slice(0, 12) || "—"}</span></div>
      {proposal.warnings.length > 0 && <Notice tone="warn" title="Atenționări">{proposal.warnings.join(" · ")}</Notice>}
      {proposal.sections.length ? proposal.sections.map((s) => (
        <section key={s.id || s.heading} className="sales-section">
          <h4>{s.heading || s.id}</h4>
          <div className="prewrap">{s.text || "—"}</div>
        </section>
      )) : proposal.text ? <div className="prewrap sales-draft-body">{proposal.text}</div> : <p className="faint" style={{ margin: 0 }}>Propunerea nu are conținut.</p>}
      {proposal.claimsToVerify.length > 0 && <div className="sales-claims"><div className="section-title">De verificat înainte de a o folosi</div><ul className="plain-list small">{proposal.claimsToVerify.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {proposal.usedEvidenceIds.length > 0 && <div className="faint small break">Dovezi folosite: <span className="mono">{proposal.usedEvidenceIds.join(", ")}</span></div>}
      {approved && <div className="faint small">Aprobată intern pentru amprenta <span className="mono">{proposal.approvedSha.slice(0, 12)}</span>{proposal.approvedAt ? ` · ${when(proposal.approvedAt)}` : ""}. Nu e acceptarea clientului.</div>}
      {ready.needsReview && (
        <div className="row wrap">
          <button type="button" className="btn sm" disabled={review.busy} onClick={() => review.run(`${opPath(opp.id)}/transition`, { to: "READY_FOR_OWNER_REVIEW", reason: `Propunerea v${proposal.version} e gata de revizuire` })}><ClipboardCheck size={14} aria-hidden="true" />{review.busy ? "Se marchează…" : "Marchează gata de revizuire"}</button>
          <span className="faint small">Apoi ceri aprobarea internă a acestei versiuni.</span>
        </div>
      )}
      <ProposalDecision opp={opp} proposal={proposal} proposals={proposals} onChanged={onChanged} />
      {!ready.ok && !ready.needsReview && ready.reason && <p className="faint small" style={{ margin: 0 }}>{ready.reason}</p>}
      <ErrorNotice error={review.error} />
    </div>
  );
}

function Proposals({ opp, proposals, suppressed, onChanged }) {
  const [selected, setSelected] = useState(null);
  const create = useSalesCommand(useCallback(async () => { setSelected(null); pushToast("sales-proposal-new", "ok", "Versiune nouă de propunere"); onChanged(); }, [onChanged]));
  const sorted = proposals.slice().sort((a, b) => b.version - a.version);
  const current = sorted.find((p) => p.id === selected) || sorted[0] || null;
  // The server refuses LOST and do-not-contact; a WON opportunity may get a new version (a scope change that outdates the hand-off).
  const blocked = opp.status === "LOST" || suppressed;
  return (
    <Panel title={`Propuneri (${proposals.length})`} icon={FileText}
      actions={<button type="button" className="btn sm" disabled={create.busy || blocked} title={blocked ? "Oportunitatea e pierdută sau firma e „Nu contacta”" : ""} onClick={() => create.run(`${opPath(opp.id)}/proposals`, {})}>{create.busy ? "Se generează…" : sorted.length ? "Versiune nouă" : "Generează propunerea"}</button>}>
      <div className="stack">
        {opp.status === "WON" && sorted.length > 0 && <p className="faint small" style={{ margin: 0 }}>O versiune nouă după acceptare e o schimbare de scope: handoff-ul existent devine depășit.</p>}
        {sorted.length > 1 && (
          <div className="seg wrap" role="group" aria-label="Versiunea propunerii">
            {sorted.map((p) => <button key={p.id} type="button" aria-pressed={current?.id === p.id} onClick={() => setSelected(p.id)}>v{p.version} · {statusMeta("proposal", p.status).label}</button>)}
          </div>
        )}
        {current ? <ProposalView key={`${current.id}:${current.sha}`} opp={opp} proposal={current} proposals={proposals} onChanged={onChanged} /> : <Empty title="Nicio propunere">Propunerea se generează din datele verificate ale firmei și din catalog. Prețul și termenul apar doar dacă sunt configurate.</Empty>}
        <ErrorNotice error={create.error} />
        <ApprovalGate gate={create.approval} onDone={() => { create.clearApproval(); onChanged(); }} onDismiss={create.clearApproval} />
      </div>
    </Panel>
  );
}

/** A contact draft for review: subject, body, claims to verify, personalization basis; Send stays disabled in M04. */
function DraftCard({ draft, basis, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const revise = useSalesCommand(useCallback(async () => { setEditing(false); pushToast("sales-draft", "ok", "Ciornă revizuită (versiune nouă; aprobările vechi nu se mai aplică)"); onChanged(); }, [onChanged]));
  const approve = useSalesCommand(useCallback(async () => { pushToast("sales-draft-approve", "ok", "Conținut aprobat (nu s-a trimis nimic)"); onChanged(); }, [onChanged]), { owner: true });
  // A draft built on a proposal that changed since (or of a closed opportunity) is no longer approved, revised or sent.
  const open = ["DRAFT", "CONTENT_APPROVED"].includes(draft.status) && basis.ok;
  const changed = subject.trim() !== draft.subject.trim() || body.trim() !== draft.body.trim();
  const reasonId = `send-reason-${draft.id}`;
  return (
    <article className="sales-draft" aria-label={`Ciorna v${draft.version}`}>
      <div className="row wrap"><strong>v{draft.version}</strong><SalesChip kind="draft" status={draft.status} /><span className="faint small break">{draft.channel}{draft.recipients.length ? ` · către ${draft.recipients.join(", ")}` : ""}</span><span className="faint small mono" title="Amprenta textului afișat">{draft.sha.slice(0, 12)}</span></div>
      {!editing ? (
        <>
          <div className="sales-draft-subject break"><span className="faint small">Subiect: </span>{draft.subject || "—"}</div>
          <div className="sales-draft-body prewrap">{draft.body || "—"}</div>
        </>
      ) : (
        <div className="stack tight">
          <label className="field"><span>Subiect</span><input className="input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span>Text</span><textarea className="textarea" rows={10} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="row wrap">
            <button type="button" className="btn sm primary" disabled={!changed || revise.busy || !subject.trim() || !body.trim()}
              onClick={() => revise.run(`/api/sales/drafts/${encodeURIComponent(draft.id)}/revise`, { subject: subject.trim(), body: body.trim() })}>{revise.busy ? "Se salvează…" : "Salvează ca versiune nouă"}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setEditing(false); setSubject(draft.subject); setBody(draft.body); }}>Renunță</button>
          </div>
        </div>
      )}
      {draft.claimsToVerify.length > 0 && <div className="sales-claims"><div className="section-title">De verificat înainte de orice contact</div><ul className="plain-list small">{draft.claimsToVerify.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      <div>
        <div className="section-title">Baza personalizării</div>
        {draft.personalizationBasis.length ? <ul className="plain-list small">{draft.personalizationBasis.map((p, i) => <li key={i} className="break">{p.text}{p.evidenceId && <span className="faint mono"> [{p.evidenceId}]</span>}</li>)}</ul>
          : <p className="faint small" style={{ margin: 0 }}>Fără personalizare: textul e o introducere generală, fără afirmații despre site.</p>}
      </div>
      {draft.approvedSha && <div className="faint small">Conținut aprobat pentru amprenta <span className="mono">{draft.approvedSha.slice(0, 12)}</span></div>}
      {!basis.ok && <Notice tone="warn">{basis.reason}</Notice>}
      <div className="row wrap">
        {open && !editing && <button type="button" className="btn sm" onClick={() => setEditing(true)}><PenLine size={14} aria-hidden="true" />Revizuiește</button>}
        {draft.status === "DRAFT" && basis.ok && !editing && <button type="button" className="btn sm approve" disabled={approve.busy} onClick={() => approve.run(`/api/sales/drafts/${encodeURIComponent(draft.id)}/approve-content`, { displayedSha: draft.sha })}><ShieldCheck size={14} aria-hidden="true" />{approve.busy ? "Se cere…" : "Aprobă conținutul"}</button>}
        <button type="button" className="btn sm" disabled aria-describedby={reasonId}><Send size={14} aria-hidden="true" />Trimite</button>
      </div>
      <p id={reasonId} className="faint small sales-send-reason">{OUTREACH_DISABLED_REASON}</p>
      <ErrorNotice error={revise.error || approve.error} />
      <ApprovalGate gate={approve.approval || revise.approval} onDone={() => { approve.clearApproval(); revise.clearApproval(); onChanged(); }} onDismiss={() => { approve.clearApproval(); revise.clearApproval(); }} />
    </article>
  );
}

/**
 * Drafts: e-mail contacts come with the opportunity (`contacts`, active only); without a choice the Hub takes the first active
 * e-mail. A draft is generated only from the LATEST proposal, approved internally, for an open opportunity.
 */
function Drafts({ opp, org, drafts, contacts, proposals, suppressed, onChanged }) {
  const [contactId, setContactId] = useState("");
  const create = useSalesCommand(useCallback(async () => { pushToast("sales-draft-new", "ok", "Ciornă nouă (nu s-a trimis nimic)"); onChanged(); }, [onChanged]));
  const emails = contacts.filter((c) => c.kind === "email" && c.status === "ACTIVE");
  const ready = draftReadiness(opp, proposals, { suppressed, orgStatus: org.status, emails });
  const visible = drafts.filter((d) => !["SUPERSEDED", "CANCELLED"].includes(d.status));
  const older = drafts.length - visible.length;
  const blocked = org.status === "DO_NOT_CONTACT" || suppressed;
  return (
    <Panel title={`Ciorne de contact (${visible.length})`} icon={Mail}>
      <div className="stack">
        {blocked && <Notice tone="error">Firma e marcată „Nu contacta”: nu se pregătesc ciorne.</Notice>}
        {!blocked && (
          <div className="sales-inline-form">
            <label className="field grow"><span>Destinatar (e-mail al firmei)</span>
              <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!emails.length || !ready.ok}>
                <option value="">{emails.length ? "Primul e-mail activ al firmei" : "Firma nu are e-mail activ"}</option>
                {emails.map((c) => <option key={c.id} value={c.id}>{c.value}{c.generic ? " (generic)" : ""}</option>)}
              </select>
            </label>
            <button type="button" className="btn sm" disabled={create.busy || !ready.ok} aria-describedby={!ready.ok ? `draft-reason-${opp.id}` : undefined}
              onClick={() => create.run(`${opPath(opp.id)}/drafts`, { ...(contactId ? { contactId } : {}), proposalId: ready.proposal.id })}>{create.busy ? "Se pregătește…" : "Pregătește o ciornă"}</button>
          </div>
        )}
        {!blocked && !ready.ok && <p id={`draft-reason-${opp.id}`} className="faint small" style={{ margin: 0 }}>{ready.reason}</p>}
        <ErrorNotice error={create.error} />
        <ApprovalGate gate={create.approval} onDone={() => { create.clearApproval(); onChanged(); }} onDismiss={create.clearApproval} />
        {visible.length ? visible.map((d) => <DraftCard key={`${d.id}:${d.sha}`} draft={d} basis={draftBasis(d, opp, proposals)} onChanged={onChanged} />) : <Empty title="Nicio ciornă activă">Ciornele rămân în Hub: trimiterea e dezactivată în M04.</Empty>}
        {older > 0 && <p className="faint small" style={{ margin: 0 }}>{older} versiuni mai vechi (înlocuite sau anulate) sunt păstrate în istoric.</p>}
      </div>
    </Panel>
  );
}

/** Typed confirmation sentence: the record is only sent when it matches exactly (case and spacing aside). */
function ConfirmField({ expected, value, onChange, id }) {
  const ok = confirmationMatches(value, expected);
  return (
    <label className="field" htmlFor={id}>
      <span>Scrie exact: „{expected}”</span>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={value ? !ok : undefined} />
      {value && !ok && <span className="faint small">Textul nu se potrivește încă (diacriticele contează).</span>}
    </label>
  );
}

/**
 * A reply from the client (CONTACTED → IN_DISCUSSION, follow-ups suspended) or an opposition to contact (OPT_OUT: the
 * company becomes DO_NOT_CONTACT at once; drafts are cancelled and follow-ups suspended). Both are things that happened
 * outside the Hub, recorded by the owner.
 */
function ReplyOrOptOut({ opp, org, onChanged }) {
  const [kind, setKind] = useState("REPLY_RECORDED");
  const [at, setAt] = useState(localNowInput());
  const [note, setNote] = useState("");
  const cmd = useSalesCommand(useCallback(async (_r, k) => {
    setNote(""); setAt(localNowInput());
    pushToast("sales-reply", k === "OPT_OUT" ? "warn" : "ok", k === "OPT_OUT" ? "Opoziția a fost înregistrată: firma e „Nu contacta”" : "Răspuns înregistrat");
    onChanged();
  }, [onChanged]));
  if (opp.status === "LOST" || org.status === "DO_NOT_CONTACT") return null;
  const iso = inputToIso(at);
  const valid = iso && Date.parse(iso) <= Date.now() + 60_000 && (kind !== "OPT_OUT" || note.trim().length >= 3);
  return (
    <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (valid) cmd.run(`${opPath(opp.id)}/contact-events`, { kind, occurredAt: iso, note: note.trim() }, kind); }}>
      <div className="section-title">Răspuns sau opoziție a firmei</div>
      <div className="seg wrap" role="group" aria-label="Ce s-a întâmplat">
        <button type="button" aria-pressed={kind === "REPLY_RECORDED"} onClick={() => setKind("REPLY_RECORDED")}>A răspuns</button>
        <button type="button" aria-pressed={kind === "OPT_OUT"} onClick={() => setKind("OPT_OUT")}>Nu dorește să fie contactată</button>
      </div>
      <div className="grid two">
        <label className="field"><span>Când</span><input className="input" type="datetime-local" value={at} max={localNowInput()} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="field"><span>{kind === "OPT_OUT" ? "Ce a spus (obligatoriu)" : "Notă (opțional)"}</span><input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {kind === "OPT_OUT" && <p className="warn-text small" style={{ margin: 0 }}>Firma devine imediat „Nu contacta”: ciornele se anulează, follow-up-urile se suspendă, iar la un reimport e recunoscută. Ridicarea cere aprobarea ta.</p>}
      <div><button type="submit" className={`btn sm ${kind === "OPT_OUT" ? "danger" : ""}`} disabled={!valid || cmd.busy}>{cmd.busy ? "Se înregistrează…" : kind === "OPT_OUT" ? "Înregistrează opoziția" : "Înregistrează răspunsul"}</button></div>
      <ErrorNotice error={cmd.error} />
    </form>
  );
}

function ContactAndAcceptance({ opp, org, proposals, contactEvents, acceptances, overview, onChanged }) {
  const contactReady = contactReadiness(opp, org);
  const acceptReady = acceptanceReadiness(opp, proposals, contactEvents);
  // The exact sentences the Hub checks (overview.confirmations); the typed text must match them before anything is sent.
  const contactExpected = confirmationText(overview, "manualContact");
  const acceptExpected = confirmationText(overview, "clientAcceptance");
  const [c, setC] = useState({ channel: "phone", at: localNowInput(), note: "", confirm: "" });
  const [a, setA] = useState({ at: localNowInput(), note: "", confirm: "" });
  const contact = useSalesCommand(useCallback(async () => { setC({ channel: "phone", at: localNowInput(), note: "", confirm: "" }); pushToast("sales-contact", "ok", "Contact manual înregistrat"); onChanged(); }, [onChanged]));
  const accept = useSalesCommand(useCallback(async () => { setA({ at: localNowInput(), note: "", confirm: "" }); pushToast("sales-accept", "ok", "Acceptarea clientului a fost înregistrată"); onChanged(); }, [onChanged]));
  const contactAt = inputToIso(c.at);
  const acceptAt = inputToIso(a.at);
  const future = (iso) => iso && Date.parse(iso) > Date.now() + 60_000;
  const contactValid = contactReady.ok && contactAt && !future(contactAt) && confirmationMatches(c.confirm, contactExpected);
  const acceptValid = acceptReady.ok && acceptAt && !future(acceptAt) && confirmationMatches(a.confirm, acceptExpected);
  const base = opPath(opp.id);
  return (
    <Panel title="Contact și acceptare" icon={PhoneCall}>
      <div className="stack">
        {contactEvents.length > 0 && (
          <div><div className="section-title">Contacte înregistrate</div>
            <ul className="plain-list small">{contactEvents.map((e, i) => <li key={e.id || i} className="break">{when(e.occurredAt)} · {statusMeta("contactEvent", e.kind).label}{e.channel ? ` · ${contactChannelLabel(e.channel)}` : ""}{e.note ? ` — ${textExcerpt(e.note, 200)}` : ""}</li>)}</ul></div>
        )}
        <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (contactValid) contact.run(`${base}/contact-events`, { kind: "MANUAL_RECORDED", channel: c.channel, occurredAt: contactAt, note: c.note.trim(), confirmText: contactExpected }); }}>
          <div className="section-title">Înregistrează un contact făcut de tine</div>
          {!contactReady.ok && <p className="faint small" style={{ margin: 0 }}>{contactReady.reason}</p>}
          <div className="grid two">
            <label className="field"><span>Canal</span><select className="select" value={c.channel} disabled={!contactReady.ok} onChange={(e) => setC({ ...c, channel: e.target.value })}>{CONTACT_CHANNELS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
            <label className="field"><span>Când</span><input className="input" type="datetime-local" value={c.at} max={localNowInput()} disabled={!contactReady.ok} onChange={(e) => setC({ ...c, at: e.target.value })} /></label>
          </div>
          <label className="field"><span>Ce s-a discutat (opțional)</span><textarea className="textarea" rows={2} maxLength={1000} value={c.note} disabled={!contactReady.ok} onChange={(e) => setC({ ...c, note: e.target.value })} /></label>
          {contactReady.ok && <ConfirmField id={`confirm-contact-${opp.id}`} expected={contactExpected} value={c.confirm} onChange={(v) => setC({ ...c, confirm: v })} />}
          <div><button type="submit" className="btn sm" disabled={!contactValid || contact.busy}>{contact.busy ? "Se înregistrează…" : "Înregistrează contactul"}</button></div>
          <ErrorNotice error={contact.error} />
          <ApprovalGate gate={contact.approval} onDone={() => { contact.clearApproval(); onChanged(); }} onDismiss={contact.clearApproval} />
        </form>

        <ReplyOrOptOut opp={opp} org={org} onChanged={onChanged} />

        {acceptances.length > 0 && (
          <div><div className="section-title">Acceptări</div>
            <ul className="plain-list small">{acceptances.map((x, i) => <li key={x.id || i} className="break">{when(x.acceptedAt)} · propunerea <span className="mono">{String(x.proposalSha || "").slice(0, 12)}</span>{x.note ? ` — ${textExcerpt(x.note, 200)}` : ""}</li>)}</ul></div>
        )}
        <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (acceptValid) accept.run(`${base}/acceptance`, { proposalId: acceptReady.proposal.id, acceptedAt: acceptAt, note: a.note.trim(), confirmText: acceptExpected }); }}>
          <div className="section-title"><Handshake size={13} aria-hidden="true" /> Acceptarea clientului</div>
          {!acceptReady.ok ? <p className="faint small" style={{ margin: 0 }}>{acceptReady.reason}</p> : (
            <>
              <p className="faint small" style={{ margin: 0 }}>Pentru propunerea v{acceptReady.proposal.version} (<span className="mono">{acceptReady.proposal.sha.slice(0, 12)}</span>). Doar acceptarea înregistrată de tine face oportunitatea „{statusMeta("opp", "WON").label}”.</p>
              <div className="grid two">
                <label className="field"><span>Când a acceptat</span><input className="input" type="datetime-local" value={a.at} max={localNowInput()} onChange={(e) => setA({ ...a, at: e.target.value })} /></label>
                <label className="field"><span>Notă (cum a acceptat)</span><input className="input" value={a.note} maxLength={1000} onChange={(e) => setA({ ...a, note: e.target.value })} /></label>
              </div>
              <ConfirmField id={`confirm-accept-${opp.id}`} expected={acceptExpected} value={a.confirm} onChange={(v) => setA({ ...a, confirm: v })} />
              <div><button type="submit" className="btn sm primary" disabled={!acceptValid || accept.busy}>{accept.busy ? "Se înregistrează…" : "Înregistrează acceptarea"}</button></div>
            </>
          )}
          <ErrorNotice error={accept.error} />
          <ApprovalGate gate={accept.approval} onDone={() => { accept.clearApproval(); onChanged(); }} onDismiss={accept.clearApproval} />
        </form>
      </div>
    </Panel>
  );
}

/**
 * Engineering hand-off (idempotent on the server: one per accepted version). Without a project only the package is
 * recorded; with a project the Hub also creates a Software Factory mission there, as a draft (spec v1 DRAFT, no grant, no
 * run) that starts only after the scope is approved. A package-only hand-off gets its mission later on the same row.
 */
function HandoffPanel({ opp, handoffs, proposals, acceptances, onChanged }) {
  const [projectId, setProjectId] = useState("");
  const projectsRes = useResource("/api/projects", { reloadOn: (e) => String(e?.type || "").startsWith("project") });
  const projects = listOf(projectsRes.data, "projects");
  const views = handoffs.map(handoffView);
  const ready = handoffReadiness(opp, handoffs, { proposals, acceptances });
  const run = useAction(async () => {
    const result = await api(`${opPath(opp.id)}/handoff`, { method: "POST", body: projectId ? { projectId } : {} });
    if (approvalFrom(result)) return;
    const missionId = handoffMissionId(result);
    setProjectId("");
    pushToast("sales-handoff", "ok", result?.existing && !ready.needsProject ? "Handoff-ul exista deja pentru această versiune" : missionId ? "Ciorna Engineering a fost creată (nimic nu rulează)" : "Pachetul de handoff a fost înregistrat");
    onChanged();
  });
  const projectName = (id) => projects.find((p) => p.id === id)?.name || "";
  const needsProject = Boolean(ready.ok && ready.needsProject);
  return (
    <Panel title="Handoff spre Engineering" icon={Rocket}>
      <div className="stack tight">
        {views.map((h) => (
          <div key={h.id} className="stack tight">
            <div className="row wrap"><SalesChip kind="handoff" status={h.status} /><span className="faint small">{when(h.createdAt)}</span>
              {h.missionId ? <a className="btn sm" href={`#/missions/${encodeURIComponent(h.missionId)}`}>Deschide misiunea</a> : <span className="faint small">doar pachetul (fără misiune legată încă)</span>}</div>
            {h.outdated && <p className="warn-text small" style={{ margin: 0 }}>{h.note || "Propunerea s-a schimbat după predare: e nevoie de o decizie nouă de scope."}</p>}
          </div>
        ))}
        {ready.ok ? (
          <>
            <p className="faint small" style={{ margin: 0 }}>{needsProject ? ready.reason : "Se creează pachetul de handoff din propunerea acceptată (scope, excluderi, criterii, întrebări deschise). Dacă alegi un proiect, Hub-ul creează în el și o misiune Software Factory în ciornă."} Nimic nu rulează până aprobi scope-ul acolo; nu se creează granturi.</p>
            <label className="field"><span>Proiectul în care se creează ciorna Engineering</span>
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={projectsRes.loading && !projectsRes.data}>
                <option value="">{needsProject ? "Alege proiectul…" : "Fără proiect: doar pachetul de handoff"}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}{p.executionAllowed ? "" : " (fără execuție activată)"}</option>)}
              </select>
            </label>
            {projectId && <p className="faint small" style={{ margin: 0 }}>Ciorna se creează în „{projectName(projectId)}”, ca misiune Software Factory în starea de specificație (DRAFT).</p>}
            <div><button type="button" className="btn sm primary" disabled={run.pending || (needsProject && !projectId)} onClick={run.run}>
              {run.pending ? "Se creează…" : needsProject ? "Creează misiunea" : projectId ? "Creează handoff-ul și ciorna Engineering" : "Creează pachetul de handoff"}</button></div>
          </>
        ) : !views.length || views.every((h) => h.outdated) ? <p className="faint small" style={{ margin: 0 }}>{ready.reason}</p> : null}
        <ErrorNotice error={run.error || projectsRes.error} />
      </div>
    </Panel>
  );
}

/** Follow-ups: N days after the last real contact, or on a chosen date; a DUE one can get a draft (nothing is sent). */
function OppFollowups({ opp, followups, contactEvents, proposals, orgStatus, suppressed, onChanged }) {
  const real = hasRealContact(contactEvents);
  const [basis, setBasis] = useState(real ? "last_contact" : "explicit_date");
  const [days, setDays] = useState("3");
  const [due, setDue] = useState("");
  const add = useSalesCommand(useCallback(async (result) => { setDue(""); pushToast("sales-followup", result?.duplicate ? "info" : "ok", result?.duplicate ? "Follow-up-ul exista deja la acea dată" : "Follow-up programat"); onChanged(); }, [onChanged]));
  const draft = useSalesCommand(useCallback(async () => { pushToast("sales-followup-draft", "ok", "Ciornă de follow-up pregătită (nu s-a trimis nimic)"); onChanged(); }, [onChanged]));
  const effectiveBasis = basis === "last_contact" && !real ? "explicit_date" : basis;
  const payload = followupPayload({ basis: effectiveBasis, afterDays: days, dueAt: inputToIso(due) }, { contactEvents });
  const closed = ["WON", "LOST"].includes(opp.status) || suppressed;
  const draftReady = draftReadiness(opp, proposals, { suppressed, orgStatus });
  return (
    <Panel title={`Follow-up (${followups.length})`} icon={CalendarClock}>
      <div className="stack tight">
        {followups.length ? <ul className="plain-list small">{followups.map((f) => {
          const s = FOLLOWUP_STATE_META[followupState(f)];
          return (
            <li key={f.id} className="row wrap">
              <span className={`chip ${s.tone}`}>{s.label}</span><SalesChip kind="followup" status={f.status} /><span>{when(f.dueAt)}</span>
              {f.basis && <span className="faint">· {FOLLOWUP_BASIS_RO[f.basis] || f.basis}</span>}
              {f.reason && <span className="faint">· {f.reason}</span>}
              {f.draftId && <span className="faint">· ciornă pregătită</span>}
              {followupDraftable(f) && f.status === "DUE" && <button type="button" className="btn sm" disabled={draft.busy || !draftReady.ok} title={draftReady.ok ? "" : draftReady.reason} onClick={() => draft.run(`/api/sales/followups/${encodeURIComponent(f.id)}/draft`, {})}>{draft.busy ? "Se pregătește…" : "Pregătește ciorna"}</button>}
            </li>
          );
        })}</ul> : <p className="faint small" style={{ margin: 0 }}>Niciun follow-up.</p>}
        {!closed && (
          <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (payload.ok) add.run(`${opPath(opp.id)}/followups`, payload.body); }}>
            <div className="seg wrap" role="group" aria-label="Baza follow-up-ului">
              <button type="button" aria-pressed={effectiveBasis === "last_contact"} disabled={!real} title={real ? "" : "Nu există încă un contact real înregistrat"} onClick={() => setBasis("last_contact")}>După ultimul contact</button>
              <button type="button" aria-pressed={effectiveBasis === "explicit_date"} onClick={() => setBasis("explicit_date")}>La o dată</button>
            </div>
            <div className="sales-inline-form">
              {effectiveBasis === "last_contact" ? (
                <label className="field"><span>Zile după contact ({FOLLOWUP_DAYS.min}–{FOLLOWUP_DAYS.max})</span><input className="input" type="number" min={FOLLOWUP_DAYS.min} max={FOLLOWUP_DAYS.max} step={1} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
              ) : (
                <label className="field"><span>Data</span><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              )}
              <button type="submit" className="btn sm" disabled={!payload.ok || add.busy}>{add.busy ? "Se programează…" : "Programează"}</button>
            </div>
            {!payload.ok && (effectiveBasis === "last_contact" || due) && <p className="faint small" style={{ margin: 0 }}>{payload.reason}</p>}
            <p className="faint small" style={{ margin: 0 }}>Follow-up-ul e o sarcină pentru tine: Hub-ul nu trimite nimic automat.</p>
          </form>
        )}
        <ErrorNotice error={add.error || draft.error} />
        <ApprovalGate gate={add.approval || draft.approval} onDone={() => { add.clearApproval(); draft.clearApproval(); onChanged(); }} onDismiss={() => { add.clearApproval(); draft.clearApproval(); }} />
      </div>
    </Panel>
  );
}

function OppTransitions({ opp, transitions, contactEvents, onChanged }) {
  const targets = oppManualTargets(opp.status, { realContact: hasRealContact(contactEvents) });
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const cmd = useSalesCommand(useCallback(async () => { setTo(""); setReason(""); onChanged(); }, [onChanged]));
  return (
    <Panel title="Istoric de stări" icon={History}>
      <div className="stack tight">
        {transitions.length ? <ul className="list">{transitions.map((t, i) => (
          <li key={`${t.at}${t.to}${i}`}><div className="list-row sales-transition"><span className="nowrap small">{t.from ? statusMeta("opp", t.from).label : "—"} → <strong>{statusMeta("opp", t.to).label}</strong></span><span className="grow faint small break">{t.reason}</span><span className="faint small nowrap">{t.actor} · {when(t.at)}</span></div></li>
        ))}</ul> : <p className="faint small" style={{ margin: 0 }}>Nicio tranziție.</p>}
        {targets.length > 0 && (
          <form className="sales-inline-form" onSubmit={(e) => { e.preventDefault(); if (to && reason.trim().length >= REASON_MIN.transition) cmd.run(`${opPath(opp.id)}/transition`, { to, reason: reason.trim() }); }}>
            <label className="field"><span>Stare nouă</span><select className="select" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Alege…</option>{targets.map((s) => <option key={s} value={s}>{statusMeta("opp", s).label}</option>)}</select></label>
            <label className="field grow"><span>Motiv (min. {REASON_MIN.transition} caractere)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="submit" className="btn sm" disabled={!to || reason.trim().length < REASON_MIN.transition || cmd.busy}>Schimbă starea</button>
          </form>
        )}
        <p className="faint small" style={{ margin: 0 }}>„{statusMeta("opp", "APPROVED_INTERNAL").label}” vine din aprobarea propunerii, „{statusMeta("opp", "CONTACTED").label}” dintr-un contact înregistrat, iar „{statusMeta("opp", "WON").label}” din acceptarea clientului; nu se aleg manual.</p>
        <ErrorNotice error={cmd.error} />
        <ApprovalGate gate={cmd.approval} onDone={() => { cmd.clearApproval(); onChanged(); }} onDismiss={cmd.clearApproval} />
      </div>
    </Panel>
  );
}

/** Oportunitate: proposals, drafts, contact/acceptance, hand-off, follow-ups, history. On a phone the drafts come first. */
export function Opportunity({ id, overview }) {
  const res = useSalesResource(`/api/sales/opportunities/${encodeURIComponent(id)}`);
  const { width } = useViewport();
  const reload = res.reload;
  if (res.loading && !res.data) return <Loading lines={8} />;
  if (res.error && !res.data) return <div className="stack"><a className="btn sm ghost sales-back" href={`#${salesHref("pipeline")}`}><ChevronLeft size={14} aria-hidden="true" />Pipeline</a><SalesError error={res.error} onRetry={reload} what="oportunitatea" /></div>;
  const d = res.data || {};
  const opp = oppView(d.opportunity ?? d);
  const org = orgView(d.org || {});
  const suppressed = Boolean(d.suppression);
  const proposals = listOf(d, "proposals").map(proposalView);
  const drafts = listOf(d, "drafts").map(draftView).sort((a, b) => b.version - a.version);
  const contacts = listOf(d, "contacts").map(contactView);
  const contactEvents = newestFirst(listOf(d, "contactEvents"));
  const acceptances = listOf(d, "acceptances");
  const handoffs = listOf(d, "handoffs");
  const followups = listOf(d, "followups").map(followupView);
  const transitions = listOf(d, "transitions").map(transitionView);
  const draftsPanel = <Drafts key="drafts" opp={opp} org={org} drafts={drafts} contacts={contacts} proposals={proposals} suppressed={suppressed} onChanged={reload} />;
  const proposalsPanel = <Proposals key="proposals" opp={opp} proposals={proposals} suppressed={suppressed} onChanged={reload} />;
  const side = [
    <ContactAndAcceptance key="contact" opp={opp} org={org} proposals={proposals} contactEvents={contactEvents} acceptances={acceptances} overview={overview} onChanged={reload} />,
    <HandoffPanel key="handoff" opp={opp} handoffs={handoffs} proposals={proposals} acceptances={acceptances} onChanged={reload} />,
    <OppFollowups key="followups" opp={opp} followups={followups} contactEvents={contactEvents} proposals={proposals} orgStatus={org.status} suppressed={suppressed} onChanged={reload} />,
    <OppTransitions key="transitions" opp={opp} transitions={transitions} contactEvents={contactEvents} onChanged={reload} />,
  ];
  const phone = width < 768;
  return (
    <div className="stack">
      <div className="sales-sheet-head">
        <a className="btn sm ghost sales-back" href={`#${salesHref("pipeline")}`}><ChevronLeft size={14} aria-hidden="true" />Pipeline</a>
        <h2 className="block-title break">{opp.title || "(fără titlu)"}</h2>
        <div className="chips"><SalesChip kind="opp" status={opp.status} />{opp.synthetic && <SyntheticTag />}{suppressed && <SalesChip kind="org" status="DO_NOT_CONTACT" />}</div>
        <div className="small break">{(opp.orgId || org.id) ? <a href={`#${salesHref("org", { id: opp.orgId || org.id })}`}>{org.name || opp.orgName || "Fișa firmei"}</a> : (opp.orgName || "—")}
          {opp.nextAction && <span className="faint"> · următorul pas: {opp.nextAction}{opp.nextActionAt ? ` (${when(opp.nextActionAt)})` : ""}</span>}</div>
        {d.service?.name && <div className="faint small break">Serviciu: {d.service.name}</div>}
        {opp.need && <p className="muted small prewrap" style={{ margin: 0 }}>{opp.need}</p>}
      </div>
      <Preparation oppId={opp.id || id} />
      {phone ? (
        <div className="stack">{draftsPanel}{proposalsPanel}{side}</div>
      ) : (
        <div className="split-main sales-opp">
          <div className="stack">{proposalsPanel}{draftsPanel}</div>
          <div className="stack">{side}</div>
        </div>
      )}
    </div>
  );
}
