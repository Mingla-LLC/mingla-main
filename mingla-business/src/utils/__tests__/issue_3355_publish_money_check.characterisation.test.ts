/**
 * #3355 P5 — CHARACTERISATION of today's Host publish-form money check.
 *
 * Seth's scope change (2026-11-01): the publish form's money check is NOT
 * changed by P5 (publishing works; zero regressions). These tests pin its
 * exact current behaviour so any later change is a deliberate, visible
 * decision. They do not assert that the behaviour is right.
 *
 * Today every Host publish form asks `payoutGateStatus(brand)` (utils/
 * brandPayout.ts) and blocks a paid offering when that is not "active":
 *   - event:      validatePublish / computePublishability (draftEventValidation)
 *   - trip, exp.: offeringNeedsStripeToPublish (publishStripeReadiness)
 * The server's publish RPC uses pg_brand_can_collect. The cases marked
 * DISAGREES below are where the two can give different answers; they are
 * listed for Seth in the P5 report, not fixed here.
 */
import { describe, expect, test } from "@jest/globals";

import { offeringNeedsStripeToPublish } from "../../components/offering/publishStripeReadiness";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { isBrandChargeReady, payoutGateStatus } from "../brandPayout";
import { computePublishability, validatePublish } from "../draftEventValidation";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: 12,
  capacity: 30,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b46d2",
  brandId: "64cb8e35-5b53-4633-8780-d7769bead244",
  serverSlug: "friday-supper-1a2b",
  name: "Friday Supper",
  description: "A proper supper club.",
  format: "hybrid",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "multi_date",
  date: null,
  doorsOpen: "18:30",
  endsAt: "22:00",
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: [
    {
      id: "md-1",
      date: "2026-06-01",
      startTime: "18:30",
      endTime: "22:00",
      overrides: {
        title: "Night one",
        description: null,
        venueName: "Studio",
        address: null,
        onlineUrl: null,
      },
    },
    {
      id: "md-2",
      date: "2026-06-02",
      startTime: "18:30",
      endTime: "22:00",
      overrides: {
        title: null,
        description: "Second night",
        venueName: null,
        address: "1 Test Street",
        onlineUrl: null,
      },
    },
  ],
  venueName: "Studio",
  address: "1 Test Street",
  city: null,
  locationGeo: null,
  onlineUrl: "https://example.com/live",
  hideAddressUntilTicket: true,
  coverHue: 180,
  coverMediaUrl: "https://cdn.example.com/event-cover.gif",
  coverMediaType: "gif",
  coverMediaProvider: "giphy",
  coverMediaSourceUrl: "https://giphy.com/gifs/event-cover",
  coverMediaCredit: "GIPHY",
  coverMediaCreditUrl: "https://giphy.com",
  coverMediaAlt: "Dancing cover GIF",
  tickets: [ticket()],
  visibility: "unlisted",
  requireApproval: true,
  allowTransfers: false,
  hideRemainingCount: true,
  passwordProtected: false,
  privateGuestList: true,
  inPersonPaymentsEnabled: true,
  isRsvp: false,
  rsvpCapacity: null,
  rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0,
  rsvpWaitlistEnabled: false,
  rsvpApprovalMode: "auto",
  rsvpDiscoverable: false,
  rsvpContributionEnabled: false,
  rsvpContributionSuggestedCents: null,
  rsvpContributionMinCents: null,
  lastStepReached: 5,
  status: "draft",
  createdAt: "2026-05-08T08:00:00.000Z",
  updatedAt: "2026-05-08T08:10:00.000Z",
  ...patch,
});

const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/** Otherwise-publishable draft (same shape the mapper suite proves valid). */
const publishable = (tickets: TicketStub[]): DraftEvent =>
  draft({
    partyTypes: ["birthday-party"],
    whenMode: "single",
    date: future,
    multiDates: null,
    city: "London",
    locationGeo: { lat: 51.5, lng: -0.12 },
    tickets,
  });

