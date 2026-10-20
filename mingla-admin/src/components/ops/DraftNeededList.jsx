// Issue #3980 — To review, Messages: work cards handed to a person to send a
// message before any draft for them exists. Each is listed as
// "Draft needed: <card>" until a draft waits; then the draft itself is listed
// here instead, so nothing is counted twice.
//
// The To review page loads this list once (useDraftNeededReview) and hands it
// down through DraftNeededContext, so the list and the empty Messages copy
// below it always read the same answer: the cards actually listed, never a
// separate count that can be slow, failing or out of date.
import { createContext, useContext, useEffect } from "react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import * as ops from "../../services/opsService";
import { dayLabel, opsErrorWords, todayIso } from "../../lib/opsModel";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { REVIEW_CHANGED } from "../../hooks/useReviewCount";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// eslint-disable-next-line react-refresh/only-export-components
export const DraftNeededContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useDraftNeededReview({ enabled = true } = {}) {
  const { access } = useAuth();
  const review = useOpsPoll(() => ops.listReview(todayIso()), { key: access?.email || "", intervalMs: 30_000, enabled });
  const refetch = review.refetch;
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => { refetch?.({ quiet: true }); };
    window.addEventListener(REVIEW_CHANGED, refresh);
    return () => window.removeEventListener(REVIEW_CHANGED, refresh);
  }, [enabled, refetch]);
  return review;
}

// The cards the list shows for this answer; empty while loading or failed.
// eslint-disable-next-line react-refresh/only-export-components
export function draftNeededCards(review) {
  return Array.isArray(review.data?.draft_needed) ? review.data.draft_needed : [];
}

export function DraftNeededList() {
  const review = useContext(DraftNeededContext);
  if (!review) return null;
  if (review.error && !review.data) {
    return <AlertCard variant="warning" title="Couldn’t load cards that need a draft" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => review.refetch()}>Try again</Button>}>{opsErrorWords(review.error)}</AlertCard>;
  }
  const cards = draftNeededCards(review);
  if (cards.length === 0) return null;
  return (
    <SectionCard title="Draft needed" subtitle={`${cards.length}`}>
      <ul className="flex min-w-0 flex-col gap-1" aria-label="Cards that need a message draft">
        {cards.map((c) => (
          <li key={c.id}>
            <a href={`#/work-board?card=${c.id}`} data-draft-needed={c.id} className={`flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}>
              <span className="break-words text-[13.5px] font-semibold text-[var(--color-text-primary)]">Draft needed: {c.title}</span>
              <span className="text-[12px] text-[var(--color-text-tertiary)]">Card {c.number} · due {dayLabel(c.due_on)}{(c.owners || []).length ? ` · ${(c.owners || []).map((o) => o.name).join(", ")}` : ""}</span>
            </a>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
