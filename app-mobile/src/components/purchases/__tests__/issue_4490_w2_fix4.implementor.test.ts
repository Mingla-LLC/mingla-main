/**
 * #4490 Explorer W2 fix round 4 — device pass 4 (W2-N31..N37) and the
 * carried-over guest stepper check.
 *
 * FAILS-ON-REVERT:
 * - N31: start AppContent's linkedBannerClaim at null again (fix 3's local
 *   memory, wiped by the sign-in remount) and F4-L2 fails; drop onboarding's
 *   pending-claim fallback in the onComplete hand-off and F4-L3 fails; make
 *   onboardingClaimHandoff ignore the link with several found and F4-L1 fails.
 * - N32: go back to `canGoBack ? back() : replace` and F4-B1 / F4-B3 fail;
 *   push OS-opened purchase links again and F4-B2 fails.
 * - N33 noun from the link, N34 day-first card day, N35 "Refund" not
 *   "Refunded", N37 Past by month: F4-N33 / F4-N34 / F4-N35 / F4-N37.
 * - stepper: allow "−" at one guest and F4-S1 fails.
 */
// Jest globals, typed locally (app-mobile has no jest types in its tsconfig).
interface F4Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toContain(v: unknown): void;
  toBeGreaterThan(v: number): void;
  not: { toBe(v: unknown): void; toContain(v: unknown): void; toBeNull(): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void | Promise<void>) => void;
declare const expect: (v: unknown) => F4Matchers;
declare const jest: { mock(path: string, factory: () => unknown): void };
declare const require: (id: string) => { readFileSync(p: string, enc: string): string };
declare const __dirname: string;

jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
  reactivateExplorerForVerifiedSession: () => undefined,
}));
jest.mock("../../../lib/secureStoreSafe", () => ({ secureDeleteItem: () => undefined, secureGetItem: () => undefined, secureSetItem: () => undefined }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));

import type { ClaimedEntry, PendingClaim } from "../../../services/attendanceClaimService";
import { rememberWelcomeLinkedClaim, welcomeLinkedClaim } from "../../../services/pendingClaimPolicy";
import { bannerDestination, onboardingClaimHandoff, openFoundBannerTarget } from "../missingTicketModel";
import { osLinkPushIsDuplicate, purchaseDetailBack } from "../purchaseDetailNav";
import {
  parseVenueBooking,
  venueBookingMoneyRows,
  venueGuestChangeLabel,
  venueGuestsCanDecrease,
} from "../venuePurchaseModel";
import { claimLinkNounFromUrl } from "../../signIn/welcomeClaimModel";
import { itemWhen } from "../../profile/purchasesCardWhen";
import { buildPurchaseTimeline, type PurchaseSources, type PurchaseTimelineItem } from "../../../utils/purchaseTimeline";

const fs = require("fs");
const read = (rel: string): string => fs.readFileSync(`${__dirname}/${rel}`, "utf8");
const INDEX = "../../../../app/index.tsx";
const LAGOS = "Africa/Lagos";

const entry = (over: Partial<ClaimedEntry>): ClaimedEntry => ({
  kind: "venue_booking", id: "c14ed7f7", routeKind: "venue_booking", routeId: "c14ed7f7",
  offeringType: "venue", noun: "pass", title: "Gameland QA", orderLabel: null,
  startsAt: "2026-11-23T09:00:00Z", timezone: LAGOS, venueLine: null, quantity: 1,
  source: "booking", sentByFirstName: null, chatJoined: null, conversationId: null,
  ...over,
} as ClaimedEntry);
// What device pass 4's sweep attached: two passes and a waitlist place.
const THREE: ClaimedEntry[] = [
  entry({}),
  entry({ id: "f345010d", routeId: "f345010d", startsAt: "2026-11-26T13:00:00Z" }),
  entry({ kind: "venue_waitlist", id: "5cc483e4", routeKind: "venue_waitlist", routeId: "5cc483e4", noun: "booking", title: "Guest QA Grill", startsAt: "2026-11-27T18:00:00Z" }),
];
const linked = (over: Partial<PendingClaim> = {}): PendingClaim => ({
  code: "E5DP35E90M", noun: "pass", title: "Gameland QA", orderLabel: null,
  startsAt: "2026-11-23T09:00:00+00:00", timezone: LAGOS, emailMasked: "h•••@e•••.com",
  phoneLast4: null, preferredProof: "email", expired: false, kind: "venue_booking", ...over,
});

