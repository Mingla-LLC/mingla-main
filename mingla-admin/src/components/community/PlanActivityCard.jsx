// Issue #4270 (Wave 7) — quiet plan lines in a Brand group, folded into one
// card: "Seth added 5 items to the plan" with one row per line. A line that
// names a plan item still on the plan opens it in the side panel beside the
// chat; one that does not (removed since, renamed past recognition, or a
// teammate without Hosts and Creators access) is plain text, never a dead
// button. Plan lines get no Reply, React or Select.
import { Calendar } from "lucide-react";
import { PLAN_KIND_WORDS, planDay } from "../../lib/brandPlan";
import { clockTime, matchPlanLine, planActivityWords } from "../../lib/brandGroupInbox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function planItemSide(item) {
  return item.kind === "task" ? { kind: "card", id: item.id } : { kind: "content", id: item.id };
}

export function PlanActivityCard({ lines, items, brandName, onOpen }) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return null;
  const last = list[list.length - 1];
  return (
    <div data-plan-activity="" className="mx-auto flex w-full max-w-[84%] flex-col gap-1.5 rounded-[14px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Calendar aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-brand-700)]" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--color-text-primary)]">{planActivityWords(list)}</span>
        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{clockTime(last.created_at)}</span>
      </div>
      <ul className="flex min-w-0 flex-col gap-0.5">
        {list.map((line) => {
          const item = onOpen ? matchPlanLine(line.content, items, brandName) : null;
          return (
            <li key={line.id} className="min-w-0">
              {item ? (
                <button type="button" data-plan-line={`${item.kind}:${item.id}`} onClick={() => onOpen(planItemSide(item))}
                  className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>
                  <span className="shrink-0 font-semibold text-[var(--color-text-secondary)]">{planDay(item.on)}</span>
                  <span className="shrink-0 text-[var(--color-text-tertiary)]">· {PLAN_KIND_WORDS[item.kind]} ·</span>
                  <span className={`min-w-0 flex-1 truncate text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span>
                </button>
              ) : (
                <p data-system-line="" className={`px-2 py-1 text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>{line.content}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
