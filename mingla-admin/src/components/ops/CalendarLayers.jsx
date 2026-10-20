// Issue #3980 — the Calendar's layer chips. Each one turns a layer on or off;
// the choice lives in the address (layers=live,exp,dead,promo,content).
import { CALENDAR_LAYERS } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function CalendarLayers({ layers, onToggle }) {
  return (
    <div role="group" aria-label="Calendar layers" className="flex min-w-0 flex-wrap gap-2">
      {CALENDAR_LAYERS.map((layer) => {
        const on = !!layers[layer.id];
        return (
          <button
            key={layer.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(layer.id)}
            className={[
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-150",
              FOCUS,
              on
                ? "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                : "border-[var(--gray-200)] bg-[var(--gray-50)] text-[var(--color-text-tertiary)] line-through",
            ].join(" ")}
          >
            <i aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${layer.swatch} ${on ? "" : "opacity-40"}`} />
            {layer.label}
          </button>
        );
      })}
    </div>
  );
}

/** The key under the month grid. */
export function RunwayLegend() {
  const rows = [
    ["bg-[var(--color-success-600)]", "Ready to promote"],
    ["bg-[var(--color-warning-600)]", "Promote now"],
    ["bg-[var(--color-error-600)]", "Too late for promo"],
    ["border-[1.5px] border-dashed border-[var(--gray-400)]", "Expected"],
  ];
  return (
    <ul aria-label="Runway colours" className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
      {rows.map(([swatch, label]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${swatch}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}
