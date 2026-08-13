import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import {
  eventFromPublishResponse,
  type PublishRpcResponse,
} from "../../services/businessEvents";

const original = (poster: string | null | undefined): LiveEvent =>
  ({
    name: "New Forms",
    description: "Collector preview",
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    coverMediaPosterUrl: poster,
    visibility: "hidden",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
  }) as unknown as LiveEvent;

const edited = (event: LiveEvent, poster?: string | null): DraftEvent => ({
  ...liveEventToEditableDraft(event),
  ...(poster === undefined ? {} : { coverMediaPosterUrl: poster }),
});

describe("#2010 published editor poster hydration honesty", () => {
  test("the synthetic post-publish mapper carries the authoritative poster", () => {
    const poster = "https://cdn.usemingla.com/poster.jpg";
    const response = {
      event: {
        id: "event-1",
        brand_id: "brand-1",
        created_by: "user-1",
        title: "New Forms",
        description: "Collector preview",
        slug: "new-forms",
        location_text: "Art Roost Gallery",
        online_url: null,
        is_online: false,
        is_recurring: false,
        is_multi_date: false,
        recurrence_rules: null,
        cover_media_url: "https://cdn.usemingla.com/cover.mp4",
        cover_media_poster_url: poster,
        cover_media_type: "video",
        currency: "NGN",
        visibility: "hidden",
        status: "scheduled",
        published_at: "2026-08-13T12:00:00.000Z",
        timezone: "Africa/Lagos",
        created_at: "2026-08-13T11:00:00.000Z",
        updated_at: "2026-08-13T12:00:00.000Z",
        theme: {},
      },
      brand: { id: "brand-1", slug: "mingla-nigeria", name: "Mingla Nigeria" },
      tickets: [],
      eventDates: [],
      client_revision: 1,
    } satisfies PublishRpcResponse;

    expect(eventFromPublishResponse(response).event.coverMediaPosterUrl).toBe(
      poster,
    );
  });

  test.each([undefined, null])(
    "a nullish server poster (%s) produces no patch or change-summary row",
    (poster) => {
      const event = original(poster);
      const draft = edited(event);

      expect(editableDraftToPatch(event, draft)).toEqual({});
      expect(
        computeRichFieldDiffs(event, draft).filter(
          (diff) => diff.fieldKey === "coverMediaPosterUrl",
        ),
      ).toEqual([]);
    },
  );

  test("an unchanged authoritative poster remains a no-op", () => {
    const event = original("https://cdn.usemingla.com/poster.jpg");
    expect(editableDraftToPatch(event, edited(event))).toEqual({});
  });

  test.each([
    [null, "https://cdn.usemingla.com/added.jpg"],
    ["https://cdn.usemingla.com/old.jpg", "https://cdn.usemingla.com/new.jpg"],
    ["https://cdn.usemingla.com/old.jpg", null],
    [null, ""],
  ])("a real poster change from %s to %s is retained", (before, after) => {
    const event = original(before);
    const draft = edited(event, after);
    const patch = editableDraftToPatch(event, draft);
    const posterDiffs = computeRichFieldDiffs(event, draft).filter(
      (diff) => diff.fieldKey === "coverMediaPosterUrl",
    );

    expect(patch.coverMediaPosterUrl).toBe(after);
    expect(posterDiffs).toHaveLength(1);
  });
});
