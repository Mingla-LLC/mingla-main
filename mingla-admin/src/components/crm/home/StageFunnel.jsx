import { SectionCard } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { funnelRows } from "../../../lib/crmModel";
import { NEW_CARD, buildCrmHash } from "../../../lib/crmUrl";
import { LINK_BUTTON_CLASS } from "./DueList";

/**
 * One pipeline by stage (issue #3802): a row per stage with a bar and the
 * count the server returned. A stage with nobody in it is an empty bar. Every
 * row opens the board.
 */
export function StageFunnel({ title, pipeline, stages, loading = false }) {
  const plural = pipeline === "creators" ? "creators" : "hosts";
  const singular = pipeline === "creators" ? "creator" : "host";
  const board = buildCrmHash(pipeline, {});
  const rows = funnelRows(stages);
  const none = rows.every((r) => r.count === 0);
  return (
    <SectionCard
      title={title}
      action={
        <a href={board} className={`${LINK_BUTTON_CLASS} h-8 px-3 text-xs max-sm:h-10`}>
          Open board
        </a>
      }
      noPadding
    >
      {loading ? (
        <div className="flex flex-col gap-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} height={14} width={`${90 - i * 9}%`} />
          ))}
        </div>
      ) : (
        <>
          <ul className="py-1">
            {rows.map((r) => (
              <li key={r.id}>
                <a
                  href={board}
                  aria-label={`${r.label}: ${r.count}. Open the board`}
                  className="grid min-h-11 grid-cols-[minmax(84px,1fr)_minmax(0,2fr)_44px] items-center gap-3 px-4 py-1.5 no-underline transition-colors duration-150 hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)] sm:px-5"
                >
                  <span className="break-words text-sm text-[var(--color-text-primary)]">{r.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-[var(--gray-100)]" aria-hidden="true">
                    <span className="block h-full rounded-full bg-[var(--color-brand-500)]" style={{ width: `${r.width}%` }} />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{r.count}</span>
                </a>
              </li>
            ))}
          </ul>
          {none ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--gray-200)] px-4 py-3 sm:px-5">
              <p className="text-sm text-[var(--color-text-secondary)]">No {plural} yet.</p>
              <a href={buildCrmHash(pipeline, { card: NEW_CARD })} className={LINK_BUTTON_CLASS}>
                Add the first {singular}
              </a>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
