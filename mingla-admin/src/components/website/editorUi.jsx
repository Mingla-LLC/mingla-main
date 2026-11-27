// #4636 — small pieces the Website pages editor shares (Admin tokens, light and dark).
import { STATUS_LABELS } from "../../lib/siteEditorModel";

const CHIP = {
  draft: "bg-[var(--a-soft)] text-[var(--a-text2)]",
  changes: "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]",
  published: "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]",
  designed: "bg-[var(--a-soft)] text-[var(--a-dim)]",
  locked: "bg-[var(--a-soft)] text-[var(--a-dim)]",
  deleted: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
};

export function StatusChip({ status, short = false }) {
  const label = short && status === "changes" ? "Changes" : STATUS_LABELS[status] || status;
  return <span data-status={status} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[status] || CHIP.draft}`}>{label}</span>;
}

export const FIELD = "w-full rounded-lg border border-[var(--a-line)] bg-[var(--a-bg)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--a-text)] focus:shadow-[0_0_0_3px_rgba(235,120,37,.16)] disabled:opacity-60";
export const FIELD_BAD = "border-[var(--color-error-700)]";

/** A labelled text box with a counter and its problem under it. */
export function TextField({ id, label, value, max, onChange, error, disabled, multiline = false, hint, inputRef, placeholder }) {
  const n = [...String(value ?? "")].length;
  const cls = `${FIELD} ${error ? FIELD_BAD : ""}`;
  return (
    <div className="mt-3" data-field={id}>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-[var(--a-text2)]">
        <span>{label}</span>
        {max ? <span className={`font-mono text-[10.5px] ${n > max ? "text-[var(--color-error-700)]" : "text-[var(--a-dim)]"}`}>{n}/{max}</span> : null}
      </label>
      {multiline ? (
        <textarea id={id} ref={inputRef} rows={3} value={value ?? ""} disabled={disabled} placeholder={placeholder} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-y`} />
      ) : (
        <input id={id} ref={inputRef} value={value ?? ""} disabled={disabled} placeholder={placeholder} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
      {hint && !error ? <p className="mt-1 text-[11.5px] text-[var(--a-dim)]">{hint}</p> : null}
      {error ? <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{error}</p> : null}
    </div>
  );
}

export function Hint({ children, className = "" }) {
  return <p className={`text-xs text-[var(--a-dim)] ${className}`}>{children}</p>;
}

export function Note({ children, tone = "soft", className = "", ...rest }) {
  const t = tone === "warn" ? "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]" : tone === "bad" ? "bg-[var(--color-error-50)] text-[var(--color-error-700)]" : "bg-[var(--a-soft)] text-[var(--a-text2)]";
  return <div className={`rounded-xl px-3 py-2 text-xs ${t} ${className}`} {...rest}>{children}</div>;
}

/** A small icon/text button for rails and toolbars. */
export function MiniButton({ children, className = "", ...props }) {
  return (
    <button type="button" className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:border-[var(--a-dim)] disabled:cursor-not-allowed disabled:opacity-35 ${className}`} {...props}>
      {children}
    </button>
  );
}
