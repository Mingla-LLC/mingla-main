/**
 * ORCH-1150 R2 D-10 — resolveRsvpCta 'maybe' state regression (happy-path).
 *
 * Owner: mingla-implementor (the tester adds a SECOND adversarial angle).
 *
 * offeringCta imports ONLY types (no RN runtime), so it resolves under ts-jest.
 * Fails-on-revert: deleting the `if (guestStatus === "maybe") return …` branch
 * in resolveRsvpCta makes the first assertion fall through to "open" → FAIL.
 */

import { resolveRsvpCta } from "../../../../../packages/offering-rendering/offeringCta";

describe("ORCH-1150 R2 — resolveRsvpCta maybe", () => {
  it("reflects a guest's own resolved 'maybe' state", () => {
    expect(
      resolveRsvpCta({
        capacityFull: false,
        waitlistEnabled: false,
        manualApproval: false,
        guestStatus: "maybe",
        guestApproval: "approved",
      }).state,
    ).toBe("maybe");
  });

  it("maybe wins even when the event capacity is full (non-binding, cap-neutral)", () => {
    expect(
      resolveRsvpCta({
        capacityFull: true,
        waitlistEnabled: true,
        manualApproval: false,
        guestStatus: "maybe",
        guestApproval: "approved",
      }).state,
    ).toBe("maybe");
  });

  it("pending still outranks a maybe-typed row (approval precedence preserved)", () => {
    expect(
      resolveRsvpCta({
        capacityFull: false,
        waitlistEnabled: false,
        manualApproval: true,
        guestStatus: "maybe",
        guestApproval: "pending",
      }).state,
    ).toBe("pending");
  });
});
