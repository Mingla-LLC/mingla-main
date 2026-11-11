// Issue #4255 (W2, rev2) — the sprint planner, opened from Plan sprint as
// panel one at full width:
//   1. Last sprint's review: done against planned, goals hit, carried cards,
//      capacity used and a one-line team note (200 characters) kept on it.
//   2. Goals: up to five, each with a title, an owner and a state (a state
//      set here is a person's; "Set by the numbers" hands it back).
//   3. Capacity: each teammate's hours this sprint against the estimates on
//      their open cards; over 100% is red.
//   4. Backlog and carried cards beside the cards in this sprint, each with
//      its owner, due date, estimate and goal, and Add or Remove.
//   5. Start sprint saves the plan as the baseline; a card added after shows
//      "added mid-sprint".
import { useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { Avatars } from "./OpsChip";
import { useToast } from "../../context/ToastContext";
import { useSprintPlan } from "../../hooks/useWorkBoard";
import * as ops from "../../services/opsService";
import { dayLabel, opsErrorWords, sprintLabel } from "../../lib/opsModel";
import { GOAL_LIMIT, GOAL_STATES, canAddGoal, capacityUse, goalTitleProblem, hoursLabel, parseEstimate, sprintProgress } from "../../lib/workBoardModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const INPUT = `min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
const H = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";

function Section({ title, aside, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3">
      <div className="flex min-w-0 items-center justify-between gap-2"><h3 className={H}>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

export function SprintPlanner({ sprintId = null, team = [], online = true, onClose, onChanged }) {
  const { addToast } = useToast();
  const read = useSprintPlan(sprintId, { intervalMs: 0 });
  const [busy, setBusy] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalOwner, setGoalOwner] = useState("");
  const [goalError, setGoalError] = useState("");
  const plan = read.data;
  const people = team.filter((p) => !p.invited);

  const act = async (label, task, success) => {
    setBusy(label);
    try {
      const out = await task();
      await read.refetch({ quiet: true });
      onChanged?.();
      if (success) addToast({ variant: "success", title: success });
      return out || true;
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "The plan changed. Showing the latest." }); await read.refetch({ quiet: true }); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
      return null;
    } finally { setBusy(""); }
  };

  const title = plan?.sprint ? `Plan ${sprintLabel(plan.sprint.starts_on).replace(/^Sprint/, "the sprint of")}` : "Plan the sprint";
  if (read.loading) {
    return <Drawer open onClose={onClose} title="Plan the sprint"><div aria-busy="true" aria-label="Loading the plan" className="flex flex-col gap-3"><Skeleton height={60} /><Skeleton height={120} /><Skeleton height={200} /></div></Drawer>;
  }
  if (read.error || !plan) {
    return <Drawer open onClose={onClose} title="Plan the sprint"><LoadError title="Couldn’t load the plan" message={opsErrorWords(read.error)} onRetry={() => read.refetch()} /></Drawer>;
  }
  const sprint = plan.sprint || {};
  const canPlan = !!plan.can_plan && online;
  const goals = Array.isArray(plan.goals) ? plan.goals : [];
  const inSprint = Array.isArray(plan.in_sprint) ? plan.in_sprint : [];
  const backlog = Array.isArray(plan.backlog) ? plan.backlog : [];
  const review = plan.review;
  const prog = sprintProgress(inSprint);
  const updateCard = (card, changes, words) => act(`card:${card.id}`, () => ops.updateWork(card.id, changes, card.revision), words);

  const cardRow = (card, inThis) => (
    <li key={card.id} data-plan-card={card.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--gray-200)] px-2.5 py-2">
      <span className="min-w-0 flex-1 basis-[12rem]">
        <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">#{card.number} {card.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
          {Number(card.carried_count) > 0 && <span className="rounded-full bg-[var(--color-warning-50)] px-1.5 font-semibold text-[var(--color-warning-700)]">carried {card.carried_count}×</span>}
          {card.added_mid_sprint && <span className="rounded-full bg-[var(--color-info-50)] px-1.5 font-semibold text-[var(--color-info-700)]">added mid-sprint</span>}
          {card.due_on && <span>Due {dayLabel(card.due_on)}</span>}
          {card.status === "done" && <span className="font-semibold text-[var(--color-success-700)]">Done</span>}
        </span>
      </span>
      {(card.owners || []).length ? <Avatars people={card.owners} /> : <span className="text-[11.5px] text-[var(--color-text-tertiary)]">No owner</span>}
      <label className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-text-tertiary)]">
        <span className="sr-only">Estimate in hours for card {card.number}</span>
        <input key={`${card.id}:${card.estimate_minutes || ""}`} defaultValue={card.estimate_minutes ? String(Math.round((card.estimate_minutes / 60) * 10) / 10) : ""} placeholder="h" inputMode="decimal" disabled={!canPlan || card.status === "done"}
          onBlur={(e) => {
            const { minutes, problem } = parseEstimate(e.target.value);
            if (problem) { addToast({ variant: "error", title: problem }); return; }
            if ((minutes || null) === (card.estimate_minutes || null)) return;
            updateCard(card, { estimate_minutes: minutes }, minutes ? `Estimate ${hoursLabel(minutes)}` : "Estimate cleared");
          }}
          className={`${INPUT} w-14 text-right`} />h
      </label>
      <label className="inline-flex items-center">
        <span className="sr-only">Goal for card {card.number}</span>
        <select value={card.goal_id || ""} disabled={!canPlan || card.status === "done" || !inThis} onChange={(e) => updateCard(card, { goal: e.target.value || null }, e.target.value ? "Goal set" : "Goal taken off")} className={`${INPUT} max-w-[11rem]`}>
          <option value="">No goal</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      </label>
      {inThis
        ? <Button variant="ghost" size="sm" disabled={!canPlan || card.status === "done" || busy === `card:${card.id}`} onClick={() => updateCard(card, { in_backlog: true }, `Card ${card.number} is back in the backlog`)}>Remove</Button>
        : <Button variant="secondary" size="sm" disabled={!canPlan || busy === `card:${card.id}`} onClick={() => updateCard(card, { week: sprint.starts_on, in_backlog: false }, `Card ${card.number} added to the sprint`)}>Add</Button>}
    </li>
  );

  return (
    <Drawer open onClose={onClose} title={title}>
      <div data-sprint-planner="" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">
            {plan.planned ? `Started ${dayLabel(plan.planned_at)}${plan.planned_by_name ? ` by ${plan.planned_by_name}` : ""}. Cards added now show as added mid-sprint.` : "Not started yet. Start sprint saves this plan as the baseline."}
            {" "}{prog.done} of {prog.planned} cards done.
          </p>
          {!plan.planned && <Button disabled={!canPlan || !!busy} onClick={() => act("start", () => ops.startSprint(sprint.id, plan.revision), "Sprint started. This plan is the baseline.")}>Start sprint</Button>}
        </div>
        {!plan.can_plan && <p role="status" className="rounded-lg bg-[var(--color-info-50)] px-3 py-2 text-[12.5px] text-[var(--color-info-700)]">A person plans the sprint. You can read it here.</p>}

        {review && (
          <Section title="Last sprint">
            <p data-sprint-review="" className="text-[13px] text-[var(--color-text-primary)]">
              {Number(review.done) || 0} of {Number(review.planned) || 0} cards done · goals hit {Number(review.goals_hit) || 0} of {Number(review.goals) || 0} · {Number(review.carried) || 0} carried over{review.capacity_used_pct !== null && review.capacity_used_pct !== undefined ? ` · ${review.capacity_used_pct}% of capacity used` : ""}
            </p>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={H}>Team note</span>
              <input key={review.note || ""} defaultValue={review.note || ""} maxLength={200} disabled={!canPlan} placeholder="One line for the team about last sprint"
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (review.note || "")) act("note", () => ops.setSprintReviewNote(review.sprint?.id, v, review.revision), "Note saved"); }}
                className={`${INPUT} w-full`} />
            </label>
          </Section>
        )}

        <Section title={`Goals · ${goals.length} of ${GOAL_LIMIT}`}>
          {goals.length === 0 && <p className="text-[13px] text-[var(--color-text-tertiary)]">No goals yet. Add up to five.</p>}
          <ul className="flex min-w-0 flex-col gap-1.5">
            {goals.map((g) => (
              <li key={g.id} data-goal-row={g.id} className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="min-w-0 flex-1 basis-[14rem]">
                  <span className="sr-only">Goal title</span>
                  <input key={g.title} defaultValue={g.title} maxLength={80} disabled={!canPlan}
                    onBlur={(e) => { const v = e.target.value.replace(/\s+/g, " ").trim(); if (v === g.title) return; const p = goalTitleProblem(v); if (p) { addToast({ variant: "error", title: p }); e.target.value = g.title; return; } act(`goal:${g.id}`, () => ops.updateSprintGoal(g.id, { title: v }, g.revision), "Goal saved"); }}
                    className={`${INPUT} w-full`} />
                </label>
                <label><span className="sr-only">Goal owner</span>
                  <select value={g.owner_email || ""} disabled={!canPlan} onChange={(e) => act(`goal:${g.id}`, () => ops.updateSprintGoal(g.id, { owner: e.target.value || null }, g.revision), "Owner saved")} className={INPUT}>
                    <option value="">No owner</option>
                    {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
                  </select>
                </label>
                <label><span className="sr-only">Goal state</span>
                  <select value={g.set_by_hand ? g.state : ""} disabled={!canPlan} onChange={(e) => act(`goal:${g.id}`, () => ops.updateSprintGoal(g.id, { state: e.target.value || null }, g.revision), "State saved")} className={INPUT}>
                    <option value="">By the numbers: {GOAL_STATES.find((s) => s.value === g.auto_state)?.label || "On track"}</option>
                    {GOAL_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <span className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{Number(g.done) || 0}/{Number(g.cards) || 0} cards</span>
                <Button variant="ghost" size="sm" disabled={!canPlan || !!busy} onClick={() => act(`goal:${g.id}`, () => ops.archiveSprintGoal(g.id, g.revision), "Goal archived. Its cards keep their place.")}>Archive</Button>
              </li>
            ))}
          </ul>
          {canAddGoal(goals) ? (
            <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const v = goalTitle.replace(/\s+/g, " ").trim();
              const p = goalTitleProblem(v);
              if (p) { setGoalError(p); return; }
              const ok = await act("goal-add", () => ops.addSprintGoal(sprint.id, v, goalOwner || null), "Goal added");
              if (ok) { setGoalTitle(""); setGoalOwner(""); }
            }}>
              <label className="min-w-0 flex-1 basis-[14rem]"><span className="sr-only">New goal</span>
                <input value={goalTitle} maxLength={80} disabled={!canPlan} placeholder="A goal for this sprint" onChange={(e) => { setGoalTitle(e.target.value); setGoalError(""); }} className={`${INPUT} w-full`} />
              </label>
              <label><span className="sr-only">New goal owner</span>
                <select value={goalOwner} disabled={!canPlan} onChange={(e) => setGoalOwner(e.target.value)} className={INPUT}>
                  <option value="">No owner</option>
                  {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
                </select>
              </label>
              <Button type="submit" variant="secondary" size="sm" disabled={!canPlan || busy === "goal-add"}>Add goal</Button>
              {goalError && <span role="alert" className="w-full text-[12px] text-[var(--color-error-700)]">{goalError}</span>}
            </form>
          ) : <p data-goal-limit="" className="text-[12.5px] text-[var(--color-text-tertiary)]">A sprint has at most five goals. Archive one to add another.</p>}
        </Section>

        <Section title="Capacity">
          <ul className="flex min-w-0 flex-col gap-1">
            {(plan.capacity || []).map((row) => {
              const use = capacityUse(row);
              const plannedH = Math.round(((Number(row.planned_minutes) || 0) / 60) * 10) / 10;
              return (
                <li key={row.email} data-capacity-row={row.email} className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="w-28 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{row.name}</span>
                  <label className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                    <span className="sr-only">Hours {row.name} has this sprint</span>
                    <input key={`${row.email}:${row.hours ?? ""}`} defaultValue={row.hours ?? ""} placeholder={row.hours_default !== null && row.hours_default !== undefined ? String(row.hours_default) : "set hours"} inputMode="decimal" disabled={!canPlan}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        const h = t === "" ? null : Number(t);
                        if (h !== null && (!Number.isFinite(h) || h < 0 || h > 80)) { addToast({ variant: "error", title: "Hours are 0 to 80." }); return; }
                        if ((row.hours ?? null) === (h === null ? null : Math.round(h * 10) / 10)) return;
                        act(`cap:${row.email}`, () => ops.setSprintCapacity(sprint.id, row.email, h === null ? null : Math.round(h * 10) / 10), "Hours saved");
                      }}
                      className={`${INPUT} w-20 text-right`} />h
                  </label>
                  <span className="h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={!use.set ? 0 : Number.isFinite(use.pct) ? Math.min(use.pct, 100) : 100} aria-label={`${row.name}: ${plannedH} hours planned`}>
                    <span className={`block h-full rounded-full ${use.over ? "bg-[var(--color-error-500)]" : "bg-[var(--color-success-600)]"}`} style={{ width: `${!use.set ? 0 : Math.min(Number.isFinite(use.pct) ? use.pct : 100, 100)}%` }} />
                  </span>
                  <span className={`w-28 text-right text-[12px] tabular-nums ${use.over ? "font-semibold text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`}>
                    {use.set ? `${plannedH} h · ${Number.isFinite(use.pct) ? use.pct : "over"}%` : `${plannedH} h planned`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <Section title={`Backlog and carried · ${backlog.length}`}>
            {backlog.length === 0 ? <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing waiting in the backlog.</p> : <ul className="flex min-w-0 flex-col gap-1.5">{backlog.map((c) => cardRow(c, false))}</ul>}
          </Section>
          <Section title={`In this sprint · ${inSprint.length}`}>
            {inSprint.length === 0 ? <p className="text-[13px] text-[var(--color-text-tertiary)]">No cards in this sprint yet. Add some from the backlog.</p> : <ul className="flex min-w-0 flex-col gap-1.5">{inSprint.map((c) => cardRow(c, true))}</ul>}
          </Section>
        </div>
      </div>
    </Drawer>
  );
}
