/**
 * #4111 D5 — implementor happy-path for the smart message sheet's topic
 * builder (`@mingla/brand-rendering/enquiry/enquiryTopics`), the pure function
 * Explorer and buyer web both render: brand offerings + venue + my plans →
 * step 1 groups and step 2 reasons.
 *
 * Cases from the design contract:
 *   - Soft Life Travel Club (trip brand, nothing listed) → ONLY "Something else"
 *   - Lantern Room (venue brand, signed in, a reservation) → plans first, then
 *     Coming up, Past, At the venue, Something else
 *   - Ctrl (signed out, one past event) → no plans group even if plans exist
 *
 * FAILS-ON-REVERT: deleting the plans group / venue group / group ordering in
 * buildEnquiryTopicGroups fails the Lantern Room assertions.
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildEnquiryTopicGroups,
  composeEnquiryBody,
  reasonsForPick,
  replyTimeLabel,
  resolveEnquiryPrefill,
  selfServeFor,
  sendReasonFor,
  validateEnquiryDraft,
  type EnquiryOffering,
  type EnquiryPlan,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";
import {
  enquiryOfferingsFromSections,
  enquiryPlansFromRows,
} from "@mingla/brand-rendering/enquiry/enquiryPageData";

const NOW = Date.parse("2026-10-25T12:00:00Z");

const reservation: EnquiryPlan = {
  kind: "reservation",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Table for 4 · Lantern Room",
  startsAt: "2026-10-31T20:00:00Z",
  summary: "Table for 4",
  isUpcoming: true,
  canCancel: true,
  canCancelUrl: null,
  canRequestRefund: false,
};

const vinylNight: EnquiryOffering = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Vinyl Night: Lagos to Brooklyn",
  kind: "event",
  startsAt: "2026-11-08T20:00:00Z",
  when: "upcoming",
};

const pastShow: EnquiryOffering = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Listening Session",
  kind: "event",
  startsAt: "2026-10-10T20:00:00Z",
  endsAt: "2026-10-10T23:00:00Z",
  when: "past",
};

const lanternVenue = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Lantern Room",
  orderingEnabled: false,
  reservationsOnline: true,
};

describe("#4111 topic builder — design cases", () => {
  test("Soft Life with nothing listed shows only Something else", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Soft Life Travel Club",
      signedIn: false,
      plans: [],
      offerings: [],
      venue: null,
      nowMs: NOW,
    });
    expect(groups.map((g) => g.key)).toEqual(["something_else"]);
    expect(groups[0]?.picks.map((p) => p.title)).toEqual([
      "General question",
      "Work with Soft Life Travel Club",
      "Other",
    ]);
    // Something else picks skip step 2 and send their own reason.
    expect(groups[0]?.picks.map((p) => sendReasonFor(p, null))).toEqual([
      "general_question",
      "work_with",
      "other",
    ]);
    expect(groups[0]?.picks.every((p) => p.contextKind === "none" && p.contextId === null)).toBe(true);
  });

  test("Lantern Room signed in with a reservation: plans first, then Coming up, Past, At the venue", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern Room",
      signedIn: true,
      plans: [reservation],
      offerings: [pastShow, vinylNight],
      venue: lanternVenue,
      nowMs: NOW,
    });
    expect(groups.map((g) => g.key)).toEqual(["plans", "coming_up", "past", "venue", "something_else"]);
    expect(groups[0]?.title).toBe("Your plans with Lantern Room");
    const plan = groups[0]?.picks[0];
    expect(plan?.contextKind).toBe("reservation");
    expect(plan?.contextId).toBe(reservation.id);
    expect(plan !== undefined && reasonsForPick(plan).map((r) => r.label)).toEqual([
      "Change time or party size",
      "Cancel",
      "Running late",
      "Access needs",
      "Something else",
    ]);
    expect(groups[1]?.picks.map((p) => p.title)).toEqual(["Vinyl Night: Lagos to Brooklyn"]);
    expect(groups[1]?.picks[0] !== undefined && reasonsForPick(groups[1].picks[0]).map((r) => r.key)).toEqual([
      "question_before_booking",
      "group_booking",
      "access_needs",
      "dates_times",
      "something_else",
    ]);
    expect(groups[2]?.picks[0] !== undefined && reasonsForPick(groups[2].picks[0]).map((r) => r.key)).toEqual([
      "lost_something",
      "feedback",
      "photos_recordings",
      "refund",
      "something_else",
    ]);
    // Ordering is off → no Food order; the venue rides along as context.
    expect(groups[3]?.picks.map((p) => p.title)).toEqual(["Table or reservation", "Private hire or big group"]);
    expect(groups[3]?.picks.every((p) => p.contextKind === "venue" && p.contextId === lanternVenue.id)).toBe(true);
  });

  test("signed out never shows plans, even when plans are passed", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Ctrl",
      signedIn: false,
      plans: [reservation],
      offerings: [pastShow],
      nowMs: NOW,
    });
    expect(groups.map((g) => g.key)).toEqual(["past", "something_else"]);
  });

  test("Coming up caps at 4 (happening now first) and keeps the rest behind See all", () => {
    const offerings: EnquiryOffering[] = [0, 1, 2, 3, 4].map((i) => ({
      id: `o-${i}`,
      title: `Show ${i}`,
      kind: "event",
      startsAt: `2026-11-1${i}T20:00:00Z`,
      when: i === 4 ? "happening_now" : "upcoming",
    }));
    const groups = buildEnquiryTopicGroups({ brandName: "X", signedIn: false, offerings, nowMs: NOW });
    const coming = groups.find((g) => g.key === "coming_up");
    expect(coming?.picks.map((p) => p.contextId)).toEqual(["o-4", "o-0", "o-1", "o-2"]);
    expect(coming?.hiddenPicks.map((p) => p.contextId)).toEqual(["o-3"]);
    expect(coming?.picks[0]?.subtitle).toContain("Happening now");
  });

  test("Past keeps only the last 90 days; trips get trip reasons; ordering adds Food order", () => {
    const old: EnquiryOffering = { ...pastShow, id: "old", startsAt: "2026-05-01T20:00:00Z", endsAt: "2026-05-01T23:00:00Z" };
    const trip: EnquiryOffering = { id: "trip", title: "Lagos Weekend", kind: "trip", startsAt: null, when: "upcoming" };
    const groups = buildEnquiryTopicGroups({
      brandName: "X",
      signedIn: false,
      offerings: [old, pastShow, trip],
      venue: { ...lanternVenue, orderingEnabled: true },
      nowMs: NOW,
    });
    expect(groups.find((g) => g.key === "past")?.picks.map((p) => p.contextId)).toEqual([pastShow.id]);
    const tripPick = groups.find((g) => g.key === "coming_up")?.picks[0];
    expect(tripPick !== undefined && reasonsForPick(tripPick).map((r) => r.label)).toEqual([
      "Itinerary",
      "Payment or deposit",
      "Group or custom trip",
      "Something else",
    ]);
    expect(groups.find((g) => g.key === "venue")?.picks.map((p) => p.title)).toContain("Food order");
  });
});

describe("#4111 step 2 self-serve, prefill and drafts", () => {
  test("ticket order reasons and the find-tickets shortcut", () => {
    const order: EnquiryPlan = { ...reservation, kind: "order", id: "order-1", title: "Ctrl V3", summary: "2 tickets" };
    const [group] = buildEnquiryTopicGroups({ brandName: "Ctrl", signedIn: true, plans: [order], nowMs: NOW });
    const pick = group?.picks[0];
    expect(pick !== undefined && reasonsForPick(pick).map((r) => r.label)).toEqual([
      "Change or transfer",
      "Refund or cancel",
      "Can't find my tickets",
      "Access needs",
      "Something else",
    ]);
    expect(pick !== undefined && selfServeFor(pick, "cant_find_tickets")).toEqual({ kind: "find_tickets" });
  });

  test("a cancellable reservation offers Cancel it yourself; Table offers Book now", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern Room",
      signedIn: true,
      plans: [reservation],
      venue: lanternVenue,
      nowMs: NOW,
    });
    const plan = groups[0]?.picks[0];
    expect(plan !== undefined && selfServeFor(plan, "cancel")).toEqual({ kind: "cancel_self", url: null });
    const table = groups.find((g) => g.key === "venue")?.picks[0];
    expect(table !== undefined && selfServeFor(table, null)).toEqual({ kind: "book_table" });
  });

  test("a prefill opens the matching pick, or builds it from the descriptor", () => {
    const groups = buildEnquiryTopicGroups({ brandName: "X", signedIn: false, offerings: [vinylNight], nowMs: NOW });
    expect(resolveEnquiryPrefill(groups, { contextKind: "offering", contextId: vinylNight.id })?.title).toBe(
      vinylNight.title,
    );
    const empty = buildEnquiryTopicGroups({ brandName: "X", signedIn: false, nowMs: NOW });
    const built = resolveEnquiryPrefill(empty, {
      contextKind: "offering",
      contextId: vinylNight.id,
      offering: vinylNight,
    });
    expect(built?.contextId).toBe(vinylNight.id);
    expect(built?.shape).toBe("upcoming_offering");
    expect(resolveEnquiryPrefill(empty, { contextKind: "offering", contextId: "missing" })).toBeNull();
  });

  test("table details ride at the top of the message; drafts validate", () => {
    expect(composeEnquiryBody("Birthday dinner for 12", { date: "Sat 8 Nov", time: "8pm", partySize: "12" })).toBe(
      "Date: Sat 8 Nov\nTime: 8pm\nParty size: 12\n\nBirthday dinner for 12",
    );
    expect(validateEnquiryDraft({ body: "short", signedIn: true })).toEqual(["body_short"]);
    expect(validateEnquiryDraft({ body: "A real question here", signedIn: false, name: "", email: "x" })).toEqual([
      "name",
      "email",
    ]);
    expect(
      validateEnquiryDraft({ body: "A real question here", signedIn: false, name: "Ada", email: "ada@example.com" }),
    ).toEqual([]);
  });

  test("reply time line only with a server value", () => {
    expect(replyTimeLabel(null)).toBeNull();
    expect(replyTimeLabel(45)).toBe("Usually replies within an hour");
    expect(replyTimeLabel(300)).toBe("Usually replies within 5 hours");
    expect(replyTimeLabel(1440)).toBe("Usually replies within a day");
  });

  test("page data and RPC rows map without guessing", () => {
    const offerings = enquiryOfferingsFromSections({
      happeningNow: [],
      upcoming: [
        {
          offeringId: "e1",
          brandId: "b",
          brandSlug: "b",
          brandName: "B",
          offeringType: "trip",
          offeringSlug: "t",
          name: "Trip",
          bio: null,
          coverMediaUrl: null,
          coverMediaType: null,
          startsAt: null,
          priceFromMinorUnits: null,
          currency: "GBP",
          isFree: false,
          publishedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(offerings).toEqual([
      { id: "e1", title: "Trip", kind: "trip", startsAt: null, endsAt: null, when: "upcoming" },
    ]);
    expect(
      enquiryPlansFromRows([
        { kind: "order", id: "o1", title: "Ctrl V3", starts_at: "2026-11-15T20:00:00Z", summary: "2 tickets", is_upcoming: true },
        { kind: "mystery", id: "x" },
        { kind: "rsvp" },
      ]).map((p) => `${p.kind}:${p.id}`),
    ).toEqual(["order:o1"]);
  });
});
