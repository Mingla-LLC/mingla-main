// Issue #4383 — a scheduled time as every list shows it: the saved zone's
// wall time with the zone under it, and the viewer's own time when different.
import { scheduleLabel } from "../../lib/scheduleTime";

export function ScheduleTime({ at, zone, className = "" }) {
  const label = scheduleLabel(at, zone);
  if (!label.primary) return null;
  return (
    <div className={`text-right text-[13px] leading-5 ${className}`}>
      <div className="font-medium text-[var(--color-text-primary)] whitespace-nowrap">{label.primary}</div>
      <div className="text-[11.5px] text-[var(--color-text-tertiary)] whitespace-nowrap">{label.zone}</div>
      {label.viewer ? <div className="text-[11.5px] text-[var(--color-text-tertiary)] whitespace-nowrap">{label.viewer}</div> : null}
    </div>
  );
}
