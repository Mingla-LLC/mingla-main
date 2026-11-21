/**
 * #4490 spec 07 G regressions: request plans and assigned desks share one
 * typed contract from public plan through Host actions and guest state.
 */
import { parsePlan } from "@mingla/brand-rendering/venueFeaturePage";

import { mapMemberDetail, mapMembershipPlan } from "../../../services/venueMembersService";
import {
  guestMemberState,
  membershipBenefitsAvailable,
  membershipJoinNeedsPayment,
  parseGuestMember,
} from "../offers/memberGuestModel";
import {
  memberCanEnd,
  memberCanAssignDesk,
  memberMatches,
  memberRequestState,
  memberStatusWords,
  planDraftFrom,
  planPayload,
} from "../features/members/membersModel";

describe("#4490 coworking request plans", () => {
  it("keeps request mode and the assignable desk ids through Host editing", () => {
    const plan = mapMembershipPlan({
      id: "plan-1",
      venueId: "venue-1",
      name: "Dedicated desk",
      priceMinor: 150_000,
      currencyCode: "NGN",
      interval: "month",
      joinMode: "request",
      deskSpaceIds: ["desk-12"],
      deskSpaces: [{ id: "desk-12", name: "Desk 12" }],
      status: "live",
    });
    expect(plan.joinMode).toBe("request");
    expect(plan.deskSpaces).toEqual([{ id: "desk-12", name: "Desk 12" }]);

    const draft = planDraftFrom(plan);
    expect(planPayload(draft, plan.id)).toMatchObject({
      planId: "plan-1",
      joinMode: "request",
      deskSpaceIds: ["desk-12"],
    });
  });

  it("exposes only the safe public desk fact and request CTA mode", () => {
    expect(parsePlan({
      id: "plan-1",
      name: "Dedicated desk",
      priceMinor: 150_000,
      interval: "month",
      joinMode: "request",
      assignedDeskAvailable: true,
    })).toMatchObject({
      period: "month",
      joinMode: "request",
      assignedDeskAvailable: true,
    });
  });

  it("renders a request as waiting for the venue without inventing a payment", () => {
    const member = parseGuestMember({
      subscriptionId: "sub-1",
      status: "requested",
      memberName: "Ada",
      plan: { id: "plan-1", name: "Dedicated desk", interval: "month", joinMode: "request" },
      venue: { id: "venue-1", name: "Kora Works", timezone: "Africa/Lagos" },
      requestReplyBy: "2026-11-23T12:00:00Z",
      credits: {},
    });
    expect(member).not.toBeNull();
    expect(guestMemberState(member!)).toMatchObject({
      label: "Requested",
      title: "Request sent",
    });
    expect(guestMemberState(member!).line).toContain("Kora Works will reply by");
    expect(membershipJoinNeedsPayment("request", "requested")).toBe(false);
    expect(membershipJoinNeedsPayment("instant", "requested")).toBe(false);
    expect(membershipJoinNeedsPayment("instant", "pending")).toBe(true);
    expect(membershipBenefitsAvailable("requested")).toBe(false);
    expect(membershipBenefitsAvailable("declined")).toBe(false);
    expect(membershipBenefitsAvailable("active")).toBe(true);
  });

  it("keeps assigned-desk facts on the Host member and filters requests", () => {
    const detail = mapMemberDetail({
      subscriptionId: "sub-1",
      status: "active",
      memberName: "Ada",
      plan: {
        id: "plan-1",
        name: "Dedicated desk",
        interval: "month",
        joinMode: "request",
        deskSpaces: [{ id: "desk-12", name: "Desk 12" }],
      },
      venue: { id: "venue-1", name: "Kora Works", timezone: "Africa/Lagos" },
      assignedSpace: { id: "desk-12", name: "Desk 12" },
      deskBookedFrom: "2027-02-01T12:00:00Z",
      credits: {},
    });
    expect(detail.assignedSpace?.name).toBe("Desk 12");
    expect(detail.deskBookedFrom).toBe("2027-02-01T12:00:00Z");
    expect(memberStatusWords("requested")).toMatchObject({ label: "Requested", variant: "info" });
    expect(memberRequestState("requested")).toBe(true);
    expect(memberRequestState("declined")).toBe(true);
    expect(memberCanEnd("requested", true, null)).toBe(false);
    expect(memberCanEnd("declined", true, null)).toBe(false);
    expect(memberCanEnd("pending", true, null)).toBe(true);
    expect(memberCanAssignDesk("pending")).toBe(false);
    expect(memberCanAssignDesk("lapsed")).toBe(false);
    expect(memberCanAssignDesk("active")).toBe(true);
    expect(memberMatches({
      subscriptionId: "sub-2",
      name: "Bola",
      email: null,
      phone: null,
      planId: "plan-1",
      planName: "Dedicated desk",
      planPeriod: "month",
      status: "requested",
      activeUntil: null,
      renewsOn: null,
      leavingOn: null,
      pausingOn: null,
      roomHoursLeft: 0,
      guestPassesLeft: 0,
      inToday: false,
      amountDueMinor: null,
      assignedSpaceName: null,
      version: 1,
      joinedAt: "2026-11-21T12:00:00Z",
    }, "requests")).toBe(true);
  });
});
