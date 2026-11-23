// Issue #4255 (W2, rev2) — the sprint bar, one line under the header
// (replaces SprintStrip): week arrows and dates, Day n of 7, each sprint goal
// as a checkable pill (state dot, title, cards done of its cards) that
// filters the board to its cards, then cards done of planned, hours planned
// against the team's hours (red over 100%), the late count and Plan sprint.
// The goals scroll inside the bar; the numbers and Plan sprint never move off
// screen. On a phone the whole bar scrolls sideways instead of wrapping.
// The bar is `relative` so it is the containing block of the goals'
// screen-reader text (absolutely positioned): without it that text escaped the
// bar's scroll box and widened the whole page on a phone (390px -> 670px).
// #4571: the first three goals are pills; the rest fold into "+N more",
// which opens a list of them (fixed, so the bar's overflow never clips it).
// #4571 rework: on a wide screen the pills shrink (truncating their titles) so
// "+N more" always sits inside the bar; the goals strip never scrolls there.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { sprintLabel } from "../../lib/opsModel";
import { goalFold, goalPillsThatFit, goalStateLabel, sprintDay, sprintProgress, teamCapacity } from "../../lib/workBoardModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

const STATE_DOT = {
  on_track: "bg-[var(--color-success-600)]",
  at_risk: "bg-[var(--color-warning-500,var(--color-warning-600))]",
  done: "bg-[var(--color-info-500)]",
  missed: "bg-[var(--color-error-500)]",
};

function GoalPill({ g, on, onGoal, wide = false }) {
  return (
    <button type="button" data-goal-pill={g.id} aria-pressed={on ? "true" : "false"}
      title={`${g.title} · ${goalStateLabel(g.state)}${g.owner_name ? ` · ${g.owner_name}` : ""}`}
      onClick={() => onGoal(on ? null : g.id)}
      className={`inline-flex h-8 ${wide ? "w-full" : "min-w-[8rem] max-w-[15rem] shrink max-sm:shrink-0"} items-center gap-1.5 rounded-full border px-2.5 text-[12px] ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[g.state] || STATE_DOT.on_track}`} />
      <span className="min-w-0 flex-1 truncate text-left font-semibold text-[var(--color-text-primary)]">{g.title}</span>
      <span className="shrink-0 tabular-nums">{Number(g.done) || 0}/{Number(g.cards) || 0}</span>
      <span className="sr-only">{goalStateLabel(g.state)}</span>
    </button>
  );
}

function MoreGoals({ goals, goalId, onGoal }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!listRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const toggle = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) });
    setOpen(!open);
  };
  const picked = goals.some((g) => g.id === goalId);
  return (
    <>
      <button ref={buttonRef} type="button" data-goals-more="" aria-haspopup="dialog" aria-expanded={open ? "true" : "false"} aria-label={`${goals.length} more goals`} onClick={toggle}
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold ${picked ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
        +{goals.length} more<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open && at && (
        <div ref={listRef} role="dialog" aria-label="More sprint goals" style={{ top: at.top, left: at.left }}
          className="fixed z-40 flex max-h-[60vh] w-72 max-w-[calc(100vw-1rem)] flex-col gap-1 overflow-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1.5 shadow-[var(--shadow-lg)]">
          {goals.map((g) => <GoalPill key={g.id} g={g} on={goalId === g.id} wide onGoal={(id) => { onGoal(id); setOpen(false); }} />)}
        </div>
      )}
    </>
  );
}

export function SprintBar({ sprint, plan = null, today, late = 0, goalId = null, onGoal, onWeek, onThisWeek, isThisWeek, onPlan, online = true }) {
  const goals = Array.isArray(plan?.goals) ? plan.goals : Array.isArray(sprint?.goals) ? sprint.goals : [];
  // #4571 rework: on a wide screen, only the pills that fit; the rest fold into "+N more".
  const stripRef = useRef(null);
  const [stripWidth, setStripWidth] = useState(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined" || typeof window === "undefined" || !window.matchMedia) return undefined;
    const wide = window.matchMedia("(min-width: 640px)");
    const measure = () => setStripWidth(wide.matches ? el.clientWidth : null);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    wide.addEventListener?.("change", measure);
    measure();
    return () => { ro.disconnect(); wide.removeEventListener?.("change", measure); };
  }, []);
  const fold = goalFold(goals, goalPillsThatFit(stripWidth, goals.filter((g) => g && !g.archived).length));
  const day = sprintDay(sprint?.starts_on, today);
  const prog = sprintProgress(plan?.in_sprint);
  const cap = teamCapacity(plan?.capacity);
  return (
    <div data-sprint-bar="" className="relative flex h-11 min-w-0 flex-nowrap items-center gap-2 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-1.5 max-sm:overflow-x-auto">
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label="Previous week" onClick={() => onWeek(-7)} className={`inline-grid h-9 w-8 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        <h2 className="whitespace-nowrap text-[13px] font-semibold text-[var(--color-text-primary)]">{sprintLabel(sprint?.starts_on || "")}</h2>
        <button type="button" aria-label="Next week" onClick={() => onWeek(7)} className={`inline-grid h-9 w-8 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        {!isThisWeek && <button type="button" onClick={onThisWeek} className={`h-9 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-100)] ${FOCUS}`}>This week</button>}
        {day >= 1 && day <= 7 && <span className="hidden whitespace-nowrap pl-1 text-[12px] text-[var(--color-text-tertiary)] sm:inline">Day {day} of 7</span>}
      </div>
      <div ref={stripRef} data-sprint-goals="" role="group" aria-label="Sprint goals" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-1 max-sm:min-w-max max-sm:overflow-visible">
        {goals.length === 0 ? (
          <span className="whitespace-nowrap px-1 text-[12.5px] text-[var(--color-text-tertiary)]">No sprint goals yet</span>
        ) : (
          <>
            {fold.shown.map((g) => <GoalPill key={g.id} g={g} on={goalId === g.id} onGoal={onGoal} />)}
            {fold.more.length > 0 && <MoreGoals goals={fold.more} goalId={goalId} onGoal={onGoal} />}
          </>
        )}
      </div>
      <div data-sprint-numbers="" className="flex shrink-0 items-center gap-2 pl-1">
        <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--color-text-secondary)] md:inline-flex">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct} aria-label={`${prog.done} of ${prog.planned} cards done`}>
            <span className="block h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${prog.pct}%` }} />
          </span>
          <span className="tabular-nums">{prog.done} of {prog.planned} done</span>
        </span>
        <span data-sprint-capacity="" className={`hidden whitespace-nowrap text-[12px] tabular-nums lg:inline ${cap.over ? "font-semibold text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`}>
          {cap.set ? `${cap.plannedHours} of ${cap.capHours} h planned` : `${cap.plannedHours} h planned · set hours`}
        </span>
        {late > 0 && <span className="whitespace-nowrap rounded-full bg-[var(--color-error-50)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-error-700)]">{late} late</span>}
        <button type="button" data-plan-sprint="" disabled={!online} onClick={onPlan} className={`h-8 whitespace-nowrap rounded-lg border border-[var(--gray-200)] px-2.5 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>Plan sprint</button>
      </div>
    </div>
  );
}
