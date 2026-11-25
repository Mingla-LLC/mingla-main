/**
 * #4490 P6-2 / P6-3 (Host, guest) and the P5 follow-ups of this round — pure
 * models and mappers: memberships on the Host (plan draft and checks, member
 * words, filters, the billing timeline, refusals), the guest member page model
 * (status words, the month's VAT, the three "how you pay" lines, the member's
 * price line, which member this device knows), the door's member results, the
 * nav and capability gate with Memberships, the Plans tab, the floor-plan
 * overlap check, the by-the-hour line words and move rule.
 */
// TEST-MOD-APPROVED #4490: the plan/member fixtures now carry the additive
// request-mode, plan-period and dedicated-desk fields owned by this issue.
import {
  billingSteps,
  memberErrorCopy,
  memberMatches,
  memberRowLine,
  memberStatusWords,
  planDraftFrom,
  planErrorCopy,
  planIncludesLines,
  planIssueList,
  planIssues,
  planPayload,
  planStatusWords,
  timelineWords,
} from "../features/members/membersModel";
import {
  guestMemberState,
  howYouPayLines,
  memberGuestErrorCopy,
  memberUseLine,
  parseGuestMember,
  parseMemberQuote,
  payLabel,
  planGiveLines,
  planJoinPath,
  readVenueMember,
  rememberVenueMember,
} from "../offers/memberGuestModel";
import { hourSummaryLabel } from "../offers/hourGuestModel";
import { checkInResultView, doorErrorCopy, memberIdFromCode } from "../features/checkin/venueCheckInResult";
import { overlappingTables } from "../features/floor/floorModel";
import { hourDraftFrom, hourMoveRule } from "../features/offers/hourModel";
import { NEW_OFFER_CARDS } from "../features/offers/offersModel";
import { featureSwitchConfirm } from "../features/featureSwitchModel";
import { deriveVenueNav } from "../venueModules";
import { filterVenueModulesForCapabilities } from "../venueCapabilityGate";
import { featureSetFrom } from "../../../types/venueFeatures";
import { mapMemberDetail, mapMembersList, mapMembershipPlan } from "../../../services/venueMembersService";
import { mapScanOutcome } from "../../../services/venueOffersService";
import { deriveVenuePage, parsePlan, parsePublicVenueFeatures } from "@mingla/brand-rendering/venueFeaturePage";
import type { MembershipPlan, VenueMemberDetail, VenueMemberRow } from "../../../types/venueMembers";
import type { VenueOffer } from "../../../types/venueOffers";

const NAIRA = (n: number): number => n * 100;

function plan(over: Partial<MembershipPlan> = {}): MembershipPlan {
  return {
    id: "p1",
    venueId: "v1",
    name: "Hot desk",
    summary: null,
    inclusions: ["Power and fast internet"],
    priceMinor: NAIRA(85000),
    currencyCode: "NGN",
    period: "month",
    joinMode: "instant",
    deskSpaceIds: [],
    deskSpaces: [],
    entryIncluded: true,
    entryOfferingId: "e1",
    entryOfferName: "Day pass",
    roomHours: 4,
    hourOfferingIds: [],
    hourOfferNames: ["Boardroom"],
    guestPasses: 2,
    discountBps: 1000,
    discountKinds: ["by_the_hour"],
    maxMembers: 60,
    minMonths: 1,
    noticeDays: 0,
    graceDays: 7,
    renewalNoticeDays: 7,
    status: "live",
    sortOrder: 0,
    version: 3,
    members: 2,
    activeMembers: 2,
    full: false,
    periodLocked: false,
    ...over,
  };
}

function row(over: Partial<VenueMemberRow> = {}): VenueMemberRow {
  return {
    subscriptionId: "s1",
    name: "Amaka Eze",
    email: "amaka@example.com",
    phone: null,
    planId: "p1",
    planName: "Hot desk",
    planPeriod: "month",
    status: "active",
    activeUntil: "2026-12-19T00:00:00Z",
    renewsOn: "2026-12-19T00:00:00Z",
    leavingOn: null,
    pausingOn: null,
    roomHoursLeft: 3,
    guestPassesLeft: 2,
    inToday: false,
    amountDueMinor: null,
    assignedSpaceName: null,
    version: 1,
    joinedAt: "2026-11-19T10:00:00Z",
    ...over,
  };
}

