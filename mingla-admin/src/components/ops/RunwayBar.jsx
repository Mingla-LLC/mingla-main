// Issue #3980 — the runway bar: 42 days before an event to 2 days after,
// with T-28 (live), T-21 (promo), the event and today marked, and the time it
// has been public filled in its band's colour.
import { runwayBarModel, todayIso } from "../../lib/opsModel";

const FILL = {
  success: "bg-[var(--color-success-600)]",
  warning: "bg-[var(--color-warning-600)]",
  error: "bg-[var(--color-error-600)]",
  info: "bg-[var(--color-info-600)]",
  default: "bg-[var(--gray-400)]",
};

export function RunwayBar({ anchor, today = todayIso() }) {
  const model = runwayBarModel(anchor, today);
  if (!model) return <p className="text-[13px] text-[var(--color-text-secondary)]">No date yet, so no runway.</p>;
  const visible = model.ticks.filter((t) => t.at !== null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative h-4" aria-hidden="true">
        <div className="absolute inset-x-0 top-1.5 h-1.5 rounded-full bg-[var(--gray-100)]" />
        {model.fill && (
          <div className={`absolute top-1.5 h-1.5 rounded-full ${FILL[model.fill.tone] || FILL.default}`} style={{ left: `${model.fill.left}%`, width: `${model.fill.width}%` }} />
        )}
        {visible.map((t) => (
          <div key={t.key} className={`absolute top-0 h-4 w-0.5 -translate-x-1/2 ${t.brand ? "bg-[var(--color-brand-600)]" : "bg-[var(--gray-500)]"}`} style={{ left: `${t.at}%` }} />
        ))}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        {[...visible].sort((a, b) => a.at - b.at).map((t) => (
          <li key={t.key} className={t.brand ? "font-semibold text-[var(--color-brand-700)]" : ""}>{t.label}</li>
        ))}
      </ul>
    </div>
  );
}
