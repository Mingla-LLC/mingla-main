import type { DraftEvent } from "../store/draftEventStore";
import type { LiveEvent } from "../store/liveEventStore";
import { deriveLiveStatus } from "./eventLifecycle";

export type BrandEventSummaryStatus = "live" | "upcoming" | "past" | "draft";
export type BrandEventSummaryKind = "live" | "draft";

export interface BrandEventSummaryItem {
  key: string;
  kind: BrandEventSummaryKind;
  status: BrandEventSummaryStatus;
  event: LiveEvent | DraftEvent;
}

export interface BrandEventSummaryCounts {
  all: number;
  active: number;
  live: number;
  upcoming: number;
  draft: number;
  past: number;
}

export interface BrandEventSummary {
  counts: BrandEventSummaryCounts;
  activeItems: BrandEventSummaryItem[];
  allItems: BrandEventSummaryItem[];
  primaryLiveItem: BrandEventSummaryItem | null;
}

const statusRank: Record<BrandEventSummaryStatus, number> = {
  live: 0,
  upcoming: 1,
  past: 2,
  draft: 3,
};

const toSummaryStatus = (event: LiveEvent): BrandEventSummaryStatus => {
  const status = deriveLiveStatus(event);
  return status === "cancelled" ? "past" : status;
};

const sortItems = (
  items: BrandEventSummaryItem[],
): BrandEventSummaryItem[] =>
  items.slice().sort((a, b) => {
    const aRank = statusRank[a.status];
    const bRank = statusRank[b.status];
    if (aRank !== bRank) return aRank - bRank;

    if (a.status === "upcoming") {
      const aDate = (a.event as LiveEvent).date ?? "";
      const bDate = (b.event as LiveEvent).date ?? "";
      return aDate.localeCompare(bDate);
    }

    if (a.status === "past") {
      const aDate = (a.event as LiveEvent).date ?? "";
      const bDate = (b.event as LiveEvent).date ?? "";
      return bDate.localeCompare(aDate);
    }

    if (a.status === "draft") {
      const aUpdated = (a.event as DraftEvent).updatedAt ?? "";
      const bUpdated = (b.event as DraftEvent).updatedAt ?? "";
      return bUpdated.localeCompare(aUpdated);
    }

    return 0;
  });

export const buildBrandEventSummary = (
  liveEvents: LiveEvent[],
  drafts: DraftEvent[],
): BrandEventSummary => {
  const liveItems: BrandEventSummaryItem[] = liveEvents.map((event) => ({
    key: `live-${event.id}`,
    kind: "live",
    status: toSummaryStatus(event),
    event,
  }));

  const draftItems: BrandEventSummaryItem[] = drafts.map((event) => ({
    key: `draft-${event.id}`,
    kind: "draft",
    status: "draft",
    event,
  }));

  const allItems = sortItems([...liveItems, ...draftItems]);
  const activeItems = allItems.filter((item) => item.status !== "past");
  const primaryLiveItem =
    activeItems.find((item) => item.status === "live") ?? null;

  const counts: BrandEventSummaryCounts = {
    all: allItems.length,
    active: activeItems.length,
    live: liveItems.filter((item) => item.status === "live").length,
    upcoming: liveItems.filter((item) => item.status === "upcoming").length,
    draft: draftItems.length,
    past: liveItems.filter((item) => item.status === "past").length,
  };

  return {
    counts,
    activeItems,
    allItems,
    primaryLiveItem,
  };
};
