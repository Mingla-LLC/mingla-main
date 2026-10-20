// Issue #3980 — close a card with proof: one or more lines that show the
// work is done.
import { useState } from "react";
import { proofFromLines } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`;

export function ProofLines({ lines, setLines, disabled, label = "Proof" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
      {lines.map((line, i) => (
        <input
          key={i}
          value={line}
          maxLength={500}
          disabled={disabled}
          aria-label={`${label} line ${i + 1}`}
          placeholder="What shows it is done"
          onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))}
          className={INPUT}
        />
      ))}
      {lines.length < 10 && (
        <button type="button" disabled={disabled} onClick={() => setLines([...lines, ""])} className={`min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Add another line</button>
      )}
    </div>
  );
}

export function ProofForm({ busy, disabled, onSubmit, onCancel }) {
  const [lines, setLines] = useState([""]);
  const [result, setResult] = useState("");
  const proof = proofFromLines(lines);
  return (
    <form
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3"
      onSubmit={(e) => { e.preventDefault(); if (proof.length) onSubmit(proof, result.trim()); }}
    >
      <ProofLines lines={lines} setLines={setLines} disabled={disabled || busy} />
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Result (optional)</span>
        <textarea value={result} maxLength={2000} disabled={disabled || busy} onChange={(e) => setResult(e.target.value)} className={`min-h-[64px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
      </label>
      {proof.length === 0 && <p className="text-[12px] text-[var(--color-text-tertiary)]">Add at least one line of proof (3 characters or more).</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled || busy || proof.length === 0} className={`min-h-11 rounded-lg bg-[var(--color-brand-800)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-900)] disabled:opacity-50 ${FOCUS}`}>{busy ? "Closing…" : "Close card"}</button>
        <button type="button" onClick={onCancel} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
      </div>
    </form>
  );
}
