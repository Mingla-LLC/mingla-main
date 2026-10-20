// Issue #3980 (R1) — on a host card on the board or the list: the host's
// next dated thing with its plain state ("Bachata Social · 21 Oct", then
// "Too late for promo", or "Not live yet, live by 1 Nov"), or a blue
// "No next event" flag, and red reason badges (No owner; Missing type,
// region, contact). The rows come from one ops_host_next call per load,
// shared through HostNextContext; creators get nothing.
import { useContext } from "react";
import { HostNextContext } from "../../hooks/useOpsWork";
import { StateDot } from "../ops/StateDot";
import { dayLabel, hostMissing, hostReasons, stateLine } from "../../lib/opsModel";

const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function NextEventLine({ record }) {
  const ctx = useContext(HostNextContext);
  if (!ctx || !record) return null;
  const row = ctx[record.id];
  const reasons = hostReasons(record, hostMissing(record));
  const next = row?.next;
  return (
    <span className="mt-2 flex min-w-0 flex-col gap-1">
      {next ? (
        <span className={`grid min-w-0 grid-cols-[10px_minmax(0,1fr)] items-start gap-1.5 text-[12px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>
          <span className="pt-[3px]"><StateDot k={next.state?.k} /></span>
          <span className="min-w-0">
            {next.title} · {dayLabel(next.start_on)}
            <span className="block font-medium text-[var(--color-text-secondary)]">{stateLine(next.state)}</span>
          </span>
        </span>
      ) : row?.needs_next ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-info-50)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-info-700)]">
          <StateDot k="none" /> No next event
        </span>
      ) : null}
      {reasons.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1">
          {reasons.map((r) => <span key={r} className={`rounded-full bg-[var(--color-error-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-error-700)] ${WORDS}`}>{r}</span>)}
        </span>
      )}
    </span>
  );
}
