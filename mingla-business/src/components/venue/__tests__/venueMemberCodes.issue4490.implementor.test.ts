/**
 * #4490 M — display/input formatting and both member projections.
 * [TEST-MOD-APPROVED #4490] W3 fix 1: the source-text pins moved to the additive gate .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047).
 */
import { mapMemberDetail } from "../../../services/venueMembersService";
import { doorErrorCopy } from "../features/checkin/venueCheckInResult";
import { parseGuestMember } from "../offers/memberGuestModel";
import {
  formatVenueMemberCode,
  normalizeVenueMemberCode,
} from "../../../utils/venueMemberCode";

describe("member door codes", () => {
  it("normalises typed display spacing to six uppercase unambiguous characters", () => {
    expect(normalizeVenueMemberCode(" k7p-4qx ")).toBe("K7P4QX");
    expect(normalizeVenueMemberCode("K7PI0O4QX")).toBe("K7P4QX");
    expect(normalizeVenueMemberCode("23456789")).toBe("234567");
  });

  it("formats only a complete valid server code", () => {
    expect(formatVenueMemberCode("K7P4QX")).toBe("K7P 4QX");
    expect(formatVenueMemberCode("K7P4Q")).toBeNull();
    expect(formatVenueMemberCode("K7PI0O")).toBeNull();
  });

  it("maps the member code for the guest pass and Host panel", () => {
    const raw = {
      subscriptionId: "s1",
      status: "active",
      memberCode: "K7P4QX",
      memberName: "Ada",
      plan: { id: "p1", name: "Desk", interval: "month" },
      venue: { id: "v1", name: "Kora" },
    };
    expect(parseGuestMember(raw)?.memberCode).toBe("K7P4QX");
    expect(mapMemberDetail(raw).memberCode).toBe("K7P4QX");
  });

  it("uses the approved ten-minute lockout copy", () => {
    expect(doorErrorCopy("member_code_rate_limited")).toBe(
      "Too many wrong codes. Scan the pass or try again in 10 minutes.",
    );
  });

});