describe("P6-2 plan draft and checks", () => {
  it("a new plan needs a name and a monthly price; free entry needs its Entry offer; a member price needs what it is off", () => {
    const d = planDraftFrom(null);
    expect(planIssueList(planIssues(d))).toEqual(["Name this plan", "Set the monthly price"]);
    const withEntry = { ...d, name: "Hot desk", priceMinor: NAIRA(85000), entryIncluded: true, entryOfferingId: null };
    expect(planIssues(withEntry).entry).toBe("Pick the Entry offer members get in on");
    const discount = { ...withEntry, entryOfferingId: "e1", discountPercent: 10, discountKinds: [] };
    expect(planIssues(discount).discount).toBe("Pick what the member price applies to");
    expect(planIssueList(planIssues({ ...discount, discountKinds: ["by_the_hour"] }))).toEqual([]);
  });
  it("the single-payment cap is refused in plain words", () => {
    expect(planIssues({ ...planDraftFrom(null), name: "X", priceMinor: 2_147_483_648 }).price).toBe("This price is too large to take in one payment");
  });
  it("the payload is exactly the server's shape: percent → basis points, passes only with entry, rooms only with hours", () => {
    const d = { ...planDraftFrom(null), name: " Hot desk ", priceMinor: NAIRA(85000), entryIncluded: false, entryOfferingId: "e1", guestPasses: 2, roomHours: 0, hourOfferingIds: ["h1"], discountPercent: 10, discountKinds: ["by_the_hour" as const], limitMembers: false };
    expect(planPayload(d, null)).toEqual({
      name: "Hot desk",
      summary: null,
      inclusions: [],
      priceMinor: 8500000,
      period: "month",
      joinMode: "instant",
      deskSpaceIds: [],
      entryIncluded: false,
      entryOfferingId: null,
      roomHours: 0,
      hourOfferingIds: [],
      guestPasses: 0,
      discountBps: 1000,
      discountKinds: ["by_the_hour"],
      maxMembers: null,
      minMonths: 1,
      noticeDays: 0,
      graceDays: 7,
      renewalNoticeDays: 7,
    });
    expect(planPayload({ ...d, limitMembers: true, maxMembers: 60 }, "p1")).toMatchObject({ planId: "p1", maxMembers: 60 });
  });
  it("a saved plan reads back into the same draft", () => {
    const p = plan();
    const d = planDraftFrom(p);
    expect(d).toMatchObject({ name: "Hot desk", priceMinor: 8500000, discountPercent: 10, limitMembers: true, maxMembers: 60, guestPasses: 2 });
    expect(planPayload(d, p.id)).toMatchObject({ planId: "p1", discountBps: 1000, entryOfferingId: "e1", guestPasses: 2 });
  });
  it("what's included reads as lines (D P6-1: 4 room hours, 2 guest passes)", () => {
    expect(planIncludesLines(planDraftFrom(plan()), { entryOffer: "Day pass", hourOffers: ["Boardroom"] })).toEqual([
      "Free entry (Day pass)",
      "4 hours of Boardroom a month",
      "2 guest passes a month",
      "10% off by the hour",
      "Power and fast internet",
    ]);
  });
  it("plan status words: on sale, full, not taking new members", () => {
    expect(planStatusWords(plan()).label).toBe("On sale");
    expect(planStatusWords(plan({ full: true })).label).toBe("Full");
    expect(planStatusWords(plan({ status: "paused" })).label).toBe("Not taking new members");
  });
  it("refusals are plain words, never a code", () => {
    expect(planErrorCopy("offer_not_ready", "feature_off")).toBe("Memberships is off for this venue. Turn it on, then publish.");
    expect(planErrorCopy("plan_has_members")).toMatch(/Stop new members instead/);
    expect(planErrorCopy("anything_else")).toBe("That didn't save. Try again.");
    expect(memberErrorCopy("member_cancel_reason_required")).toMatch(/Say why/);
    expect(memberErrorCopy("member_guest_passes_used_up", "1")).toBe("Only 1 guest pass is left this month.");
    expect(memberErrorCopy("weird")).toBe("That didn't go through. Try again.");
  });
});

