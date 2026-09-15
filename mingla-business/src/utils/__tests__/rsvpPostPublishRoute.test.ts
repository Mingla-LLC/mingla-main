// Unlisted RSVP invite link — where the host lands straight after publishing.
// fails-on-revert: route every visibility to /e/ (the old behaviour) and P-03 reds;
// drop the slug guard and P-04 reds.
import { describe, expect, test } from "@jest/globals";

import { rsvpPostPublishRoute } from "../rsvpPostPublishRoute";

const slug = { brandSlug: "harmattanclub", eventSlug: "members-table" };
const EVENT_ID = "6efa617e-d4bd-4389-909d-be9db1763a75";

describe("rsvpPostPublishRoute", () => {
  test("P-01 public opens the public page", () => {
    expect(rsvpPostPublishRoute({ visibility: "public", eventId: EVENT_ID, slug })).toBe(
      "/e/harmattanclub/members-table",
    );
  });

  test("P-02 unlisted opens the public page, which is the invite link", () => {
    expect(rsvpPostPublishRoute({ visibility: "unlisted", eventId: EVENT_ID, slug })).toBe(
      "/e/harmattanclub/members-table",
    );
  });

  test("P-03 private opens the RSVP dashboard, never the public page", () => {
    expect(rsvpPostPublishRoute({ visibility: "private", eventId: EVENT_ID, slug })).toBe(
      `/rsvp/${EVENT_ID}`,
    );
    expect(rsvpPostPublishRoute({ visibility: "private", eventId: null, slug })).toBeNull();
    expect(rsvpPostPublishRoute({ visibility: "private", eventId: "", slug })).toBeNull();
  });

  test("P-04 no slug and not private -> null, so the caller keeps its Events fallback", () => {
    expect(rsvpPostPublishRoute({ visibility: "public", eventId: EVENT_ID, slug: null })).toBeNull();
    expect(
      rsvpPostPublishRoute({ visibility: "unlisted", eventId: EVENT_ID, slug: { brandSlug: "", eventSlug: "x" } }),
    ).toBeNull();
  });

  test("P-05 an unknown visibility (publish response without it) behaves like public", () => {
    expect(rsvpPostPublishRoute({ visibility: null, eventId: EVENT_ID, slug })).toBe(
      "/e/harmattanclub/members-table",
    );
  });
});
