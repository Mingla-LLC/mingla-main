// INVARIANT issue-4630-brand-chat-banner-one-state: the brand chat banner shows exactly one state (live_today, next_with_ticket, multiple_with_ticket, next_no_ticket, nothing_upcoming, error) or none (loading, Removed, non-member), and draws no control whose route lacks its slug.
// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4630 — the brand chat banner (spec 4.9) restored and upgraded.
//
// FAILS-ON-REVERT: delete the live_today branch or the nothing_upcoming branch
// of brandChatBannerState and their cases fail; route a control without its
// slug and the no-slug case fails; unmount the banner from MessageInterface or
// bring back TripCountdownBanner's nextUp mode and the wiring case fails.
import {
  BRAND_CHAT_MORE_HREF,
  brandChatBannerState,
  daysUntil,
  formatBannerDate,
  isBookingLiveToday,
  parseBrandChatSummary,
} from "../brandChatBannerModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}
const root = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, root));

// Local noon, so "today" and day counts do not depend on the runner's zone.
const now = new Date(2026, 10, 26, 12, 0, 0);
const at = (days: number, hours = 0, minutes = 0) => {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(d.getHours() + hours, d.getMinutes() + minutes);
  return d.toISOString();
};
const endOfToday = new Date(2026, 10, 26, 23, 59, 0).toISOString();

const booking = (id: string, startsAt: string, endsAt: string | null, extra = {}) => ({
  kind: "order", id, eventId: `ev-${id}`, eventSlug: `slug-${id}`, offeringType: "event", title: `Event ${id}`,
  coverMediaUrl: null, startsAt, endsAt, timezone: "UTC", ticketCount: 1, ...extra,
});
const summary = (extra = {}) => parseBrandChatSummary({
  member: true, brandSlug: "vibe-check", brandName: "Vibe Check", myBookings: [], hasPastBookings: false, brandUpcoming: [], ...extra,
});

Deno.test("#4630 hidden: loading, Removed, non-member; error only without data", () => {
  eq(brandChatBannerState({ summary: undefined, now, isLoading: true }).kind, "hidden", "loading: no flash");
  eq(brandChatBannerState({ summary: summary({ myBookings: [booking("a", at(3), at(3, 3))] }), now, removed: true }).kind, "hidden", "SC-9 Removed: no banner, no ticket pill");
  eq(brandChatBannerState({ summary: parseBrandChatSummary({ member: false }), now }).kind, "hidden", "a non-member sees nothing");
  eq(brandChatBannerState({ summary: undefined, now, isError: true }).kind, "error", "a failed read: the retry line");
  eq(brandChatBannerState({ summary: summary(), now, isError: true }).kind, "nothing_upcoming", "a failed refresh over data keeps the data");
});

Deno.test("#4630 live_today: starts today (23:59 counts) or in progress; ended a minute ago does not", () => {
  const late = brandChatBannerState({ summary: summary({ myBookings: [booking("late", endOfToday, null)] }), now });
  eq(late.kind, "live_today", "starts at 23:59 today");
  eq([late.eventHref, late.bookingHref, late.moreCount], ["/e/vibe-check/slug-late", "/purchases/order/late", 0], "event page and booking");
  const running = booking("run", at(0, -1), at(0, 2));
  assert(isBookingLiveToday(running, now), "in progress");
  const ended = booking("ended", at(0, -3), at(0, 0, -1));
  eq(brandChatBannerState({ summary: summary({ myBookings: [ended] }), now }).kind, "nothing_upcoming", "ended 1 minute ago: not live, not upcoming");
});

Deno.test("#4630 next_with_ticket and multiple_with_ticket (2 on the same day is multiple)", () => {
  const one = brandChatBannerState({ summary: summary({ myBookings: [booking("a", at(3), at(3, 3), { ticketCount: 2 })] }), now });
  eq(one.kind, "next_with_ticket", "one upcoming booking");
  eq([one.days, one.booking.ticketCount, one.bookingHref], [3, 2, "/purchases/order/a"], "in 3 days, 2 tickets, its booking");
  const sameDay = brandChatBannerState({
    summary: summary({ myBookings: [booking("b", at(5, 2), at(5, 4)), booking("a", at(5), at(5, 1), { kind: "rsvp" })] }),
    now,
  });
  eq(sameDay.kind, "multiple_with_ticket", "two bookings on the same day");
  eq([sameDay.booking.id, sameDay.moreCount, sameDay.moreHref, sameDay.bookingHref], ["a", 1, BRAND_CHAT_MORE_HREF, "/purchases/rsvp/a"], "the soonest, +1 more to Purchases (Q5)");
  eq(BRAND_CHAT_MORE_HREF, "/purchases", "Purchases");
});

