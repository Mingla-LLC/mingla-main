import type { BrandEventSummaryCounts } from "./brandEventSummary";

export const formatActiveEventsSub = (
  counts: BrandEventSummaryCounts,
): string => {
  if (counts.active === 0) return "No active events";

  return [
    `${counts.live} live`,
    `${counts.upcoming} upcoming`,
    `${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}`,
  ].join(" · ");
};

export const getActiveEventsKpiSub = (
  counts: BrandEventSummaryCounts,
  isWideDesktop: boolean,
): string | undefined =>
  isWideDesktop ? undefined : formatActiveEventsSub(counts);
