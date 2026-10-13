import { SectionCard } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { DueBadge } from "../DueBadge";
import { StageBadge } from "../StageBadge";
import { displayOwners, icpLabel, regionName } from "../../../lib/crmModel";
import { buildCrmHash } from "../../../lib/crmUrl";

export const LINK_BUTTON_CLASS = [
  "inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-semibold no-underline max-sm:h-11",
  "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
  "transition-all duration-150 ease-out hover:bg-[var(--gray-50)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
].join(" ");

export const ROW_LINK_CLASS = [
  "flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 no-underline sm:px-5",
  "transition-colors duration-150 hover:bg-[var(--gray-50)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]",
].join(" ");

/**
 * What is due in one pipeline (issue #3802). Every row opens that card.
 *   rows       the rows the server returned (never more than its limit)
 *   total      how many are due in all (overdue + today), counted by the server
 *   who        "owners" shows who owns each card (the team's list);
 *              "place" shows the region and ICP (a person's own list)
 *   moreHref   where "Open the list" goes when there are more than the rows
 */
export function DueList({
  title,
  pipeline,
  def,
  rows,
  total,
  regions,
  team,
  today,
  who = "place",
  moreHref,
  loading = false,
  action,
  emptyText,
}) {
  const plural = pipeline === "creators" ? "Creators" : "Hosts";
  const singular = pipeline === "creators" ? "creator" : "host";
  const list = Array.isArray(rows) ? rows : [];
  return (
    <SectionCard title={title} action={action} noPadding>
      {loading ? (
        <div className="flex flex-col gap-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading">
          <Skeleton height={18} width="70%" />
          <Skeleton height={18} width="55%" />
          <Skeleton height={18} width="62%" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-3 p-4 sm:p-5">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {emptyText || `Nothing is due for ${singular}s.`}
          </p>
          <a href={buildCrmHash(pipeline, {})} className={LINK_BUTTON_CLASS}>
            Open {plural}
          </a>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--gray-200)]">
          {list.map((r) => {
            const place = [regionName(regions, r.region_id), icpLabel(def, r.icp)].filter(Boolean).join(` ${String.fromCharCode(183)} `);
            const sub = who === "owners" ? displayOwners(r, team) : place;
            return (
              <li key={r.id}>
                <a href={buildCrmHash(pipeline, { card: r.id })} className={ROW_LINK_CLASS}>
                  <span className="min-w-0 flex-[2_1_180px]">
                    <span className="block break-words text-sm font-semibold text-[var(--color-text-primary)]">{r.name}</span>
                    {sub ? <span className="block break-words text-xs text-[var(--color-text-tertiary)]">{sub}</span> : null}
                  </span>
                  <span className="min-w-0 flex-[2_1_140px] break-words text-sm text-[var(--color-text-secondary)]">
                    {r.next_action || "No next action set"}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <DueBadge dueOn={r.due_on} today={today} />
                    <StageBadge def={def} stage={r.stage} />
                  </span>
                </a>
              </li>
            );
          })}
          {total > list.length && moreHref ? (
            <li>
              <a href={moreHref} className={`${ROW_LINK_CLASS} text-sm font-semibold text-[var(--color-brand-500)]`}>
                Showing {list.length} of {total}. Open the list
              </a>
            </li>
          ) : null}
        </ul>
      )}
    </SectionCard>
  );
}
