// Issue #3980 — the To review count in the menu: your waiting message drafts
// plus your cards that need a person.
import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import { useDraftCountValue } from "./useDraftCounts";
import { useOpsPoll } from "./useOpsWork";

const REVIEW_CHANGED = "mingla:ops-review-changed";

/** Tell every To review count (the menu badge and the page header) to refresh now. */
export function announceReviewChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REVIEW_CHANGED));
}

export function useReviewCount() {
  const { access } = useAuth();
  const drafts = useDraftCountValue();
  const enabled = canOpenPage(access, "drafts");
  const counts = useOpsPoll(() => ops.fetchMyCounts(todayIso()), { key: access?.email || "", intervalMs: 30_000, enabled });
  const refetchCounts = counts.refetch;
  useEffect(() => {
    const refresh = () => { refetchCounts?.({ quiet: true }); };
    window.addEventListener(REVIEW_CHANGED, refresh);
    return () => window.removeEventListener(REVIEW_CHANGED, refresh);
  }, [refetchCounts]);
  const waiting = Number(drafts.data?.waiting || 0);
  const needsPerson = Number(counts.data?.needs_person_mine || 0);
  return { waiting, needsPerson, total: waiting + needsPerson, refetch: counts.refetch };
}
