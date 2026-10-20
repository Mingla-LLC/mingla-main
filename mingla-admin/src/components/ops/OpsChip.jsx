// Issue #3980 — a small label on ops cards. Text wraps; it is never cut off.
const TONES = {
  default: "bg-[var(--gray-100)] text-[var(--gray-700)]",
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  error: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
};

export function OpsChip({ tone = "default", dashed = false, children, className = "" }) {
  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-1 break-words rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-4",
        TONES[tone] || TONES.default,
        dashed ? "border-[1.5px] border-dashed border-[var(--gray-400)]" : "",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function Avatars({ people }) {
  const list = Array.isArray(people) ? people : [];
  return (
    <span className="inline-flex shrink-0" aria-label={list.map((p) => p.name).join(", ") || "No owner"}>
      {list.slice(0, 4).map((p, i) => (
        <span
          key={p.email || i}
          aria-hidden="true"
          title={p.name}
          className={[
            "inline-grid h-6 w-6 place-items-center rounded-full bg-[var(--color-brand-100)] text-[10px] font-semibold text-[var(--color-brand-700)]",
            i > 0 ? "-ml-1.5 ring-2 ring-[var(--color-background-primary)]" : "",
          ].join(" ")}
        >
          {String(p.name || "?").slice(0, 2).toUpperCase()}
        </span>
      ))}
      {list.length > 4 && <span aria-hidden="true" className="ml-1 text-[11px] text-[var(--color-text-tertiary)]">+{list.length - 4}</span>}
    </span>
  );
}