describe("W2-N31 a new account made from a claim card opens that purchase after onboarding", () => {
  test("F4-L1 the hand-off opens the linked purchase among several; others stay in Purchases", () => {
    expect(onboardingClaimHandoff(linked(), THREE)).toEqual({
      path: "/purchases/venue_booking/c14ed7f7", kind: "venue_booking", reason: "linked",
    });
    // One found: that one, whatever the link said.
    expect(onboardingClaimHandoff(linked({ title: "Other" }), [THREE[1]]).path).toBe("/purchases/venue_booking/f345010d");
    // Several found, none matching the link: the list.
    expect(onboardingClaimHandoff(linked({ title: "Other" }), THREE)).toEqual({ path: "/purchases", kind: null, reason: "several_unmatched" });
    // No link, or nothing attached: Home as before.
    expect(onboardingClaimHandoff(null, THREE).path).toBeNull();
    expect(onboardingClaimHandoff(linked(), []).path).toBeNull();
    expect(onboardingClaimHandoff(linked(), null).reason).toBe("nothing_attached");
  });

  test("F4-L2 the welcome card's claim survives the sign-in remount", () => {
    // Root cause: AppContent is keyed on the signed-in account, so signing in
    // remounts it and fix 3's ref/state started empty.
    const index = read(INDEX);
    expect(index).toContain("<SessionManagementProvider key={sessionOwnerId}>");
    rememberWelcomeLinkedClaim(linked());
    expect(welcomeLinkedClaim()?.code).toBe("E5DP35E90M");
    // The signed-in instance seeds its state from module memory on mount.
    expect(index).toContain("() => (isAuthenticated ? welcomeLinkedClaim() : null),");
    // A signed-out welcome holds exactly what its card shows (null clears).
    expect(index).toContain("rememberWelcomeLinkedClaim(ticketClaim);");
    rememberWelcomeLinkedClaim(null);
    expect(welcomeLinkedClaim()).toBeNull();
  });

  test("F4-L3 onboarding's end uses the card or onboarding's own pending claim, logs without personal data, and navigates", () => {
    const index = read(INDEX);
    const done = index.slice(index.indexOf("logger.nav('OnboardingFlow completed"));
    const block = done.slice(0, done.indexOf("requestPostTourPermissions()"));
    expect(block).toContain("linkedBannerClaim ?? result?.claim?.pendingClaim ?? null");
    expect(block).toContain("result?.claim?.attached ?? null");
    expect(block).toContain("logger.nav('[ClaimHandoff] onboarding done', {");
    expect(block).toContain("navigated: handoff.path !== null,");
    expect(block).not.toContain("emailMasked");
    expect(block).not.toContain(".code");
    expect(block).toContain("router.push(path as never);");
    const loader = read("../../onboarding/OnboardingLoader.tsx");
    expect(loader).toContain("claim: { pendingClaim: claimDecision.pendingClaim, attached },");
    expect(loader).toContain("lastAttachedClaimSweep(userId)?.claimed");
  });

  test("F4-V1 the banner's View: one purchase opens it, several open the linked one, else the list", () => {
    const opened: string[] = [];
    let dismissed = 0;
    const view = (claimed: ClaimedEntry[], link: PendingClaim | null): string =>
      openFoundBannerTarget({ claimed, linkedClaim: link, dismiss: () => { dismissed += 1; }, push: (p) => opened.push(p) });
    expect(view([THREE[1]], null)).toBe("/purchases/venue_booking/f345010d");
    expect(view(THREE, linked())).toBe("/purchases/venue_booking/c14ed7f7");
    expect(view(THREE, null)).toBe("/purchases");
    expect(opened).toEqual(["/purchases/venue_booking/f345010d", "/purchases/venue_booking/c14ed7f7", "/purchases"]);
    expect(dismissed).toBe(3);
    expect(bannerDestination(THREE, linked({ kind: "venue_waitlist", title: "Guest QA Grill", startsAt: "2026-11-27T18:00:00Z" })))
      .toBe("/purchases/venue_waitlist/5cc483e4");
    const banner = read("../TicketFoundBanner.tsx");
    expect(banner).toContain("openFoundBannerTarget({");
  });
});

