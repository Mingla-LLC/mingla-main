const VARIANTS = {
  default:  "bg-[var(--gray-100)] text-[var(--gray-700)]",
  brand:    "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  success:  "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warning:  "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  error:    "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  info:     "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  outline:  "bg-transparent text-[var(--color-text-secondary)] border border-[var(--gray-300)]",
};

const DOT_COLORS = {
  default: "bg-[var(--gray-500)]",
  brand:   "bg-[#f97316]",
  success: "bg-[#22c55e]",
  warning: "bg-[#f59e0b]",
  error:   "bg-[#ef4444]",
  info:    "bg-[#3b82f6]",
  outline: "bg-[var(--color-text-secondary)]",
};

export function Badge({ variant = "default", dot = false, children, className = "" }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap",
        VARIANTS[variant] || VARIANTS.default,
        className,
      ].join(" ")}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_COLORS[variant] || DOT_COLORS.default}`}
        />
      )}
      {children}
    </span>
  );
}
