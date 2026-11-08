// Issue #4270 (Wave 7) — the Brand group list: who is waiting on Mingla, for
// how long, what is next on their plan, and what is unread. Filters: Needs
// reply (oldest wait first), Mine and Plan this week (Hosts and Creators
// access only), All. Search covers the brand, the host card and the last
// message. Every row is a button; nothing here leaves the page.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import {
  INBOX_FILTER_WORDS,
  inboxTime,
  initialsOf,
  nextPlanWords,
  previewWords,
  waitingWords,
} from "../../lib/brandGroupInbox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

/** Re-render every minute so "Waiting 12m" keeps counting. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function GroupAvatar({ group, size = "md" }) {
  const box = size === "lg" ? "h-[42px] w-[42px] rounded-[13px] text-[15px]" : "h-10 w-10 rounded-xl text-[13px]";
  if (group?.brand_photo_url) return <img src={group.brand_photo_url} alt="" className={`${box} shrink-0 object-cover`} />;
  return (
    <span aria-hidden="true" className={`${box} inline-grid shrink-0 place-items-center bg-[var(--color-brand-100)] font-bold text-[var(--color-brand-700)]`}>
      {initialsOf(group?.brand_name)}
    </span>
  );
}

/** "Harmattan Club, waiting 2h 14m, 2 unread, next Sun Doors open tonight". */
export function rowLabel(group, nowMs) {
  const parts = [group.brand_name || "Brand group"];
  const wait = waitingWords(group.waiting_since, nowMs);
  if (wait) parts.push(`waiting ${wait}`);
  if (group.unread_count > 0) parts.push(`${group.unread_count} unread`);
  const next = nextPlanWords(group.host?.plan);
  if (next) parts.push(`next ${next.replace(" · ", " ")}`);
  if (group.muted) parts.push("muted");
  return parts.join(", ");
}

/** One group row. */
export function BrandGroupRow({ group, selected, myUserId, nowMs, onOpen }) {
  const wait = waitingWords(group.waiting_since, nowMs);
  const next = nextPlanWords(group.host?.plan);
  const unread = group.unread_count > 0;
  return (
    <button
      type="button"
      data-group-row={group.conversation_id}
      aria-current={selected ? "true" : undefined}
      aria-label={rowLabel(group, nowMs)}
      onClick={() => onOpen(group.conversation_id)}
      className={`flex w-full min-h-16 gap-3 border-b border-[var(--gray-100)] px-3.5 py-3 text-left transition-colors ${selected ? "bg-[var(--color-brand-50)] shadow-[inset_3px_0_0_var(--color-brand-500)]" : "hover:bg-[var(--gray-50)]"} ${FOCUS}`}
    >
      <GroupAvatar group={group} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[14px] text-[var(--color-text-primary)] ${unread ? "font-bold" : "font-semibold"}`}>{group.brand_name}</span>
          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{inboxTime(group.last_message_at)}</span>
        </span>
        {group.muted
          ? <span data-muted-row="" className="truncate text-[12px] text-[var(--color-text-tertiary)]">Muted · no staff push</span>
          : <span className="truncate text-[12px] text-[var(--color-text-secondary)]">{previewWords(group, myUserId)}</span>}
        {(wait || next || unread) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {wait && <span data-waiting="" className="shrink-0 rounded-md bg-[var(--color-warning-50)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-warning-700)]">Waiting {wait}</span>}
            {next && <span data-next-plan="" className="min-w-0 truncate rounded-md bg-[var(--gray-100)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">Next: {next}</span>}
            {unread && (
              <span data-unread="" className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-center text-[11px] font-bold text-white min-w-[18px] ${group.muted ? "bg-[var(--gray-500)]" : "bg-[var(--color-brand-500)]"}`}>
                {group.unread_count}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

function EmptyNeedsReply({ total, onShowAll }) {
  return (
    <div data-list-empty="needs_reply" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">No brand is waiting on Mingla</p>
      <p className={`text-[12.5px] text-[var(--color-text-secondary)] ${WORDS}`}>Every host message has a staff reply.</p>
      <button type="button" onClick={onShowAll} className={`mt-1 min-h-11 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>
        Show all {total} groups
      </button>
    </div>
  );
}

/**
 * The list column. `rows` are already filtered and sorted (lib/brandGroupInbox
 * applyInboxFilter); `all` is every group, for the counts.
 */
export function BrandGroupList({ rows, all, loading, filter, onFilter, query, onQuery, canHosts, selectedId, myUserId, onOpen, waitingCount, nowMs }) {
  const filters = canHosts ? ["needs_reply", "mine", "plan_week", "all"] : ["needs_reply", "all"];
  const total = (all || []).length;
  return (
    <div data-group-list="" className="flex min-h-0 flex-1 flex-col bg-[var(--color-background-secondary)]">
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold text-[var(--color-text-primary)]">Brand groups</h2>
          <span className="text-[12px] text-[var(--color-text-tertiary)]">{total} active</span>
        </div>
        <label htmlFor="brand-group-search" className="flex items-center gap-2 rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 focus-within:ring-2 focus-within:ring-[var(--color-brand-700)]">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="sr-only">Search brand groups</span>
          <input id="brand-group-search" type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search brands, hosts, messages"
            className="min-h-10 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none" />
        </label>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {filters.map((id) => {
            const on = filter === id;
            const label = id === "needs_reply" && waitingCount > 0 ? `${INBOX_FILTER_WORDS[id]} · ${waitingCount}` : INBOX_FILTER_WORDS[id];
            return (
              <button key={id} type="button" data-filter={id} aria-pressed={on ? "true" : "false"} onClick={() => onFilter(id)}
                className={`min-h-9 rounded-full border px-3 text-[12px] ${on ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] font-semibold text-[var(--color-background-primary)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-scroll="list">
        {loading ? (
          <ul aria-busy="true" aria-label="Loading Brand groups" className="flex flex-col">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex gap-3 border-b border-[var(--gray-100)] px-3.5 py-3">
                <Skeleton width={40} height={40} />
                <span className="flex flex-1 flex-col gap-2"><Skeleton width="60%" height={13} /><Skeleton width="85%" height={11} /></span>
              </li>
            ))}
          </ul>
        ) : total === 0 ? (
          <p className="p-5 text-[13px] text-[var(--color-text-secondary)]">Active Host brands will appear here automatically.</p>
        ) : rows.length === 0 && String(query || "").trim() ? (
          <p className="p-5 text-[13px] text-[var(--color-text-secondary)]">No Brand groups match that search.</p>
        ) : rows.length === 0 && filter === "needs_reply" ? (
          <EmptyNeedsReply total={total} onShowAll={() => onFilter("all")} />
        ) : rows.length === 0 ? (
          <p className="p-5 text-[13px] text-[var(--color-text-secondary)]">{filter === "mine" ? "No Brand group has you as its Mingla owner." : "No brand has anything on its plan from today to Sunday."}</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((group) => (
              <li key={group.conversation_id}>
                <BrandGroupRow group={group} selected={selectedId === group.conversation_id} myUserId={myUserId} nowMs={nowMs} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
