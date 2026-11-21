/** #4490 spec 07 K: yearly plans keep one period contract across Host and guest models. */
import { parsePlan } from "@mingla/brand-rendering/venueFeaturePage";
import { mapMembersList, mapMembershipPlan } from "../../../services/venueMembersService";
import { mapScanOutcome } from "../../../services/venueOffersService";
import {
  memberDay,
  planDraftFrom,
  planIncludesLines,
  planErrorCopy,
  memberErrorCopy,
  memberRowLine,
  planIssues,
  planPayload,
  planPeriodDraft,
  planTermsLine,
  timelineWords,
} from "../features/members/membersModel";
import { guestMemberState, howYouPayLines, memberGuestErrorCopy, memberPeriodRangeWords, memberUseLine, parseGuestMember, parseMemberQuote, planGiveLines } from "../offers/memberGuestModel";
import { checkInResultView, doorErrorCopy } from "../features/checkin/venueCheckInResult";

describe("#4490 yearly membership plans", () => {
  it("switches to the yearly authoring defaults and sends an immutable one-year term", () => {
    const yearly = planPeriodDraft(planDraftFrom(null), "year");
    expect(yearly).toMatchObject({ period: "year", minMonths: 12, renewalNoticeDays: 30 });
    expect(planPayload({ ...yearly, name: "Studio year", priceMinor: 2_000_000 }, null)).toMatchObject({
      period: "year",
      minMonths: 12,
      renewalNoticeDays: 30,
    });
    expect(planTermsLine(yearly)).toBe("1-year minimum · 7 days' grace");
  });

  it("uses the approved yearly price-cap wording and yearly allowance labels", () => {
    const yearly = { ...planPeriodDraft(planDraftFrom(null), "year"), name: "Studio year", priceMinor: 2_147_483_648 };
    expect(planIssues(yearly, "NGN").price).toBe("A yearly price can't be above ₦21,474,836.47");
    expect(planIncludesLines({ ...yearly, roomHours: 8784, guestPasses: 1200, entryIncluded: true })).toEqual([
      "Free entry",
      "8784 hours of rooms a year",
      "1200 guest passes a year",
    ]);
    expect(planGiveLines({ entryIncluded: true, roomHours: 24, guestPasses: 12, discountBps: 0, discountKinds: [], inclusions: [], period: "year" })).toEqual([
      "Free entry, any day we're open",
      "24 hours of meeting rooms a year",
      "12 guest passes a year",
    ]);
  });

  it("maps the server's Yearly and locked facts so the editor cannot rewrite an accepted interval", () => {
    expect(mapMembershipPlan({ id: "p", name: "Studio year", interval: "year", periodLocked: true })).toMatchObject({
      period: "year",
      periodLocked: true,
    });
    expect(parsePlan({ id: "p", name: "Studio year", priceMinor: 2_000_000, interval: "year" })).toMatchObject({ period: "year" });
    expect(planErrorCopy("plan_period_locked")).toBe("You can't change how a plan is billed once people have joined.");
  });

  it("explains a yearly payment without monthly copy", () => {
    const lines = howYouPayLines({ period: "year", firstPeriod: "your first year", renewalNoticeDays: 30, graceDays: 7, minMonths: 12, noticeDays: 0 });
    expect(lines.map((line) => line.title)).toEqual(["Today", "Each year after", "Skip a year"]);
    expect(lines[1]?.body).toBe("We email you a link 30 days before. Pay it and the year is yours. Nothing renews by itself.");
    expect(memberPeriodRangeWords("2026-11-21", "2027-11-21", "Africa/Lagos", { weekday: false, separator: " – " })).toBe(
      "21 Nov 2026 – 21 Nov 2027",
    );

    const member = parseGuestMember({
      subscriptionId: "s",
      status: "pending",
      memberName: "Ada",
      plan: { id: "p", name: "Studio year", interval: "year" },
      venue: { id: "v", name: "Kora", timezone: "Africa/Lagos" },
      credits: {},
    });
    expect(member).not.toBeNull();
    expect(guestMemberState(member!).title).toBe("Pay your first year to start");
    expect(guestMemberState(member!).line).toBe("Your membership starts as soon as the first year is paid.");

    const active = parseGuestMember({
      subscriptionId: "active-year",
      status: "active",
      memberName: "Ada",
      plan: { id: "p", name: "Studio year", interval: "year" },
      venue: { id: "v", name: "Kora", timezone: "Africa/Lagos" },
      activeUntil: "2027-11-21",
      credits: {},
    });
    expect(active).not.toBeNull();
    expect(guestMemberState(active!).line).toBe("Paid until Sun 21 Nov 2027.");

    const quote = parseMemberQuote({ member: { applied: true, period: "year", roomHoursUsed: 2, roomHoursLeftAfter: 10 } });
    expect(quote).not.toBeNull();
    expect(memberUseLine(quote!, String)).toBe("Uses 2 hours of your 12 hours this year.");
    expect(memberGuestErrorCopy("member_credits_used_up", "year")).toBe("Your included hours for this year were used meanwhile. Check the price again.");
    expect(memberGuestErrorCopy("membership_already_leaving", "year")).toBe("You're already leaving at the end of your paid year.");
    expect(memberErrorCopy("member_guest_passes_used_up", "1", "year")).toBe("Only 1 guest pass is left this year.");
  });

  it("keeps yearly host-list, timeline and door copy on the yearly noun", () => {
    const yearlyRow = mapMembersList({
      venueId: "v",
      localDate: "2026-11-21",
      tiles: { paymentDue: {} },
      members: [{ subscriptionId: "s", planId: "p", planName: "Studio year", planPeriod: "year", status: "pending" }],
    }).members[0]!;
    expect(memberRowLine(yearlyRow, "Africa/Lagos")).toBe("First year not paid yet");
    const renewingYearlyRow = mapMembersList({
      venueId: "v",
      localDate: "2026-11-21",
      tiles: { paymentDue: {} },
      members: [{ subscriptionId: "s2", planId: "p", planName: "Studio year", planPeriod: "year", status: "active", renewsOn: "2027-11-21" }],
    }).members[0]!;
    expect(memberRowLine(renewingYearlyRow, "Africa/Lagos")).toBe("Renews Sun 21 Nov 2027");
    expect(memberDay("2027-11-21", "Africa/Lagos", true)).toBe("Sun 21 Nov 2027");
    expect(timelineWords({ type: "member_join_closed", by: "system", at: "", periodId: null, detail: null }, "year")).toBe("Join closed: first year never paid");

    const outcome = mapScanOutcome({
      result: "admitted",
      kind: "member",
      paymentDue: true,
      member: { memberName: "Ada", status: "payment_due", plan: { name: "Studio year", interval: "year" } },
    });
    expect(outcome.member?.planPeriod).toBe("year");
    expect(checkInResultView(outcome).body).toContain("This year isn't paid yet");
    expect(doorErrorCopy("member_guest_passes_used_up", "1")).toBe("Only 1 guest pass is left in this billing period.");
  });
});