describe("P6-2 members list", () => {
  it("status words follow the contract (active, payment due, in grace, lapsed, paused, joining, ended, leaving)", () => {
    expect(memberStatusWords("active").label).toBe("Active");
    expect(memberStatusWords("active", "2026-12-19").label).toBe("Leaving");
    expect(memberStatusWords("payment_due").label).toBe("Payment due");
    expect(memberStatusWords("grace").label).toBe("In grace");
    expect(memberStatusWords("lapsed")).toEqual({ label: "Lapsed", variant: "error" });
    expect(memberStatusWords("paused").label).toBe("Paused");
    expect(memberStatusWords("pending").label).toBe("Joining");
    expect(memberStatusWords("cancelled").label).toBe("Ended");
  });
  it("each filter chip picks its members", () => {
    const rows = [
      row(),
      row({ subscriptionId: "s2", status: "payment_due" }),
      row({ subscriptionId: "s3", status: "grace" }),
      row({ subscriptionId: "s4", status: "lapsed" }),
      row({ subscriptionId: "s5", status: "paused" }),
      row({ subscriptionId: "s6", leavingOn: "2026-12-19T00:00:00Z" }),
      row({ subscriptionId: "s7", status: "pending" }),
    ];
    const ids = (f: Parameters<typeof memberMatches>[1]): string[] => rows.filter((r) => memberMatches(r, f)).map((r) => r.subscriptionId);
    expect(ids("active")).toEqual(["s1"]);
    expect(ids("payment_due")).toEqual(["s2"]);
    expect(ids("grace")).toEqual(["s3"]);
    expect(ids("lapsed")).toEqual(["s4"]);
    expect(ids("paused")).toEqual(["s5"]);
    expect(ids("leaving")).toEqual(["s6"]);
    expect(ids("joining")).toEqual(["s7"]);
    expect(ids("all")).toHaveLength(7);
  });
  it("one line under each member says what happens next", () => {
    expect(memberRowLine(row(), "Africa/Lagos")).toBe("Renews Sat 19 Dec");
    expect(memberRowLine(row({ leavingOn: "2026-12-19T00:00:00Z" }), "Africa/Lagos")).toBe("Leaving Sat 19 Dec");
    expect(memberRowLine(row({ status: "lapsed" }), "Africa/Lagos")).toBe("Not paid: can't check in");
    expect(memberRowLine(row({ status: "pending" }), "Africa/Lagos")).toBe("First month not paid yet");
  });
  it("the server list maps with tiles and rows", () => {
    const list = mapMembersList({
      venueId: "v1",
      localDate: "2026-11-19",
      tiles: { members: 2, membersAllowed: 65, inToday: 1, paymentDue: { count: 1, amountMinor: 14000000 }, renewingThisWeek: 0 },
      members: [{ subscriptionId: "s1", name: "Amaka QA", planId: "p1", planName: "QA Hot desk", status: "lapsed", roomHoursLeft: "4.00", amountDueMinor: 8500000, version: 2 }],
    });
    expect(list.tiles).toEqual({ members: 2, membersAllowed: 65, inToday: 1, paymentDue: { count: 1, amountMinor: 14000000 }, renewingThisWeek: 0 });
    expect(list.members[0]).toMatchObject({ name: "Amaka QA", status: "lapsed", roomHoursLeft: 4, amountDueMinor: 8500000 });
    expect(mapMembershipPlan({ id: "p", name: "X", priceMinor: 100, status: "weird", roomHours: "4.00" })).toMatchObject({ status: "draft", roomHours: 4 });
  });
});

