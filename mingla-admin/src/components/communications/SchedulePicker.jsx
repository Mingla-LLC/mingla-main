// Issue #4383 — the one "When" control: Now or Later, and for Later a date,
// a time and a timezone (defaulting to the browser's). The parent checks the
// choice with lib/scheduleTime.js checkLaterTime at submit; the server checks
// again.
import { useId, useMemo } from "react";
import { timeZoneOptions } from "../../lib/scheduleTime";

export const SELECT_CLASS = "h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] disabled:opacity-60";

export function WhenSegment({ value, onChange, nowLabel = "Now", laterLabel = "Later", disabled = false, label = "When" }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-0.5">
      {[["now", nowLabel], ["later", laterLabel]].map(([mode, text]) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={`min-h-9 rounded-md px-3 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
            value === mode ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * value: { date: "YYYY-MM-DD", time: "HH:MM", zone: "Africa/Lagos" }
 * error: words under the inputs (from checkLaterTime), or null
 */
export function LaterInputs({ value, onChange, error = null, disabled = false, hint = null }) {
  const id = useId();
  const zones = useMemo(() => timeZoneOptions([value?.zone].filter(Boolean)), [value?.zone]);
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  return (
    <div className="space-y-1.5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor={`${id}-date`}>
          Date
          <input id={`${id}-date`} type="date" className={`${SELECT_CLASS} mt-1`} value={value?.date || ""} onChange={set("date")} disabled={disabled} />
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor={`${id}-time`}>
          Time
          <input id={`${id}-time`} type="time" className={`${SELECT_CLASS} mt-1`} value={value?.time || ""} onChange={set("time")} disabled={disabled} />
        </label>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor={`${id}-zone`}>
          Timezone
          <select id={`${id}-zone`} className={`${SELECT_CLASS} mt-1`} value={value?.zone || ""} onChange={set("zone")} disabled={disabled}>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{error}</p> : null}
      {hint ? <p className="text-xs text-[var(--color-text-tertiary)]">{hint}</p> : null}
    </div>
  );
}
