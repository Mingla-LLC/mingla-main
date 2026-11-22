// Issue #3980 — the Needs you count (it was To review) in the menu and the page header: exactly
// what the two tabs list. Messages: your waiting drafts plus the cards handed
// to a person to send a message that have no draft yet ("Draft needed").
// Spend or publish: the cards waiting for a person to spend, publish or other.
import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useDraftCountValue } from "./useDraftCounts";
import { useOpsPoll } from "./useOpsWork";
import { dueTodayState } from "../lib/opsModel";
import { workMenuCount, ticketsNotAlreadyDue } from "../lib/ticketModel";

export const REVIEW_CHANGED = "mingla:ops-review-changed";

/** Tell every To review count (the menu badge and the page header) to refresh now. */
export function announceReviewChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REVIEW_CHANGED));
}

export function useReviewCount() {
  const { access } = useAuth();
  const drafts = useDraftCountValue();
  // #4130: Needs you (#/drafts) was retired into Work; the count follows it.
  const enabled = canOpenPage(access, "work-board");
  const counts = useOpsPoll(() => ops.fetchMyCounts(todayIso()), { key: access?.email || "", intervalMs: 30_000, enabled });
  // #4420: open tickets I own still in To do (ops_ticket_counts); a failed
  // read counts none and never hides the cards count.
  const tickets = useOpsPoll(() => ops.fetchTicketCounts(), { key: `${access?.email || ""}|ticket-counts`, intervalMs: 30_000, enabled });
  const ticketsRaw = Number(tickets.data?.tickets_new_mine || 0);
  // #4420: a To do ticket that is also due today or overdue is already in the
  // cards count; read my To do list (only when I own a new ticket) to count
  // each card once. Until that answers, tickets add nothing.
  const todoToday = todayIso();
  const todoList = useOpsPoll(
    async () => {
      const r = await ops.listBoardWork({ who: "mine", status: ["todo"], today: todoToday, done_days: 0, limit: 200 });
      return { cards: Array.isArray(r?.cards) ? r.cards : [] };
    },
    { key: `${access?.email || ""}|ticket-todo`, intervalMs: 60_000, enabled: enabled && ticketsRaw > 0 },
  );
  const refetchCounts = counts.refetch;
  const refetchTickets = tickets.refetch;
  const refetchTodo = todoList.refetch;
  useEffect(() => {
    const refresh = () => { refetchCounts?.({ quiet: true }); refetchTickets?.({ quiet: true }); refetchTodo?.({ quiet: true }); };
    window.addEventListener(REVIEW_CHANGED, refresh);
    return () => window.removeEventListener(REVIEW_CHANGED, refresh);
  }, [refetchCounts, refetchTickets, refetchTodo]);
  const ticketsNew = ticketsNotAlreadyDue(todoList.data?.cards, todoToday, ticketsRaw);
  const waiting = Number(drafts.data?.waiting || 0);
  const needsPerson = Number(counts.data?.needs_person_mine || 0);
  const draftNeeded = Number(counts.data?.draft_needed_mine || 0);
  // #3980 (R8): the "Recently shipped" wording cards (owner and admins only;
  // the server counts none for anyone else).
  const wording = Number(counts.data?.wording_mine || 0);
  // Loaded once both counts have answered (the work counts only when this
  // person can open the page).
  const loaded = drafts.data != null && (!enabled || counts.data != null);
  // #4270 (D20): the Work menu entry's and the Dashboard's count: this
  // person's own open cards due today or overdue (ops_my_counts
  // due_today_mine + overdue_mine). A failed read is never 0.
  const work = dueTodayState({ enabled, data: counts.data, error: counts.error });
  return {
    waiting, needsPerson, draftNeeded, wording,
    // #4420: the Work count includes tickets I own that are still new and not already counted as due.
    cards: work.status === "ready" ? workMenuCount(work.dueToday + work.overdue, ticketsNew) : null,
    ticketsNew,
    dueToday: work.dueToday,
    overdue: work.overdue,
    cardsLoaded: work.status !== "loading",
    cardsError: work.status === "error" ? counts.error : null,
    total: waiting + needsPerson + draftNeeded + wording,
    loaded,
    refetch: counts.refetch,
  };
}
