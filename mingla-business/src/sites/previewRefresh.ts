/**
 * #4572 item 1 (D5) — the draft preview refreshes itself when the draft moved.
 *
 * A preview grant names one draft revision. When the draft changes after the
 * grant was made, the frame's page says so (`mingla:preview-stale`, from the
 * CMS refusal page or Studio's preview chrome) and the Host fetches a fresh
 * grant silently, showing "Updating preview…" over a skeleton, never the old
 * address. At most TWO automatic refreshes run per minute per site: a third
 * stale report, or any `mingla:preview-failed`, shows "We couldn't load the
 * preview" with Try again, so a preview that keeps going stale can never loop.
 * INVARIANT sites-preview-refresh-capped: at most 2 automatic preview refreshes per 60 s per site, then the error card
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PREVIEW_FAILED, PREVIEW_STALE } from "./previewBridge";

export const PREVIEW_AUTO_REFRESH_MAX = 2;
export const PREVIEW_AUTO_REFRESH_WINDOW_MS = 60_000;

/** What a message from the preview frame says about the grant, or null for anything else. */
export function previewRefusalKind(data: unknown): "stale" | "failed" | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const type = (data as { type?: unknown }).type;
  return type === PREVIEW_STALE ? "stale" : type === PREVIEW_FAILED ? "failed" : null;
}

/** What a refused preview page's HTTP status means on native (a WebView page has no parent to post to): 409 is an older draft. */
export function previewHttpRefusal(statusCode: number): "stale" | "failed" | null {
  if (statusCode === 409) return "stale";
  return statusCode >= 400 ? "failed" : null;
}

/** The refresh budget: `take()` is true while an automatic refresh is still allowed in this window. */
export function createRefreshBudget(now: () => number = Date.now, max = PREVIEW_AUTO_REFRESH_MAX, windowMs = PREVIEW_AUTO_REFRESH_WINDOW_MS) {
  let stamps: number[] = [];
  return {
    take(): boolean {
      const at = now();
      stamps = stamps.filter((stamp) => at - stamp < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(at);
      return true;
    },
    reset(): void {
      stamps = [];
    },
  };
}

export type PreviewRefreshPhase = "ready" | "updating" | "failed";

export type PreviewRefresh = {
  /** "updating" while a fresh grant is being made after a stale report; "failed" once the budget is spent or the frame failed. */
  phase: PreviewRefreshPhase;
  onStale: () => void;
  onFailed: () => void;
  /** Try again on the error card: a fresh grant, and a fresh budget. */
  retry: () => void;
};

/** One owner for the preview's refresh state, shared by every Host preview frame of one site. */
export function usePreviewRefresh(input: { siteId: string | null; isFetching: boolean; refetch: () => unknown; now?: () => number }): PreviewRefresh {
  const { siteId, isFetching, refetch } = input;
  const budgets = useRef(new Map<string, ReturnType<typeof createRefreshBudget>>());
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const nowRef = useRef(input.now);
  nowRef.current = input.now;
  const budgetFor = useCallback((id: string) => {
    let budget = budgets.current.get(id);
    if (!budget) {
      budget = createRefreshBudget(() => (nowRef.current ?? Date.now)());
      budgets.current.set(id, budget);
    }
    return budget;
  }, []);
  const onStale = useCallback(() => {
    if (!siteId) return;
    if (budgetFor(siteId).take()) {
      setRefreshing(siteId);
      void refetch();
    } else {
      setFailed(siteId);
    }
  }, [budgetFor, refetch, siteId]);
  const onFailed = useCallback(() => {
    if (siteId) setFailed(siteId);
  }, [siteId]);
  const retry = useCallback(() => {
    if (siteId) budgetFor(siteId).reset();
    setFailed(null);
    setRefreshing(siteId);
    void refetch();
  }, [budgetFor, refetch, siteId]);
  // A refresh that finished leaves "updating" by itself.
  const wasFetching = useRef(isFetching);
  useEffect(() => {
    if (wasFetching.current && !isFetching) setRefreshing(null);
    wasFetching.current = isFetching;
  }, [isFetching]);
  const phase: PreviewRefreshPhase = failed !== null && failed === siteId
    ? "failed"
    : isFetching || (refreshing !== null && refreshing === siteId)
      ? "updating"
      : "ready";
  return useMemo(() => ({ phase, onStale, onFailed, retry }), [phase, onStale, onFailed, retry]);
}
