// #4452 §7 — small pieces the Forms builder and the Website pages editor share,
// drawn with the refreshed --a-* tokens (light and dark).
import { Lock } from "lucide-react";
import { Toggle } from "../ui/Input";

const LABEL_WORDS = { host: "Host lead", creator: "Creator lead", local: "Local lead", explorer: "Explorer" };

/** The lead label pill ("Creator lead"). */
export function LabelPill({ label }) {
  if (!label) return <span className="text-xs text-[var(--color-text-tertiary)]">No label</span>;
  return <span data-label-pill={label} className="inline-flex items-center rounded-full bg-[var(--a-chip)] px-2 py-0.5 text-xs font-semibold text-[var(--a-chip-ink)]">{LABEL_WORDS[label] || label}</span>;
}

/** View-only members see every edit control disabled, with this beside them (design ch. 11). */
export const READ_ONLY_WORDS = "Ask an admin for the Website editor role";
export function ReadOnlyHint() {
  return (
    <p data-read-only="" className="flex items-center gap-2 rounded-xl border border-[var(--a-line)] bg-[var(--a-soft)] px-3 py-2 text-sm text-[var(--a-text2)]">
      <Lock aria-hidden="true" className="h-4 w-4" /> View only. {READ_ONLY_WORDS} to make changes.
    </p>
  );
}

/** A refreshed card with an optional heading row. */
export function Panel({ title, action, children, className = "", ...rest }) {
  return (
    <section className={`rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)] shadow-[var(--a-shadow)] ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--a-line)] px-4 py-3">
          {title && <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>}
          <span className="flex-1" />
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A segmented control (design .seg). */
export function Seg({ value, options, onChange, label, disabled = false }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-xl bg-[var(--a-soft)] p-1">
      {options.map((o) => (
        <button key={o.id} type="button" disabled={disabled} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`min-h-8 rounded-[9px] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${value === o.id ? "bg-[var(--a-panel)] text-[var(--a-text)] shadow-[0_1px_3px_rgba(20,20,19,.1)]" : "text-[var(--a-text2)]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A text box with its limit and an n/limit counter (the limits are the design's maxlength). */
export function LimitedText({ label, value, limit, onChange, disabled, multiline = false, id, placeholder }) {
  const n = [...String(value || "")].length;
  const cls = "w-full rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--a-text)] focus:shadow-[0_0_0_4px_rgba(235,120,37,.16)] disabled:opacity-60";
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px] font-semibold text-[var(--a-text2)]">
        <span>{label}</span>
        <span data-counter="" className={`font-mono text-[11px] font-medium ${n > limit ? "text-[#b91c1c]" : "text-[var(--a-dim)]"}`}>{n}/{limit}</span>
      </span>
      {multiline ? (
        <textarea id={id} value={value || ""} maxLength={limit} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} min-h-[88px] py-2.5`} />
      ) : (
        <input id={id} value={value || ""} maxLength={limit} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} h-11`} />
      )}
    </label>
  );
}

/** A toggle row: words on the left, the switch on the right (design .toggle). */
export function ToggleRow({ title, hint, checked, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--a-line)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
        {hint && <p className="text-xs text-[var(--color-text-tertiary)]">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={undefined} />
    </div>
  );
}
