import { SectionCard } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Skeleton } from "../../ui/Skeleton";
import { ROLE_LABELS } from "../../../lib/access";
import { weekIsEmpty, weekRows } from "../../../lib/crmModel";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const NUM = "px-3 py-2 text-right text-sm tabular-nums text-[var(--color-text-primary)]";

/**
 * "This week by person" (issue #3802): what each teammate logged since Monday
 * (UTC) and what they have due. Every figure is the server's count. A person's
 * name is a link that lists what they have due.
 *   hrefFor(email) -> the address that picks that person
 *   onPick(email)  -> called on a plain click (the page scrolls to the list)
 */
export function WeekByPerson({ byPerson, loading = false, selected = "", hrefFor, onPick }) {
  const rows = weekRows(byPerson);
  return (
    <SectionCard title="This week by person" subtitle="Since Monday (UTC)" noPadding>
      {loading ? (
        <div className="flex flex-col gap-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading">
          <Skeleton height={18} />
          <Skeleton height={18} width="85%" />
          <Skeleton height={18} width="70%" />
        </div>
      ) : (
        <>
          {weekIsEmpty(rows) ? (
            <p className="border-b border-[var(--gray-200)] px-4 py-3 text-sm text-[var(--color-text-secondary)] sm:px-5">
              Nothing logged yet this week.
            </p>
          ) : null}
          <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="This week by person, table">
            <table className="w-full min-w-[800px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--gray-200)]">
                  <th scope="col" className={`${TH} pl-4 sm:pl-5`}>Person</th>
                  <th scope="col" className={TH}>Role</th>
                  <th scope="col" className={`${TH} text-right`}>Touches logged</th>
                  <th scope="col" className={`${TH} text-right`}>Of which by agent</th>
                  <th scope="col" className={`${TH} text-right`}>Stage moves</th>
                  <th scope="col" className={`${TH} text-right`}>Added</th>
                  <th scope="col" className={`${TH} text-right`}>Overdue</th>
                  <th scope="col" className={`${TH} pr-4 text-right sm:pr-5`}>Due today</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email} className={`border-b border-[var(--gray-200)] last:border-b-0 ${selected === r.email ? "bg-[var(--color-brand-50)]" : ""}`}>
                    <th scope="row" className="px-3 py-1 pl-4 text-left font-normal sm:pl-5">
                      <a
                        href={hrefFor(r.email)}
                        aria-current={selected === r.email ? "true" : undefined}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                          e.preventDefault();
                          onPick(r.email);
                        }}
                        title={r.email}
                        className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[var(--color-text-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                      >
                        {r.name}
                      </a>
                    </th>
                    <td className="px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                      {r.former ? (
                        <Badge variant="default">No longer on the team</Badge>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {ROLE_LABELS[r.role] || ""}
                          {r.invited ? <Badge variant="info">Invited</Badge> : null}
                        </span>
                      )}
                    </td>
                    <td className={NUM}>{r.touches}</td>
                    <td
                      className={NUM}
                      aria-label={`${r.touchesBy.claude + r.touchesBy.codex} of ${r.touches} touches were by agents: Claude ${r.touchesBy.claude}, Codex ${r.touchesBy.codex}`}
                    >
                      <span aria-hidden="true" className="flex flex-col items-end">
                        {r.touchesBy.claude + r.touchesBy.codex > 0 ? (
                          <>
                            <span>{r.touchesBy.claude + r.touchesBy.codex}</span>
                            <span className="text-xs text-[var(--color-text-secondary)]">Claude {r.touchesBy.claude} · Codex {r.touchesBy.codex}</span>
                          </>
                        ) : (
                          <span className="text-[var(--color-text-secondary)]">None</span>
                        )}
                      </span>
                    </td>
                    <td className={NUM}>{r.stageMoves}</td>
                    <td className={NUM}>{r.added}</td>
                    <td className={`${NUM} ${r.overdue > 0 ? "font-semibold text-[var(--color-error-700)]" : ""}`}>{r.overdue}</td>
                    <td className={`${NUM} pr-4 sm:pr-5`}>{r.dueToday}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}
