// Issue #4270 (Wave 7) — the composer: quick replies (they fill the box, they
// never send), the reply strip, the select bar for selected messages (Create
// product signal, Add to plan, Make a work card), files, the message box and
// Send (Ctrl or Cmd + Enter). The line under it says who the brand team sees.
import { Plus, X } from "lucide-react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const CHIP = `min-h-9 rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] ${FOCUS}`;
const BAR_BUTTON = `min-h-9 rounded-lg px-2.5 text-[12.5px] font-semibold ${FOCUS}`;

export function BrandGroupComposer({
  brandName, value, onChange, onSend, sending, chips = [], onChip,
  replyTo, onClearReply, selectedCount = 0, canPlanActions, onSelectSignal, onSelectPlan, onSelectWork, onSelectCancel,
  onAddFiles, filesBusy, uploads = null, replyingAs, onTyping, onStopTyping,
}) {
  const canSend = !sending && !!String(value || "").trim();
  return (
    <div data-composer="" className="shrink-0 border-t border-[var(--gray-100)] bg-[var(--color-background-primary)] px-4 py-3 sm:px-[18px]">
      {selectedCount > 0 ? (
        <div data-select-bar="" role="toolbar" aria-label="Selected messages" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-text-primary)] px-3 py-2 text-[var(--color-background-primary)]">
          <span className="mr-auto text-[13px] font-semibold">{selectedCount} {selectedCount === 1 ? "message" : "messages"} selected</span>
          <button type="button" className={`${BAR_BUTTON} bg-[var(--color-background-primary)] text-[var(--color-text-primary)]`} onClick={onSelectSignal}>Create product signal</button>
          {canPlanActions && <button type="button" className={`${BAR_BUTTON} bg-[var(--color-background-primary)] text-[var(--color-text-primary)]`} onClick={onSelectPlan}>Add to plan</button>}
          {canPlanActions && <button type="button" className={`${BAR_BUTTON} bg-[var(--color-background-primary)] text-[var(--color-text-primary)]`} onClick={onSelectWork}>Make a work card</button>}
          <button type="button" className={`${BAR_BUTTON} text-[var(--color-background-primary)] underline`} onClick={onSelectCancel}>Cancel</button>
        </div>
      ) : chips.length > 0 && (
        <div data-quick-replies="" className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => <button key={chip.key} type="button" className={CHIP} onClick={() => onChip(chip)}>{chip.label}</button>)}
        </div>
      )}
      {replyTo && (
        <div data-reply-strip="" className="mb-2 flex items-center gap-3 rounded-lg bg-[var(--gray-100)] px-3 py-2 text-[12px]">
          <span aria-hidden="true" className="h-8 w-[3px] shrink-0 rounded bg-[var(--color-brand-500)]" />
          <div className="min-w-0 flex-1"><strong className="block text-[var(--color-text-primary)]">Replying to {replyTo.sender_display_name}</strong><p className="truncate text-[var(--color-text-tertiary)]">{replyTo.content}</p></div>
          <button type="button" aria-label="Cancel reply" onClick={onClearReply} className={`flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-200)] ${FOCUS}`}><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      )}
      {uploads}
      <div className="flex items-end gap-2">
        <button type="button" aria-label="Add files" disabled={filesBusy} onClick={onAddFiles}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`}>
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
        <label className="min-w-0 flex-1" htmlFor="brand-group-composer">
          <span className="sr-only">Message {brandName}</span>
          <textarea
            id="brand-group-composer"
            value={value}
            rows={2}
            placeholder={`Message ${brandName}…`}
            onChange={(e) => { onChange(e.target.value); if (e.target.value) onTyping?.(); }}
            onBlur={() => onStopTyping?.()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSend) onSend(); }
            }}
            className="min-h-11 w-full resize-y rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
          />
        </label>
        <button type="button" disabled={!canSend} onClick={onSend}
          className={`min-h-11 shrink-0 rounded-[10px] bg-[var(--color-brand-700)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-800)] disabled:opacity-50 ${FOCUS}`}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        Replying as <strong className="font-semibold text-[var(--color-text-secondary)]">{replyingAs} · Mingla Support</strong> · the brand team gets a push
      </p>
    </div>
  );
}
