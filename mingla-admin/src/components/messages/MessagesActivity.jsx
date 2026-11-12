// Issue #4398 — Messages > Mingla activity: cards Mingla added or closed,
// Feature Guide notices, edits and system alerts. They count as unread here
// in Admin and never push to a phone or email. One line per kind per day
// (team_activity groups them); a line opens to show what it holds, and Mark
// all read clears them in one tap.
import { useState } from "react";
import { CheckCheck, ChevronRight } from "lucide-react";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { markActivityRead } from "../../services/dashboardService";
import { activityDays } from "../../lib/activityModel";
import { opsErrorWords, todayIso } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function MessagesActivity({ activity }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);
  if (activity.loading && !activity.data) return <div className="flex flex-col gap-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;
  if (activity.error && !activity.data) return <div className="p-3"><LoadError title="Couldn’t load Mingla activity" message={opsErrorWords(activity.error)} onRetry={activity.refetch} /></div>;
  const days = activityDays(activity.data?.groups, todayIso());
  const unread = Number(activity.data?.unread?.mingla || 0);
  const markAll = async () => {
    setBusy(true);
    try { await markActivityRead("mingla"); await activity.refetch(); addToast({ variant: "success", title: "All Mingla activity marked read" }); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t mark it read", description: opsErrorWords(error) }); }
    finally { setBusy(false); }
  };
  return (
    <div data-activity="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 text-[12px] text-[var(--color-text-tertiary)]">What Mingla’s bots did, edits and system alerts. Admin only, never pushed.</p>
        <button type="button" data-activity-mark-all="" disabled={busy || unread === 0} onClick={markAll}
          className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-50 ${FOCUS}`}>
          <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />Mark all read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {days.length === 0 && <p className="px-3 py-6 text-[13px] text-[var(--color-text-tertiary)]">Nothing from Mingla in the last two weeks.</p>}
        {days.map((d) => (
          <section key={d.day} aria-label={d.label}>
            <h3 className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-tertiary)]">{d.label}</h3>
            <ul>
              {d.groups.map((g) => {
                const key = `${g.day}:${g.kind}:${g.group}`;
                const isOpen = !!open[key];
                return (
                  <li key={key} data-activity-group={g.kind}>
                    <button type="button" aria-expanded={isOpen ? "true" : "false"} onClick={() => setOpen({ ...open, [key]: !isOpen })}
                      className={`flex min-h-14 w-full min-w-0 items-start gap-2.5 border-b border-[var(--gray-100)] px-3 py-2.5 text-left ${Number(g.unread) > 0 ? "bg-[var(--color-brand-50)]" : "bg-[var(--color-background-primary)]"} ${FOCUS}`}>
                      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${Number(g.unread) > 0 ? "bg-[var(--gray-400)]" : ""}`} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="break-words text-[13.5px] font-semibold text-[var(--color-text-primary)]">{g.head}</span>
                        {g.sub && <span className="break-words text-[12px] text-[var(--color-text-secondary)]">{g.sub}</span>}
                      </span>
                      <ChevronRight aria-hidden="true" className={`mt-1 h-4 w-4 shrink-0 text-[var(--color-text-tertiary)] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                    {isOpen && (
                      <ul className="bg-[var(--color-background-secondary)] py-1">
                        {(g.items || []).map((i) => (
                          <li key={i.id} className="px-3 py-1.5 pl-8">
                            {i.card_id ? <a href={`#/work-board?card=${i.card_id}`} className={`break-words text-[13px] text-[var(--color-text-primary)] hover:underline ${FOCUS}`}>{i.text}</a>
                              : <span className="break-words text-[13px] text-[var(--color-text-primary)]">{i.text}</span>}
                          </li>
                        ))}
                        {Number(g.count) > (g.items || []).length && <li className="px-3 py-1.5 pl-8 text-[12.5px] text-[var(--color-text-tertiary)]">…{Number(g.count) - g.items.length} more</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
