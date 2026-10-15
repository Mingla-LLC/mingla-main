import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../crm/fields";
import { draftValidation } from "../../lib/draftModel";

const DRAFT_LABEL_CLASS = "block mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]";

export const DraftEditor = forwardRef(function DraftEditor({
  draft, editing, busy, online, offlineHelpId, primaryAction, openAction, discardAction,
  onEditing, onDirty, onSave, onValues, onUseLatest, onCloseWithdrawn,
}, bodyRef) {
  const [base, setBase] = useState(draft);
  const [subject, setSubject] = useState(draft.subject || "");
  const [body, setBody] = useState(draft.body || "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [status, setStatus] = useState("");
  const subjectRef = useRef(null);
  const withdrawn = !!draft.withdrawn;
  const remote = draft.serverDraft;
  const dirtySubject = subject !== (base.subject || "");
  const dirtyBody = body !== base.body;
  const dirty = dirtySubject || dirtyBody;
  const validation = useMemo(() => draftValidation(draft.channel, subject, body), [body, draft.channel, subject]);

  useEffect(() => {
    if (!editing) return;
    const node = draft.channel === "email" ? subjectRef.current : bodyRef?.current;
    node?.focus?.();
  }, [bodyRef, draft.channel, editing]);
  useEffect(() => { onValues?.({ subject, body, dirtySubject, dirtyBody, validation, withdrawn }); }, [body, dirtyBody, dirtySubject, onValues, subject, validation, withdrawn]);

  const save = async () => {
    if (validation.body || validation.subject || !dirty || withdrawn) return;
    setStatus("Saving…");
    try {
      const answer = await onSave({ body: validation.cleanBody, ...(draft.channel === "email" ? { subject: validation.cleanSubject || null } : {}) });
      const saved = answer?.draft || { ...base, body: validation.cleanBody, subject: draft.channel === "email" ? validation.cleanSubject || null : base.subject };
      setBase(saved); setBody(saved.body); setSubject(saved.subject || "");
      onDirty?.(false); setStatus("Saved");
    } catch { setStatus("Not saved. Your text is still here."); }
  };
  const close = () => {
    setSubject(base.subject || ""); setBody(base.body || ""); setConfirmCancel(false); setStatus("");
    onDirty?.(false); onEditing(false);
    if (withdrawn) onCloseWithdrawn?.();
  };
  const cancel = () => { if (dirty && !confirmCancel) { setConfirmCancel(true); return; } close(); };
  const useLatest = () => {
    if (!remote) return;
    setBase(remote); setSubject(remote.subject || ""); setBody(remote.body || ""); setStatus(""); setConfirmCancel(false); onDirty?.(false);
    onUseLatest?.(remote);
  };
  const escape = (event) => {
    if (event.key !== "Escape") return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) { event.preventDefault(); event.target.blur(); return; }
    event.preventDefault(); cancel();
  };

  if (!editing) return (
    <div className="space-y-4">
      {draft.channel === "email" && draft.subject ? <div><p className={DRAFT_LABEL_CLASS}>Subject</p><p className="break-words text-sm font-semibold leading-5 text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{draft.subject}</p></div> : null}
      <div><p className={DRAFT_LABEL_CLASS}>Message</p><p ref={bodyRef} tabIndex={-1} className="max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{draft.body}</p></div>
    </div>
  );

  return (
    <div className="space-y-4" onKeyDown={escape}>
      {withdrawn && <div role="alert" className="rounded-lg bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]">This draft was withdrawn while you were editing. Your text is still here, but it can’t be saved or marked sent.</div>}
      {remote && !withdrawn && <div role="alert" className="rounded-lg bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]"><p>This draft changed elsewhere. Your text is still here.</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={useLatest}>Use latest</Button><Button type="button" variant="secondary" className="min-h-11" disabled={!online || busy || !dirty} aria-describedby={!online ? offlineHelpId : undefined} onClick={save}>Keep mine</Button></div></div>}
      {draft.channel === "email" && <div>
        <label htmlFor={`draft-subject-${draft.id}`} className={DRAFT_LABEL_CLASS}>Subject</label>
        <input ref={subjectRef} id={`draft-subject-${draft.id}`} value={subject} maxLength={201} readOnly={withdrawn} disabled={busy} aria-invalid={!!validation.subject} aria-describedby={`draft-subject-help-${draft.id}`}
          onChange={(event) => { const next = event.target.value; setSubject(next); onDirty?.(next !== (base.subject || "") || body !== base.body); }} className={`${CONTROL_CLASS} h-11 focus:border-[var(--color-brand-700)] focus:ring-[var(--color-brand-100)]`} />
        <p id={`draft-subject-help-${draft.id}`} className={`mt-1 text-xs ${validation.subject ? "text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`} role={validation.subject ? "alert" : undefined}>{validation.subject || `${subject.length} / 200`}</p>
      </div>}
      <div>
        <label htmlFor={`draft-body-${draft.id}`} className={DRAFT_LABEL_CLASS}>Message</label>
        <textarea ref={bodyRef} id={`draft-body-${draft.id}`} value={body} maxLength={4001} readOnly={withdrawn} disabled={busy} aria-invalid={!!validation.body} aria-describedby={`draft-body-help-${draft.id}`}
          onChange={(event) => { const next = event.target.value; setBody(next); onDirty?.(next !== base.body || subject !== (base.subject || "")); }} className={`${TEXTAREA_CLASS} min-h-[160px] font-sans leading-6 focus:border-[var(--color-brand-700)] focus:ring-[var(--color-brand-100)]`} />
        <p id={`draft-body-help-${draft.id}`} className={`mt-1 text-xs ${validation.body ? "text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`} role={validation.body ? "alert" : undefined}>{validation.body || `${body.length} / 4,000`}</p>
      </div>
      <div className={`flex min-h-5 flex-wrap items-center gap-2 text-[13px] ${status.startsWith("Not saved") ? "font-semibold text-[var(--color-error-700)]" : status === "Saved" ? "font-semibold text-[var(--color-success-700)]" : "text-[var(--color-text-secondary)]"}`} aria-live="polite" role={status.startsWith("Not saved") ? "alert" : undefined}>
        {dirty && !status ? <span>Unsaved changes</span> : <span>{status}</span>}
        {status.startsWith("Not saved") && <Button type="button" variant="link" disabled={!online || busy} onClick={save}>Try again</Button>}
      </div>
      {confirmCancel && <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-tertiary)] p-3 text-[13px] text-[var(--color-text-secondary)]"><p>Discard your unsaved changes?</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" autoFocus onClick={() => setConfirmCancel(false)}>Keep editing</Button><Button type="button" variant="ghost" className="min-h-11" onClick={close}>Discard changes</Button></div></div>}
      <div className="space-y-2 sm:hidden">
        {primaryAction}
        <div className={`grid gap-2 ${withdrawn ? "grid-cols-1" : "grid-cols-2"}`}>
          {!withdrawn && <Button type="button" variant="secondary" className="min-h-11 w-full" loading={busy && status === "Saving…"} disabled={!online || busy || !dirty || !!validation.body || !!validation.subject} aria-describedby={!online ? offlineHelpId : undefined} onClick={save}>{status === "Saving…" ? "Saving…" : "Save changes"}</Button>}
          <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={busy} onClick={withdrawn ? close : cancel}>{withdrawn ? "Close draft" : "Cancel"}</Button>
        </div>
        {(openAction || discardAction) && <div className="grid grid-cols-2 gap-2">{openAction}{discardAction}</div>}
      </div>
      <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 border-t border-[var(--gray-200)] pt-4 sm:flex">
        <div className="flex flex-wrap items-center gap-2">{openAction}{discardAction}</div>
        <div className="flex flex-wrap items-center gap-2">
          {!withdrawn && <Button type="button" variant="secondary" className="min-h-11" loading={busy && status === "Saving…"} disabled={!online || busy || !dirty || !!validation.body || !!validation.subject} aria-describedby={!online ? offlineHelpId : undefined} onClick={save}>{status === "Saving…" ? "Saving…" : "Save changes"}</Button>}
          <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={withdrawn ? close : cancel}>{withdrawn ? "Close draft" : "Cancel"}</Button>
          {primaryAction}
        </div>
      </div>
    </div>
  );
});
