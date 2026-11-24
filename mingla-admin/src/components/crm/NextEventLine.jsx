// Issue #3980 (R1) — on a host card on the board or the list: the host's
// next dated thing with its plain state ("Bachata Social · 21 Oct", then
// "Too late for promo", or "Not live yet, live by 1 Nov"), or a blue
// "No next event" flag. The rows come from one ops_host_next call per load,
// shared through HostNextContext; creators get nothing.
// #4571 (design v5): this is now the card's one status line when the next
// event is the most useful fact. The red reason pills moved off the card into
// one amber problem count (RecordCard cardProblems, hover lists them).
import { useHostNextRow } from "../../hooks/useHostNextRow";
import { StateDot } from "../ops/StateDot";
import { dayLabel, stateLine } from "../../lib/opsModel";

export function NextEventLine({ record }) {
  const row = useHostNextRow(record);
  const next = row?.next;
  if (next) {
    const state = stateLine(next.state);
    const words = `${next.title} · ${dayLabel(next.start_on)}${state ? ` · ${state}` : ""}`;
    return (
      <span data-next-event="" title={words} className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
        <StateDot k={next.state?.k} />
        <span className="min-w-0 truncate">{words}</span>
      </span>
    );
  }
  if (row?.needs_next) {
    return (
      <span data-next-event="none" className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-info-700)]">
        <StateDot k="none" /> No next event
      </span>
    );
  }
  return null;
}
