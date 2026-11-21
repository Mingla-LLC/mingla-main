// Issue #4420 (step 5) — the label chips of a Support conversation. The words
// come from lib/supportInboxModel.js rowLabels; this file only draws them.
const TONE = Object.freeze({
  plain: "bg-[var(--gray-100)] text-[var(--gray-700)]",
  staff: "bg-[#f3e8ff] text-[#6b21a8]",
  alert: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  wait: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  warn: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  ticket: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  done: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
});
const BASE = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

/** onOpenTicket(linked): when given, a ticket chip is a button that opens the ticket summary. */
export function LabelChips({ labels, onOpenTicket }) {
  return (
    <>
      {labels.map((label) => (
        label.tone === "ticket" && onOpenTicket ? (
          <button key={label.id} type="button" data-label={label.id} onClick={() => onOpenTicket(label.linked)}
            className={`${BASE} ${TONE.ticket} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]`}>
            {label.text}
          </button>
        ) : (
          <span key={label.id} data-label={label.id} className={`${BASE} ${TONE[label.tone] || TONE.plain}`}>{label.text}</span>
        )
      ))}
    </>
  );
}