describe("W2-N32 the Purchases detail back is never a dead tap", () => {
  const detail = (id: string, kind = "venue_waitlist") => ({ name: "purchases/[kind]/[id]", params: { kind, id } });
  test("F4-B1 back pops past copies of the same detail; nothing else below opens the list", () => {
    // A warm link opened twice: [Home, detail, detail] -> pop both.
    expect(purchaseDetailBack([{ name: "index" }, detail("w1"), detail("w1")], 2)).toEqual({ kind: "dismiss", count: 2 });
    // From the list: one pop.
    expect(purchaseDetailBack([{ name: "index" }, { name: "purchases/index" }, detail("b1", "venue_booking")], 2)).toEqual({ kind: "dismiss", count: 1 });
    // A different purchase below is a real step back.
    expect(purchaseDetailBack([{ name: "index" }, detail("w2"), detail("w1")], 2)).toEqual({ kind: "dismiss", count: 1 });
    // Opened with no history (cold link) or only copies below: the list.
    expect(purchaseDetailBack([detail("w1")], 0)).toEqual({ kind: "replace", href: "/purchases" });
    expect(purchaseDetailBack([detail("w1"), detail("w1")], 1)).toEqual({ kind: "replace", href: "/purchases" });
    expect(purchaseDetailBack(undefined, undefined)).toEqual({ kind: "replace", href: "/purchases" });
  });

  test("F4-B2 a purchase link the OS opened is not pushed a second time; replays, pushes and other links still are", () => {
    expect(osLinkPushIsDuplicate("os", "purchase")).toBe(true);
    expect(osLinkPushIsDuplicate("replay", "purchase")).toBe(false);
    expect(osLinkPushIsDuplicate("os", "route")).toBe(false);
    expect(osLinkPushIsDuplicate("os", undefined)).toBe(false);
    const index = read(INDEX);
    const handler = index.slice(index.indexOf("const handleDeepLink = async (url: string, opts"));
    // [TEST-MOD-APPROVED #4490] merge with #4508: the OS link paths pass
    // { routerOpened }, so passing opts at all is the "os" source.
    expect(handler.slice(0, 400)).toContain('const source: "os" | "replay" = opts === undefined ? "replay" : "os";');
    expect(handler.slice(0, handler.indexOf("executeDeepLink(action, {"))).toContain("if (osLinkPushIsDuplicate(source, action?.kind)) {");
    const linking = index.slice(index.indexOf("Linking.getInitialURL().then(async (url) => {"));
    expect(linking.slice(0, 1600)).toContain('handleDeepLink(url, { routerOpened: routerServesLink(url) });');
    expect(linking.slice(0, 1600)).toContain('handleDeepLink(event.url, { routerOpened: routerServesLink(event.url) });');
  });

  test("F4-B3 every purchase kind's detail uses the shared back", () => {
    const route = read("../../../../app/purchases/[kind]/[id].tsx");
    const goBack = route.slice(route.indexOf("const goBack = (): void => {"));
    expect(goBack.slice(0, 400)).toContain("purchaseDetailBack(state?.routes, state?.index)");
    expect(goBack.slice(0, 400)).not.toContain("router.back()");
  });
});