function detail(over: Partial<VenueMemberDetail> = {}): VenueMemberDetail {
  return mapMemberDetail({
    subscriptionId: "s1",
    status: "payment_due",
    memberName: "Seun",
    plan: { id: "p1", name: "Dedicated desk", priceMinor: 14000000, currencyCode: "NGN" },
    venue: { id: "v1", name: "Kora", timezone: "Africa/Lagos" },
    activeUntil: "2026-11-18T23:00:00Z",
    paymentDue: { periodId: "m2", amountMinor: 14000000, currencyCode: "NGN", periodStart: "2026-11-18T23:00:00Z", periodEnd: "2026-12-18T23:00:00Z", dueAt: "2026-11-18T23:00:00Z", graceEndsAt: "2026-11-25T23:00:00Z", status: "link_sent", paying: false },
    timeline: [
      { type: "member_renewal_sent", by: "system", at: "2026-11-11T09:00:00Z", periodId: "m2" },
      { type: "member_reminder_sent", by: "system", at: "2026-11-21T09:00:00Z", periodId: "m2" },
    ],
    periods: [{ periodId: "m1", sequence: 1, start: "2026-10-18T23:00:00Z", end: "2026-11-18T23:00:00Z", amountMinor: 14000000, currencyCode: "NGN", status: "paid", paidVia: "venue", paidMethod: "transfer", paidAt: "2026-10-19T10:00:00Z" }],
    ...over,
  });
}

describe("P6-2 the billing timeline (mb-member)", () => {
  it("an approved request shows its three-day payment window, not the instant-join two-day rule", () => {
    const request = detail();
    request.status = "pending";
    request.plan.joinMode = "request";
    request.createdAt = "2026-11-21T12:00:00Z";
    request.paymentDue = {
      ...request.paymentDue!,
      dueAt: "2026-11-24T12:00:00Z",
    };
    const steps = billingSteps(request, Date.parse("2026-11-21T12:00:00Z"));
    expect(steps.at(-1)).toEqual({
      key: "closes",
      title: "3 days to pay after approval",
      meta: "Closes if still unpaid after Tue 24 Nov",
      state: "pending",
    });
  });

  it("payment due: email sent, reminder sent, can still check in until the grace ends, then it lapses", () => {
    const steps = billingSteps(detail(), Date.parse("2026-11-21T12:00:00Z"));
    expect(steps.map((s) => [s.title, s.meta, s.state])).toEqual([
      ["Payment email sent", "Wed 11 Nov", "done"],
      ["Reminder sent", "Sat 21 Nov", "done"],
      ["Can still check in", "Until Thu 26 Nov, then it lapses", "current"],
      ["Lapses if still unpaid", "Thu 26 Nov", "pending"],
    ]);
  });
  it("paid up: paid until, the payment email day and the renewal", () => {
    const steps = billingSteps(detail({ status: "active" as const, paymentDue: null, renewsOn: "2026-12-19T00:00:00Z", renewalEmailOn: "2026-12-12T00:00:00Z", activeUntil: "2026-12-19T00:00:00Z" }));
    expect(steps.map((s) => s.title)).toEqual(["Paid", "Payment email goes out", "Renews"]);
  });
  it("timeline words say who did it", () => {
    expect(timelineWords({ type: "member_ended", by: "staff", at: "", periodId: null, detail: null })).toBe("Membership ended by the venue");
    expect(timelineWords({ type: "member_leaving", by: "member", at: "", periodId: null, detail: null })).toBe("Asked to leave by the member");
  });
});

describe("P6-2 nav, capabilities and the feature switch", () => {
  it("Members appears only when Memberships is on; Check-in and Today follow it (members come in at the door)", () => {
    const off = deriveVenueNav({ features: featureSetFrom({ menu: true }), activeSpaceCount: 0 });
    expect(off).not.toContain("members");
    const on = deriveVenueNav({ features: featureSetFrom({ memberships: true, menu: true }), activeSpaceCount: 0 });
    expect(on).toEqual(["overview", "offers", "spaces", "availability", "today", "members", "checkin", "menu", "insights", "orders", "settings"]);
    expect(on).not.toContain("calendar");
  });
  it("venue.manage_members sees Members only", () => {
    const nav = deriveVenueNav({ features: featureSetFrom({ memberships: true, entry: true }), activeSpaceCount: 1 });
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.manage_members"])).toEqual(["members"]);
  });
  it("turning Memberships off says what happens to members", () => {
    expect(featureSwitchConfirm("memberships", false, [])?.body).toBe(
      "Nobody new can join your plans and the Plans tab leaves your venue page. Current members keep their membership and their payment emails.",
    );
    expect(featureSwitchConfirm("memberships", true, [])).toBeNull();
  });
  it("Membership is pickable in New offer (nothing reads Coming soon)", () => {
    const card = NEW_OFFER_CARDS.find((c) => c.key === "membership");
    expect(card?.built).toBe(true);
    expect(NEW_OFFER_CARDS.every((c) => c.built)).toBe(true);
  });
});