const paid = publishable([ticket({ priceGbp: 12, isFree: false })]);
const free = publishable([ticket({ priceGbp: 0, isFree: true })]);
const moneyBlocked = (d: DraftEvent, status: ReturnType<typeof payoutGateStatus>): boolean =>
  validatePublish(d, status).some((e) => e.fieldKey === "stripeNotConnected");

describe("#3355 P5 characterisation — payoutGateStatus (what every publish form reads)", () => {
  type GateBrand = Parameters<typeof payoutGateStatus>[0];
  const cases: Array<[string, GateBrand, string]> = [
    ["no brand", null, "not_connected"],
    ["Stripe active", { stripeStatus: "active" }, "active"],
    ["Stripe onboarding", { stripeStatus: "onboarding" }, "onboarding"],
    ["Stripe restricted", { stripeStatus: "restricted" }, "restricted"],
    ["charges_enabled true, status onboarding", { stripeStatus: "onboarding", chargesEnabled: true }, "active"],
    // DISAGREES (case A): charges disabled live, cached status still "active".
    ["charges_enabled false, status active", { stripeStatus: "active", chargesEnabled: false }, "active"],
    ["Paystack with subaccount", { paymentProvider: "paystack", paystackSubaccountCode: "ACCT_1" }, "active"],
    ["Paystack hold rail (cutover stamped)", { paymentProvider: "paystack", payoutHoldCutoverAt: "2026-10-01T00:00:00Z" }, "active"],
    // DISAGREES (case B): Paystack hold rail, record without the cutover stamp.
    ["Paystack, no subaccount, no cutover", { paymentProvider: "paystack" }, "not_connected"],
    ["Paystack, no subaccount, stale Stripe active", { paymentProvider: "paystack", stripeStatus: "active" }, "active"],
  ];
  test.each(cases)("%s → %s", (_name, brand, expected) => {
    expect(payoutGateStatus(brand)).toBe(expected);
  });

  test("charge readiness ignores the cached status once a live charges flag exists", () => {
    expect(isBrandChargeReady({ stripeStatus: "active", chargesEnabled: false })).toBe(false);
    // …but payoutGateStatus then falls back to the cached status (case A).
    expect(payoutGateStatus({ stripeStatus: "active", chargesEnabled: false })).toBe("active");
  });
});

describe("#3355 P5 characterisation — event publish form (draftEventValidation)", () => {
  test("a paid draft publishes only when the status is exactly \"active\"", () => {
    expect(moneyBlocked(paid, "active")).toBe(false);
    for (const status of ["not_connected", "onboarding", "restricted"] as const) {
      expect(moneyBlocked(paid, status)).toBe(true);
    }
  });

  test("a free draft is never money-blocked", () => {
    for (const status of ["active", "not_connected", "onboarding", "restricted"] as const) {
      expect(moneyBlocked(free, status)).toBe(false);
    }
  });

  test("the money error copy and step are unchanged", () => {
    expect(validatePublish(paid, "not_connected")).toEqual([
      {
        fieldKey: "stripeNotConnected",
        step: 4,
        message: "Connect a bank to publish paid tickets.",
      },
    ]);
  });

  test("computePublishability reports blocked-stripe for a paid draft without active", () => {
    expect(computePublishability(paid, "onboarding")).toEqual({
      isReady: false,
      hasPaidTickets: true,
      needsStripe: true,
      errorCount: 0,
      status: "blocked-stripe",
    });
    expect(computePublishability(paid, "active").status).toBe("ready");
  });

  test("door-only paid tickets still count as paid on the client (server exempts them)", () => {
    const door = publishable([ticket({ priceGbp: 12, isFree: false, availableAt: "door" })]);
    expect(moneyBlocked(door, "not_connected")).toBe(true);
  });
});

describe("#3355 P5 characterisation — trip / experience publish banners", () => {
  test("paid needs \"active\"; free never blocks", () => {
    expect(offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: "active" })).toBe(false);
    expect(offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: null })).toBe(true);
    expect(offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: "onboarding" })).toBe(true);
    expect(offeringNeedsStripeToPublish({ isPaid: false, stripeStatus: null })).toBe(false);
  });
});
