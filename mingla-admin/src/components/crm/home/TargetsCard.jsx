import { SectionCard } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Skeleton } from "../../ui/Skeleton";
import { regionSlug, targetPill } from "../../../lib/crmModel";
import { targetSliceHash } from "../../../lib/crmUrl";

export const GONE_REGION = "A region no longer in the list";

const CELLS = "grid min-w-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto_auto] items-center gap-x-3 gap-y-1";

/**
 * "Targets this month" (issue #3802). One row per target with how many hosts
 * are in the pipeline for it and a done / target pill, both counted by the
 * server. A row opens that slice of the Hosts board. Read-only unless
 * `renderControls` is given (the Team dashboard, for an owner or admin).
 *   emptyHint       the second sentence of the empty state
 *   renderControls  (target) => node, shown beside the row
 *   footer          shown under the rows (the add form)
 */
export function TargetsCard({ targets, loading = false, emptyHint, renderControls, footer, subtitle }) {
  const list = Array.isArray(targets) ? targets : [];
  return (
    <SectionCard title="Targets this month" subtitle={subtitle} noPadding>
      {loading ? (
        <div className="flex flex-col gap-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading">
          <Skeleton height={18} width="80%" />
          <Skeleton height={18} width="64%" />
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-text-secondary)] sm:p-5">
              No targets yet.{emptyHint ? ` ${emptyHint}` : ""}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--gray-200)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] sm:px-5" aria-hidden="true">
                <span className={CELLS}>
                  <span>Region</span>
                  <span>ICP</span>
                  <span className="text-right">In pipeline</span>
                  <span className="min-w-[64px] text-right">Done</span>
                </span>
                {renderControls ? <span className="w-[168px] shrink-0 max-sm:hidden" /> : null}
              </div>
              <ul className="divide-y divide-[var(--gray-200)]">
                {list.map((t) => {
                  const gone = !t.region_name;
                  const cells = (
                    <>
                      <span className="break-words text-sm font-semibold text-[var(--color-text-primary)]">
                        {gone ? GONE_REGION : t.region_name}
                      </span>
                      <span className="break-words text-sm text-[var(--color-text-secondary)]">{t.icp_label}</span>
                      <span className="text-right text-sm tabular-nums text-[var(--color-text-primary)]">
                        <span className="sr-only">In pipeline: </span>
                        {t.in_pipeline}
                      </span>
                      <span className="min-w-[64px] text-right">
                        <Badge variant={targetPill(t.done, t.monthly_target)}>
                          <span className="sr-only">Done: </span>
                          <span className="tabular-nums">{`${t.done} / ${t.monthly_target}`}</span>
                        </Badge>
                      </span>
                    </>
                  );
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-5">
                      {gone ? (
                        <span className={`${CELLS} min-h-11`}>{cells}</span>
                      ) : (
                        <a
                          href={targetSliceHash(t.icp, regionSlug(t.region_name))}
                          aria-label={`${t.region_name}, ${t.icp_label}: ${t.done} of ${t.monthly_target} done, ${t.in_pipeline} in the pipeline. Open these hosts`}
                          className={`${CELLS} min-h-11 rounded-lg no-underline transition-colors duration-150 hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]`}
                        >
                          {cells}
                        </a>
                      )}
                      {renderControls ? <span className="flex shrink-0 flex-wrap items-center gap-2 sm:w-[168px] sm:justify-end">{renderControls(t)}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {footer ? <div className="border-t border-[var(--gray-200)] p-4 sm:p-5">{footer}</div> : null}
        </>
      )}
    </SectionCard>
  );
}
