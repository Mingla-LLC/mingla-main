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
import { waitingCardsState } from "../lib/opsModel";

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
  const refetchCounts = counts.refetch;
  useEffect(() => {
    const refresh = () => { refetchCounts?.({ quiet: true }); };
    window.addEventListener(REVIEW_CHANGED, refresh);
    return () => window.removeEventListener(REVIEW_CHANGED, refresh);
  }, [refetchCounts]);
  const waiting = Number(drafts.data?.waiting || 0);
  const needsPerson = Number(counts.data?.needs_person_mine || 0);
  const draftNeeded = Number(counts.data?.draft_needed_mine || 0);
  // #3980 (R8): the "Recently shipped" wording cards (owner and admins only;
  // the server counts none for anyone else).
  const wording = Number(counts.data?.wording_mine || 0);
  // Loaded once both counts have answered (the work counts only when this
  // person can open the page).
  const loaded = drafts.data != null && (!enabled || counts.data != null);
  // #4130: the Work menu entry's and the Dashboard's count, one definition
  // with the Work board column and the Team dashboard: this person's own open
  // cards whose status is "Waiting on a person", whatever the reason. A send
  // card counts whether or not its draft is ready (ops_my_counts
  // waiting_on_person_mine). Waiting drafts are not cards, so not in it.
  const work = waitingCardsState({ enabled, data: counts.data, error: counts.error });
  return {
    waiting, needsPerson, draftNeeded, wording,
    cards: work.cards,
    cardsLoaded: work.status !== "loading",
    cardsError: work.status === "error" ? counts.error : null,
    total: waiting + needsPerson + draftNeeded + wording,
    loaded,
    refetch: counts.refetch,
  };
}