Deno.test("#4630 next_no_ticket: the brand's next offering, with the right call to action", () => {
  const offering = (type: string, slug: string | null = "night") => ({
    offeringId: "o1", offeringType: type, offeringSlug: slug, title: "Night", coverMediaUrl: null, startsAt: at(4),
  });
  const s = brandChatBannerState({ summary: summary({ brandUpcoming: [offering("event")] }), now });
  eq([s.kind, s.cta, s.eventHref, s.days], ["next_no_ticket", "tickets", "/e/vibe-check/night", 4], "Get tickets, event page");
  eq(brandChatBannerState({ summary: summary({ brandUpcoming: [offering("rsvp")] }), now }).cta, "rsvp", "RSVP");
  eq(brandChatBannerState({ summary: summary({ brandUpcoming: [offering("trip")] }), now }).cta, "book", "Book (trip)");
  eq(brandChatBannerState({ summary: summary({ brandUpcoming: [offering("experience")] }), now }).cta, "book", "Book (experience)");
  // brandUpcoming has no end time: even starting within the hour it is never live_today.
  const soon = { ...offering("event"), startsAt: at(0, 1) };
  eq(brandChatBannerState({ summary: summary({ brandUpcoming: [soon] }), now }).kind, "next_no_ticket", "never live_today");
});

Deno.test("#4630 nothing_upcoming: with or without past bookings, the slim View <Brand> line", () => {
  const none = brandChatBannerState({ summary: summary(), now });
  eq([none.kind, none.brandHref], ["nothing_upcoming", "/b/vibe-check"], "brand page");
  const past = brandChatBannerState({ summary: summary({ hasPastBookings: true }), now });
  eq(past.kind, "nothing_upcoming", "past only renders the same");
});

Deno.test("#4630 no dead taps: a missing slug drops the route", () => {
  const noSlug = summary({ brandSlug: null, myBookings: [booking("a", at(3), at(3, 3))] });
  const s = brandChatBannerState({ summary: noSlug, now });
  eq([s.kind, s.eventHref, s.bookingHref], ["next_with_ticket", null, "/purchases/order/a"], "no event page; the booking still opens");
  const noEventSlug = brandChatBannerState({ summary: summary({ myBookings: [booking("a", at(3), at(3, 3), { eventSlug: null })] }), now });
  eq(noEventSlug.eventHref, null, "no event slug: no event page");
  eq(brandChatBannerState({ summary: summary({ brandSlug: null }), now }).brandHref, null, "no brand slug: no View <Brand>");
  const offerNoSlug = brandChatBannerState({
    summary: summary({ brandUpcoming: [{ offeringId: "o", offeringType: "event", offeringSlug: null, title: "N", coverMediaUrl: null, startsAt: at(2) }] }),
    now,
  });
  eq(offerNoSlug.eventHref, null, "an offering without a slug: no control");
  const component = read("components/chat/BrandChatBanner.tsx");
  assert(component.includes('accessibilityRole={onMain ? "button" : "text"}'), "the row becomes text without a route");
  assert(component.includes("{onPress ? (") && component.includes("onMain ? ("), "controls are drawn only with a route");
});

Deno.test("#4630 parse: malformed rows are dropped, never invented", () => {
  const parsed = parseBrandChatSummary({ member: true, brandSlug: "", brandName: null, myBookings: [{ kind: "x" }, { kind: "order", id: "1", eventId: "e" }], brandUpcoming: [{}], hasPastBookings: "yes" });
  eq([parsed.brandSlug, parsed.brandName, parsed.myBookings.length, parsed.brandUpcoming.length, parsed.hasPastBookings], [null, "", 1, 0, false], "defensive read");
  eq(parseBrandChatSummary(null), { member: false }, "nothing: not a member");
  eq(daysUntil(at(1), now), 1, "tomorrow is 1 day");
  assert(formatBannerDate(at(3), "en").length > 0, "a date label");
});

Deno.test("#4630 wiring: the banner sits under the header for a live brand chat; nextUp mode is gone", () => {
  const chat = read("components/MessageInterface.tsx");
  assert(/\{brandGuest && !brandGuest\.removed && conversationId \? \(\s*<BrandChatBanner conversationId=\{conversationId\} brandName=\{brandGuest\.brandName\} \/>/.test(chat),
    "MessageInterface renders BrandChatBanner for a live brand chat");
  assert(chat.indexOf("<BrandChatBanner") > chat.indexOf("<ChatHeader") && chat.indexOf("<BrandChatBanner") < chat.indexOf("{/* Messages */}"),
    "directly under the header");
  const component = read("components/chat/BrandChatBanner.tsx");
  assert(component.includes("queryKey: chatKeys.brandChatSummary(conversationId)") && component.includes("staleTime: 60_000"), "one factory key");
  assert(component.includes("const THUMB_MIN_WINDOW_WIDTH = 360;"), "D9 the thumbnail hides under 360 pt");
  assert(component.includes("onPress={() => void summary.refetch()}"), "the error line retries");
  const keys = read("hooks/queryKeys.ts");
  assert(keys.includes("brandChatSummary: (conversationId: string | null) =>"), "the key lives in the factory");
  const countdown = read("components/chat/TripCountdownBanner.tsx");
  assert(!countdown.includes("nextUp"), "TripCountdownBanner's unused nextUp mode is deleted");
});
