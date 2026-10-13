/**
 * issue #3237 [after Publish, land on the manage screen] — implementor happy
 * path for the pure pieces. Append-only: NEW file.
 *
 *  - the one-shot "just published" signal a publish route leaves for the manage
 *    screen (claimed once, expires, never fires for another item);
 *  - the rule that keeps a draft from offering Share / Public page;
 *  - the banner copy per offering type.
 *
 * FAILS-ON-REVERT (true line deletion):
 *  - delete `pending.delete(id)` in consumeJustPublished      -> "claimed once" RED
 *  - delete the `status !== "draft"` clause in canOfferPublicLinks
 *                                                           -> "draft" cases RED
 */
import { afterEach, describe, expect, test } from "@jest/globals";

import {
  JUST_PUBLISHED_TTL_MS,
  consumeJustPublished,
  isJustPublishedPending,
  markJustPublished,
  resetJustPublishedForTests,
} from "../justPublishedSignal";
import { canOfferPublicLinks } from "../offeringPublicLinks";
import {
  PUBLISHED_BANNER_TITLE,
  publishedBannerSupportingLine,
  publishedEventBannerKind,
} from "../../components/offering/publishedBannerCopy";
import { buildOfferingManageActions } from "../../components/offering/offeringManageActions";

afterEach(() => resetJustPublishedForTests());

describe("#3237 just-published signal", () => {
  test("a marked id is claimed exactly once", () => {
    markJustPublished("evt-1", 1_000);
    expect(isJustPublishedPending("evt-1", 1_001)).toBe(true);
    expect(consumeJustPublished("evt-1", 1_002)).toBe(true);
    // A refresh, a later visit or a back-navigation finds nothing to replay.
    expect(consumeJustPublished("evt-1", 1_003)).toBe(false);
    expect(isJustPublishedPending("evt-1", 1_004)).toBe(false);
  });

  test("peeking does not consume the mark", () => {
    markJustPublished("exp-1", 0);
    expect(isJustPublishedPending("exp-1", 1)).toBe(true);
    expect(isJustPublishedPending("exp-1", 2)).toBe(true);
    expect(consumeJustPublished("exp-1", 3)).toBe(true);
  });

  test("an unmarked or different id never reads as just published", () => {
    markJustPublished("evt-1", 0);
    expect(consumeJustPublished("evt-2", 1)).toBe(false);
    expect(consumeJustPublished(null, 1)).toBe(false);
    expect(consumeJustPublished(undefined, 1)).toBe(false);
    expect(consumeJustPublished("", 1)).toBe(false);
    expect(isJustPublishedPending(null, 1)).toBe(false);
  });

  test("a missing id is never marked", () => {
    markJustPublished(null, 0);
    markJustPublished("", 0);
    expect(consumeJustPublished("", 1)).toBe(false);
  });

  test("a mark whose navigation never arrived expires instead of surfacing later", () => {
    markJustPublished("trip-1", 0);
    expect(isJustPublishedPending("trip-1", JUST_PUBLISHED_TTL_MS + 1)).toBe(false);
    expect(consumeJustPublished("trip-1", JUST_PUBLISHED_TTL_MS + 1)).toBe(false);
    // ...and the stale mark is gone, not waiting for a third visit.
    expect(consumeJustPublished("trip-1", 1)).toBe(false);
  });

  test("a mark is still claimable right at the end of its window", () => {
    markJustPublished("trip-2", 0);
    expect(consumeJustPublished("trip-2", JUST_PUBLISHED_TTL_MS)).toBe(true);
  });
});

describe("#3237 drafts do not offer public links", () => {
  test("a draft never offers Share or the public page, even with a brand address", () => {
    expect(canOfferPublicLinks({ status: "draft", brandSlug: "lantern" })).toBe(false);
  });

  test("published items with a brand address still do", () => {
    for (const status of ["scheduled", "live", "ended", "cancelled"]) {
      expect(canOfferPublicLinks({ status, brandSlug: "lantern" })).toBe(true);
    }
  });

  test("no brand address or no status means no public page", () => {
    expect(canOfferPublicLinks({ status: "live", brandSlug: null })).toBe(false);
    expect(canOfferPublicLinks({ status: "live", brandSlug: "" })).toBe(false);
    expect(canOfferPublicLinks({ status: null, brandSlug: "lantern" })).toBe(false);
    expect(canOfferPublicLinks({ status: undefined, brandSlug: "lantern" })).toBe(false);
  });

  // The Hub experiences 3-dot menu builds its rows from handlers gated by this
  // rule; an undefined handler is a row that is not offered.
  const menuKeys = (status: string): string[] => {
    const allowed = canOfferPublicLinks({ status, brandSlug: "lantern" });
    return buildOfferingManageActions(
      "experience",
      {
        onEdit: () => undefined,
        onViewPublic: allowed ? () => undefined : undefined,
        onShare: allowed ? () => undefined : undefined,
      },
      () => undefined,
    ).map((action) => action.key);
  };

  test("the experience menu for a draft offers Edit only", () => {
    expect(menuKeys("draft")).toEqual(["edit"]);
  });

  test("the experience menu for a published experience still offers both links", () => {
    expect(menuKeys("scheduled")).toEqual(["edit", "view-public", "share"]);
    expect(menuKeys("live")).toEqual(["edit", "view-public", "share"]);
  });
});

describe("#3237 banner copy", () => {
  test("the title confirms the publish", () => {
    expect(PUBLISHED_BANNER_TITLE).toBe("Published. It's live.");
  });

  test("each type gets its own next step", () => {
    expect(publishedBannerSupportingLine("paid_event")).toBe(
      "Share it to start selling tickets.",
    );
    expect(publishedBannerSupportingLine("free_event")).toBe(
      "Share it to start getting guests.",
    );
    expect(publishedBannerSupportingLine("rsvp")).toBe(
      "Share it to start getting guests.",
    );
    expect(publishedBannerSupportingLine("trip")).toBe(
      "Share it to start taking bookings.",
    );
    expect(publishedBannerSupportingLine("experience")).toBe(
      "Share it to start taking bookings.",
    );
  });

  test("an event with any priced ticket sells tickets; all-free collects guests", () => {
    expect(publishedEventBannerKind([{ isFree: false }])).toBe("paid_event");
    expect(publishedEventBannerKind([{ isFree: true }, { isFree: false }])).toBe(
      "paid_event",
    );
    expect(publishedEventBannerKind([{ isFree: true }])).toBe("free_event");
    expect(publishedEventBannerKind([])).toBe("free_event");
  });

  test("no payment-provider name appears in the copy", () => {
    const all = [
      PUBLISHED_BANNER_TITLE,
      ...(["paid_event", "free_event", "rsvp", "trip", "experience"] as const).map(
        publishedBannerSupportingLine,
      ),
    ].join(" ");
    expect(all).not.toMatch(/stripe|paystack/i);
  });
});
