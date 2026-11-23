// Issue #4571 W6b — the weekly outreach numbers on the Team dashboard, counted
// by the server from the data (crm_outreach_numbers): per rep, calls made,
// connected, demos booked, emails sent and replies, with the connect rate
// (connected / calls) and the demo rate (demos booked / connected). A rate
// with nothing to divide by shows "--", never 0%. Days are Lagos days. The
// tracking Work cards keep the targets only; nobody types these numbers.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SectionCard } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { useOpsPoll } from "../../../hooks/useOpsWork";
import { fetchOutreachNumbers } from "../../../services/crmService";
import { loadErrorWords } from "../../../lib/crmModel";
import { localWhen } from "../../../lib/opsModel";
import { OUTREACH_COLUMNS, addDays, outreachRows, weekStart } from "../../../lib/sopTools";

function lagosToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function weekWords(from) {
  const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(from)} to ${fmt(addDays(from, 6))}`;
}

const CELL = "px-2 py-1.5 text-right tabular-nums";

export function OutreachNumbers({ viewerKey = "" }) {
  const thisWeek = useMemo(() => weekStart(lagosToday()), []);
  const [from, setFrom] = useState(thisWeek);
  const [open, setOpen] = useState("");
  const to = addDays(from, 6);
  const numbers = useOpsPoll(() => fetchOutreachNumbers(from, to), { key: `${viewerKey}|outreach-numbers|${from}`, intervalMs: 300_000 });
  const rows = outreachRows(numbers.data);
  const totals = numbers.data?.totals || null;
  const lastMail = numbers.data?.mail_last_logged_at || null;

  const action = (
    <div className="flex items-center gap-1" role="group" aria-label="Week">
      <Button variant="ghost" size="sm" className="min-h-11" icon={ChevronLeft} aria-label="Previous week" onClick={() => setFrom(addDays(from, -7))} />
      <Button variant={from === thisWeek ? "secondary" : "ghost"} size="sm" className="min-h-11" aria-pressed={from === thisWeek} onClick={() => setFrom(thisWeek)}>This week</Button>
      <Button variant="ghost" size="sm" className="min-h-11" icon={ChevronRight} aria-label="Next week" disabled={from >= thisWeek} onClick={() => setFrom(addDays(from, 7))} />
    </div>
  );

  return (
    <SectionCard title="Outreach numbers" subtitle={`${weekWords(from)}, Lagos days, counted from the logs`} action={action}>
      {numbers.loading && !numbers.data ? (
        <div aria-busy="true" aria-label="Loading the outreach numbers"><Skeleton height={140} /></div>
      ) : numbers.error && !numbers.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-error-700)]">
          <span>Couldn’t load the numbers. {loadErrorWords(numbers.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => numbers.refetch()}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">No calls or emails were logged this week. Every logged call and every email the Mail logging run sends counts here.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-[12px] text-[var(--color-text-tertiary)]">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Who</th>
                  {OUTREACH_COLUMNS.map((c) => <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">{c.label}</th>)}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Connect rate</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Demo rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RepRows key={r.rep} row={r} open={open === r.rep} onToggle={() => setOpen(open === r.rep ? "" : r.rep)} />
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t border-[var(--gray-200)] font-semibold text-[var(--color-text-primary)]">
                    <th scope="row" className="px-2 py-1.5 text-left">Team</th>
                    {OUTREACH_COLUMNS.map((c) => <td key={c.key} className={CELL}>{totals[c.key]}</td>)}
                    <td className={CELL}>{outreachRows({ reps: [{ rep: "t", totals }] })[0].connectRate}</td>
                    <td className={CELL}>{outreachRows({ reps: [{ rep: "t", totals }] })[0].demoRate}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">
            Connected is Demo booked, Spoke – follow up, Call back or Not interested. Demo rate is demos booked out of connected calls. Emails count by the address they were sent from; replies by the mailbox they reached.
            {" "}{lastMail ? `Emails last logged ${localWhen(lastMail)}.` : "No emails have been logged yet."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function RepRows({ row, open, onToggle }) {
  return (
    <>
      <tr className="border-b border-[var(--gray-100)]">
        <th scope="row" className="px-2 py-1.5 text-left font-medium text-[var(--color-text-primary)]">
          <button type="button" aria-expanded={open} onClick={onToggle} className="min-h-9 text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]">
            {row.name}
          </button>
        </th>
        {OUTREACH_COLUMNS.map((c) => <td key={c.key} className={CELL}>{row.totals[c.key] ?? 0}</td>)}
        <td className={CELL}>{row.connectRate}</td>
        <td className={CELL}>{row.demoRate}</td>
      </tr>
      {open && row.days.map((d) => (
        <tr key={d.day} className="text-[12px] text-[var(--color-text-secondary)]">
          <td className="px-2 py-1 pl-6 text-left">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</td>
          {OUTREACH_COLUMNS.map((c) => <td key={c.key} className={CELL}>{d[c.key] ?? 0}</td>)}
          <td className={CELL}>{d.connectRate}</td>
          <td className={CELL}>{d.demoRate}</td>
        </tr>
      ))}
    </>
  );
}
