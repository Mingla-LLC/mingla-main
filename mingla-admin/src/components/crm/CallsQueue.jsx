// #4571 W3: "My calls today" (#/hosts?view=calls). The caller's own hosts due
// today or earlier, in the SOP order the server decides (crm_calls_queue):
// Replied and Demo booked pinned first, then Contacted, then Prospect, then
// oldest due first. A row opens the card beside (&card=).
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { Badge } from "../ui/Badge";
import { QuickLinks } from "./RecordCard";
import { callsQueue } from "../../services/crmService";
import { lastTouchWords, loadErrorWords, stageLabel } from "../../lib/crmModel";
import { dayLabel } from "../../lib/opsModel";

export function CallsQueue({ def, today, onOpen, tick = 0 }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: !s.data }));
    callsQueue(today).then(
      (data) => { if (live) setState({ loading: false, error: null, data }); },
      (error) => { if (live) setState((s) => ({ ...s, loading: false, error })); },
    );
    return () => { live = false; };
  }, [today, tick, again]);
  const rows = Array.isArray(state.data?.records) ? state.data.records : [];
  if (state.loading) {
    return <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading my calls"><Skeleton height={64} /><Skeleton height={64} /></div>;
  }
  if (state.error && !state.data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-error-700)]">
        <span>Couldn’t load your calls. {loadErrorWords(state.error)}</span>
        <Button variant="secondary" className="min-h-11" onClick={() => setAgain((n) => n + 1)}>Try again</Button>
      </div>
    );
  }
  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-[var(--gray-300)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">No calls due today. Hosts you own show here on their next follow-up date.</p>;
  }
  return (
    <section aria-label="My calls today" data-calls-queue="">
      <p className="mb-2 text-[13px] text-[var(--color-text-tertiary)]">{rows.length} due · replies and booked demos first</p>
      <ol className="flex min-w-0 flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <div role="button" tabIndex={0} data-call-row={r.id} aria-label={`Open ${r.name}`}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(r.id); } }}
              className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <b className="text-sm text-[var(--color-text-primary)]">{r.name}</b>
                <Badge variant={r.pinned ? "warning" : "outline"}>{stageLabel(def, r.stage)}</Badge>
                {r.contact_rule && <Badge variant="error">{r.contact_rule === "do_not_contact" ? "Do not contact" : "Warm intro only"}</Badge>}
                <span className="text-xs text-[var(--color-text-tertiary)]">Due {dayLabel(r.due_on)}</span>
              </div>
              <QuickLinks record={r} />
              <span className="text-xs text-[var(--color-text-tertiary)]">{lastTouchWords(r) ? `Touched ${lastTouchWords(r)}` : "Not contacted yet"}{r.next_action ? ` · ${r.next_action}` : ""}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
