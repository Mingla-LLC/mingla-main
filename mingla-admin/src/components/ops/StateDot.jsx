// Issue #3980 (R6) — the one map from a plain state to its colour. Ready to
// promote green, Promote now amber, Too late for promo red, Happened grey,
// Not live yet a hollow blue dot, No next event a filled blue dot. Tokens only.
import { stateName } from "../../lib/opsModel";

const DOT = {
  ready: "bg-[var(--color-success-600)]",
  short: "bg-[var(--color-warning-600)]",
  late: "bg-[var(--color-error-600)]",
  done: "bg-[var(--gray-400)]",
  none: "bg-[var(--color-info-600)]",
  notlive: "bg-[var(--color-background-primary)] shadow-[inset_0_0_0_2px_var(--color-info-600)]",
  nodate: "bg-[var(--color-background-primary)] shadow-[inset_0_0_0_2px_var(--gray-400)]",
};
const PILL = {
  ready: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  short: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  late: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  done: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
  none: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  notlive: "bg-[var(--color-background-primary)] text-[var(--color-info-700)] ring-1 ring-inset ring-[var(--gray-200)]",
  nodate: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
};

function stateDotClass(k) {
  return DOT[k] || DOT.nodate;
}

export function StateDot({ k, size = 8, label }) {
  return (
    <i
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full not-italic ${stateDotClass(k)}`}
    />
  );
}

export function StatePill({ state, className = "" }) {
  const k = state?.k || "nodate";
  return (
    <span className={`inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${PILL[k] || PILL.nodate} ${className}`}>
      <StateDot k={k} />
      {stateName(state)}
    </span>
  );
}