describe("P6-3 guest member page model", () => {
  const raw = {
    subscriptionId: "s1",
    status: "lapsed",
    memberName: "Seun",
    plan: { id: "p1", name: "QA Dedicated desk", priceMinor: 14000000, currencyCode: "NGN", roomHours: 0, guestPasses: 0, inclusions: [] },
    venue: { id: "v1", name: "Gameland QA", slug: "gamelandqa", brandSlug: "harmattan-qa-local", timezone: "Africa/Lagos" },
    paymentDue: { periodId: "m", amountMinor: 14000000, currencyCode: "NGN", periodStart: "2026-11-11", periodEnd: "2026-12-11", graceEndsAt: "2026-11-18T23:00:00Z", paying: false },
    credits: { roomHoursLeft: 0, roomHoursPerMonth: 0, guestPassesLeft: 0, guestPassesPerMonth: 0 },
    canLeave: true,
    pass: { qrPayload: "mingla:v1:vmember:x:sig:y", valid: false },
  };
  it("parses the member read and says Paused (lapsed) in plain words with Pay to start again", () => {
    const m = parseGuestMember(raw);
    expect(m).not.toBeNull();
    const state = guestMemberState(m as NonNullable<typeof m>);
    expect(state.label).toBe("Paused");
    expect(state.title).toBe("Paused: this month isn't paid");
    expect(payLabel(m as NonNullable<typeof m>, "₦150,500")).toBe("Pay ₦150,500 to start again");
    expect(parseGuestMember({ nope: true })).toBeNull();
  });
  // TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): the browser no longer works VAT out (monthTotal is
  // gone); the month's base, VAT and total are the server's, read from paymentDue.
  it("the month's total is the server's (D P6: ₦85,000 + ₦6,375 = ₦91,375), with its VAT breakdown", () => {
    const m = parseGuestMember({
      ...raw,
      paymentDue: { ...(raw as { paymentDue: Record<string, unknown> }).paymentDue, amountMinor: 9137500, baseMinor: 8500000,
        taxMinor: 637500, feeMinor: 0, totalMinor: 9137500, vatMode: "added", vatRatePct: 7.5 },
    });
    expect(m?.paymentDue?.amountMinor).toBe(9137500);
    expect(m?.paymentDue?.charge).toEqual({ baseMinor: 8500000, feeMinor: 0, taxMinor: 637500, totalMinor: 9137500, vatMode: "added", vatRatePct: 7.5 });
    const included = parseGuestMember({
      ...raw,
      paymentDue: { ...(raw as { paymentDue: Record<string, unknown> }).paymentDue, amountMinor: 8500000, baseMinor: 8500000,
        taxMinor: 593023, totalMinor: 8500000, vatMode: "included", vatRatePct: 7.5 },
    });
    expect(included?.paymentDue?.charge?.totalMinor).toBe(8500000);
    expect(included?.paymentDue?.charge?.vatMode).toBe("included");
  });
  it("joining says today, each month and a skipped month in three lines (nothing renews by itself)", () => {
    const lines = howYouPayLines({ period: "month", firstPeriod: "December", renewalNoticeDays: 7, graceDays: 7, minMonths: 1, noticeDays: 0 });
    expect(lines.map((l) => l.title)).toEqual(["Today", "Each month after", "Skip a month"]);
    expect(lines[0]?.body).toBe("You pay for December.");
    expect(lines[1]?.body).toMatch(/7 days before.*Nothing renews by itself/);
    expect(lines[2]?.body).toBe("You can still come in for 7 days, then your membership pauses until it's paid. Leave any time.");
  });
  it("the member's price reads as what it uses (D P6-4 'Uses 2 of your 4 hours')", () => {
    const block = parseMemberQuote({ quoteId: "q", member: { applied: true, includedMinor: 2400000, discountMinor: 0, roomHoursUsed: 2, roomHoursLeftAfter: 2, guestPassesUsed: 0, freeAdmissions: 0 } });
    expect(block).not.toBeNull();
    expect(memberUseLine(block as NonNullable<typeof block>, (m) => `₦${m / 100}`)).toBe("Uses 2 hours of your 4 hours this month.");
    const none = parseMemberQuote({ member: { applied: false, reason: "nothing_included" } });
    expect(memberUseLine(none as NonNullable<typeof none>, String)).toBe("Your plan doesn't cover this booking, so it's the usual price.");
    expect(parseMemberQuote({ quoteId: "q" })).toBeNull();
  });
  it("what a plan gives, and the join path", () => {
    expect(planGiveLines({ entryIncluded: true, roomHours: 4, guestPasses: 2, discountBps: 1000, discountKinds: ["by_the_hour"], inclusions: ["A locker"], period: "month" })).toEqual([
      "Free entry, any day we're open",
      "4 hours of meeting rooms a month",
      "2 guest passes a month",
      "10% off rooms by the hour",
      "A locker",
    ]);
    expect(planJoinPath("harmattan-qa-local", "gamelandqa", "p1")).toBe("/b/harmattan-qa-local/v/gamelandqa/book/p1?k=plan");
  });
  it("the device remembers which membership it holds at a venue (only with its token)", () => {
    const id = "f52bddae-fd25-4a30-b1ec-f79e9b36a4dc";
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    (globalThis as unknown as { window: unknown }).window = { localStorage: fake };
    try {
      rememberVenueMember("b", "v", id);
      expect(readVenueMember("b", "v")).toBeNull();
      store.set(`mingla.visit.token.${id}`, "t".repeat(43));
      expect(readVenueMember("b", "v")).toEqual({ subscriptionId: id, token: "t".repeat(43) });
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
  it("refusals are plain words", () => {
    expect(memberGuestErrorCopy("membership_token_required")).toBe("Open your member page from the link in your membership email.");
    expect(memberGuestErrorCopy("plan_full")).toMatch(/full/);
    expect(memberGuestErrorCopy("whatever")).toBe("That didn't go through. Check your connection and try again.");
  });
});

describe("P6-3 the Plans tab on the venue page", () => {
  const page = parsePublicVenueFeatures({
    version: 1,
    features: ["entry", "memberships"],
    currencyCode: "NGN",
    minorUnitExponent: 2,
    vat: { mode: "added", ratePct: 7.5 },
    offers: [{ id: "o1", kind: "entry", name: "Day pass", fromMinor: 600000, entryStyle: "day_pass", sortOrder: 0 }],
    memberships: {
      fromMinor: 8500000,
      plans: [
        { id: "p1", name: "Hot desk", priceMinor: 8500000, inclusions: ["Every day"], roomHours: "4.00", guestPasses: 2, full: false },
        { id: "bad" },
      ],
    },
    spaces: [],
    hours: { weekly: [], specialDays: [] },
    events: { upcoming: [] },
  });
  it("parses plans (dropping broken rows) and the venue's VAT", () => {
    expect(page?.memberships?.plans?.map((p) => [p.name, p.roomHours])).toEqual([["Hot desk", 4]]);
    expect(page?.vat).toEqual({ mode: "added", ratePct: 7.5 });
    expect(parsePlan({ id: "x", name: "No price" })).toBeNull();
  });
  it("the Plans tab is shown and the ways row names the plans", () => {
    const model = deriveVenuePage(page, { menuTabVisible: false, tablesGate: "blocked" });
    expect(model.tabs).toContain("plans");
    expect(model.ways.find((w) => w.tab === "plans")).toMatchObject({ title: "Plans", line: "Hot desk", price: "from ₦85,000 a month" });
  });
});

describe("P6 the door: member passes", () => {
  it("reads the member id from a member pass and nothing else", () => {
    expect(memberIdFromCode("mingla:v1:vmember:f52bddae-fd25-4a30-b1ec-f79e9b36a4dc:sig:ab")).toBe("f52bddae-fd25-4a30-b1ec-f79e9b36a4dc");
    expect(memberIdFromCode("mingla:v1:vpass:f52bddae-fd25-4a30-b1ec-f79e9b36a4dc:sig:ab")).toBeNull();
  });
  it("a member check-in reads as one, warns when the month is due, and a lapsed pass says why", () => {
    const ok = checkInResultView(mapScanOutcome({ result: "admitted", admitted: 2, logId: "l", kind: "member", paymentDue: true, member: { subscriptionId: "s", memberName: "Amaka", status: "payment_due", plan: { name: "Hot desk" }, credits: { guestPassesLeft: 1 } } }));
    expect(ok.title).toBe("Member checked in");
    expect(ok.subject).toBe("Amaka · Hot desk · Member");
    expect(ok.body).toBe("The member and 1 guest in. This month isn't paid yet: remind them to pay from their member page.");
    expect(ok.tone).toBe("warning");
    expect(ok.secondary).toBe("undo");
    const lapsed = checkInResultView(mapScanOutcome({ result: "void", kind: "member", member: { memberName: "Seun", status: "lapsed", plan: { name: "Desk" } } }));
    expect(lapsed.title).toBe("Not paid this month");
    const again = checkInResultView(mapScanOutcome({ result: "already_used", kind: "member", member: { memberName: "Amaka", status: "active", plan: { name: "Hot desk" } } }));
    expect(again.title).toBe("Already in today");
  });
  it("guest pass refusals are words", () => {
    expect(doorErrorCopy("member_guest_passes_used_up", "1")).toBe("Only 1 guest pass is left in this billing period.");
    expect(doorErrorCopy("member_guests_day_full")).toMatch(/member can still go in/);
  });
});

describe("P5 follow-ups of this round", () => {
  it("overlapping tables are found (touching edges are fine; rotation counts)", () => {
    const places = {
      b1: { x: 100, y: 100, w: 80, h: 80, rotation: 0 },
      b2: { x: 150, y: 120, w: 80, h: 80, rotation: 0 },
      b3: { x: 180, y: 100, w: 80, h: 80, rotation: 0 },
      long: { x: 400, y: 400, w: 200, h: 40, rotation: 90 },
      near: { x: 480, y: 330, w: 40, h: 40, rotation: 0 },
    };
    expect(overlappingTables(places)).toEqual([
      ["b1", "b2"],
      ["b2", "b3"],
      ["long", "near"],
    ]);
    expect(overlappingTables({ a: places.b1, c: places.b3 })).toEqual([]);
  });
  it("a by-the-hour booking reads '2 hours · Boardroom', not '1 × Per hour'", () => {
    const lines = [
      { label: "1 × Per hour", value: "₦24,000" },
      { label: "VAT 7.5%", value: "₦1,800" },
      { label: "Total", value: "₦25,800", total: true },
    ];
    expect(hourSummaryLabel(lines, { minutes: 120, placeName: "Boardroom" }).map((l) => l.label)).toEqual(["2 hours · Boardroom", "VAT 7.5%", "Total"]);
    expect(hourSummaryLabel(lines, { minutes: 90, placeName: null })[0]?.label).toBe("1 h 30 min");
    expect(hourSummaryLabel(lines, null)).toBe(lines);
  });
  it("the hour editor's move rule saves as the offer's date-change rule", () => {
    const d = hourDraftFrom({ name: "Boardroom", summary: "", options: [], hour: null, policy: { refundLadder: [], dateChangeRule: { allowedUntilMinutesBefore: 120, feeBps: 0, maxChanges: 1 } } } as unknown as VenueOffer);
    expect(d.moveOn).toBe(true);
    expect(hourMoveRule(d)).toEqual({ allowedUntilMinutesBefore: 120, feeBps: 0, maxChanges: 1 });
    expect(hourMoveRule({ ...d, moveOn: false })).toBeNull();
    expect(hourDraftFrom(null).moveOn).toBe(false);
  });
});
