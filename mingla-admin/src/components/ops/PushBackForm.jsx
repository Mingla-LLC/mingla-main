// Issue #3980 — push a card back: not needed, or already done (with proof).
import { useId, useState } from "react";
import { ProofLines, proofFromLines } from "./ProofForm";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function PushBackForm({ busy, disabled, onSubmit, onCancel }) {
  const id = useId();
  const [kind, setKind] = useState("declined");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([""]);
  const proof = proofFromLines(lines);
  const reasonOk = reason.trim().length >= 10;
  const ready = reasonOk && (kind === "declined" || proof.length > 0);
  return (
    <form className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(kind, reason.trim(), kind === "already_done" ? proof : []); }}>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Why push it back</legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px]"><input type="radio" name={`${id}-kind`} checked={kind === "declined"} onChange={() => setKind("declined")} /> Not needed</label>
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px]"><input type="radio" name={`${id}-kind`} checked={kind === "already_done"} onChange={() => setKind("already_done")} /> Already done</label>
      </fieldset>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Reason</span>
        <textarea value={reason} maxLength={500} disabled={disabled || busy} onChange={(e) => setReason(e.target.value)} placeholder="Say why in one or two sentences" className={`min-h-[64px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
      </label>
      {kind === "already_done" && <ProofLines lines={lines} setLines={setLines} disabled={disabled || busy} label="Proof it was done" />}
      {!reasonOk && <p className="text-[12px] text-[var(--color-text-tertiary)]">Say why in at least 10 characters.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled || busy || !ready} className={`min-h-11 rounded-lg bg-[var(--color-brand-800)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-900)] disabled:opacity-50 ${FOCUS}`}>{busy ? "Pushing back…" : "Push back"}</button>
        <button type="button" onClick={onCancel} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
      </div>
    </form>
  );
}
