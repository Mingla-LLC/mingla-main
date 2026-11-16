// #4452 §7.1: 600 weight; success / warning / info use the AA status pairs
// (live, stop, sched), and draft is --a-text2 on --a-soft.
const VARIANTS = {
  default:  "bg-[var(--a-soft)] text-[var(--a-text2)]",
  brand:    "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  success:  "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]",
  warning:  "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]",
  error:    "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  info:     "bg-[var(--a-sched-bg)] text-[var(--a-sched-ink)]",
  live:     "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]",
  sent:     "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]",
  stop:     "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]",
  sched:    "bg-[var(--a-sched-bg)] text-[var(--a-sched-ink)]",
  draft:    "bg-[var(--a-soft)] text-[var(--a-draft-ink)]",
  chip:     "bg-[var(--a-chip)] text-[var(--a-chip-ink)]",
  outline:  "bg-transparent text-[var(--color-text-secondary)] border border-[var(--gray-300)]",
  // #3697 — over media (card posters): light ink on a translucent dark chip.
  ink:      "bg-[rgba(17,24,39,.72)] text-white",
};

const DOT_COLORS = {
  default: "bg-[var(--gray-500)]",
  brand:   "bg-[var(--color-brand-500)]",
  success: "bg-[#22c55e]",
  warning: "bg-[#f59e0b]",
  error:   "bg-[#ef4444]",
  info:    "bg-[#3b82f6]",
  outline: "bg-[var(--color-text-secondary)]",
  ink:     "bg-white",
  live:    "bg-[var(--a-live-ink)]",
  sent:    "bg-[var(--a-live-ink)]",
  stop:    "bg-[var(--a-stop-ink)]",
  sched:   "bg-[var(--a-sched-ink)]",
  draft:   "bg-[var(--a-draft-ink)]",
  chip:    "bg-[var(--a-chip-ink)]",
};

export function Badge({ variant = "default", dot = false, children, className = "" }) {
  return (
    <span
      data-badge={variant}
      className={[
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap",
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
