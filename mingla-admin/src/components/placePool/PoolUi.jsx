// Issue #4276 design pass: the small pieces the Place pool tabs share, drawn the way the
// approved prototype draws them, in the admin's tokens (globals.css).
//
//   StatTile   a label, a big number and one line under it
//   ChipGroup  a row of pill filters, one pressed
//   ShareBar   a thin bar of a share, brand coloured

export function StatTile({ label, value, note, tone = "default" }) {
  const valueTone = tone === "error" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 py-3.5 shadow-[var(--shadow-sm)]">
      <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-[26px] font-semibold leading-8 tabular-nums tracking-[-0.01em] ${valueTone}`}>{value}</span>
      {note && <span className="text-xs leading-4 text-[var(--color-text-secondary)]">{note}</span>}
    </div>
  );
}

export function ChipGroup({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={[
              "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150",
              on
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-semibold text-[var(--color-brand-700)]"
                : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-brand-600)]",
            ].join(" ")}
          >
            {o.label}
            {o.count != null && <span className="ml-1.5 tabular-nums text-[var(--color-text-tertiary)]">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ShareBar({ share, tone = "brand", label }) {
  const fill = tone === "error" ? "bg-[var(--color-error-500)]" : "bg-[var(--color-brand-500)]";
  return (
    <div className="h-2 min-w-0 overflow-hidden rounded-full bg-[var(--gray-100)]" role="img" aria-label={label}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, share ?? 0))}%` }} />
    </div>
  );
}