describe("W2-N33..N37 and the guest stepper", () => {
  test("F4-N33 'Opening your …' names a pass only when the link says so", () => {
    expect(claimLinkNounFromUrl("https://go.usemingla.com/w36m/claim?deep_link_value=claim&deep_link_sub1=E5DP35E90M&pid=claim_link&c=pass")).toBe("pass");
    expect(claimLinkNounFromUrl("https://usemingla.com/c/E5DP35E90M")).toBeNull();
    expect(claimLinkNounFromUrl("com.mingla.app.v2://c/E5DP35E90M")).toBeNull();
    expect(claimLinkNounFromUrl("https://x.test/?c=bogus")).toBeNull();
    const welcome = read("../../signIn/WelcomeScreen.tsx");
    expect(welcome).not.toContain('"auth:welcome.opening.ticket"');
    expect(welcome).toContain("t(`auth:welcome.opening.${ticketClaimResolvingNoun}`)");
  });

  const item = (kind: PurchaseTimelineItem["kind"], startsAt: string): PurchaseTimelineItem =>
    ({ kind, startsAt, timezone: LAGOS, whenText: null } as unknown as PurchaseTimelineItem);
  test("F4-N34 the Profile card reads a venue day day-first", () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}:${String(o?.time ?? "")}`;
    expect(itemWhen(item("venue_booking", "2026-11-26T13:00:00Z"), "month:2026-11", t)).toBe("Thu 26 Nov · 14:00");
  });

  test("F4-N35 a refund still being sent is not called Refunded", () => {
    const b = parseVenueBooking({
      groupId: "c14ed7f7-0000-4000-8000-000000000001", reference: "VB-C14ED7F7", state: "cancelled", version: 3,
      offerKind: "entry", currencyCode: "NGN", totalMinor: 1290000, paidMinor: 1290000, refundedMinor: 1290000,
      balanceDueMinor: 0, amountDueNowMinor: 0, paidAtVenueMinor: 0, createdAt: "2026-11-20T10:00:00+00:00",
      venue: { id: "v1", name: "Gameland QA", slug: "gameland", brandSlug: "b", brandName: "B", timezone: LAGOS },
      offer: { id: "o1", kind: "entry", name: "Boardroom" },
      window: { localDate: "2026-11-23", startsAt: "2026-11-23T09:00:00+00:00", endsAt: "2026-11-23T10:00:00+00:00" },
      lines: [], passes: [], extras: [], changeRules: { canChangeGuests: false },
    });
    if (b === null) throw new Error("parse");
    const rows = venueBookingMoneyRows(b);
    expect(rows.map((r) => r.label)).not.toContain("Refunded");
    expect(rows.find((r) => r.label === "Refund")?.value).toBe("₦12,900.00");
  });

  test("F4-N37 Past is grouped by month: a place left for later today is not under Tonight", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    const sources: PurchaseSources = {
      orders: [], rsvps: [], reservations: [], venueOrders: [],
      // Left ("lost") place for 19:00 Lagos today, seen in Past.
      venueWaitlist: [{
        id: "w1", title: "Guest QA Grill", venueLine: null, startAt: "2026-11-22T18:00:00Z",
        createdAt: "2026-11-20T10:00:00Z", timezone: LAGOS, status: "lost", partySize: 2, raw: {},
      }],
    };
    const timeline = buildPurchaseTimeline(sources, now);
    const titles = timeline.past.map((g) => g.title);
    expect(titles).not.toContain("Tonight");
    expect(titles).not.toContain("Today");
    expect(timeline.past.flatMap((g) => g.items).length).toBe(1);
  });

  test("F4-S1 the guest label reads right for every count and '−' is off at one guest", () => {
    expect(venueGuestChangeLabel(1)).toBe("Change to 1 guest");
    expect(venueGuestChangeLabel(2)).toBe("Change to 2 guests");
    for (let n = 2; n <= 40; n += 1) expect(venueGuestChangeLabel(n)).toBe(`Change to ${n} guests`);
    expect(venueGuestsCanDecrease(1)).toBe(false);
    expect(venueGuestsCanDecrease(2)).toBe(true);
    const body = read("../VenuePurchaseDetail.tsx");
    expect(body).toContain("disabled={!venueGuestsCanDecrease(guests)}");
  });
});
