/**
 * ORCH-1150 — resolveRsvpCta (Going / Not-going CTA machine) regression tests.
 *
 * Owner: mingla-implementor (the tester adds a SECOND adversarial angle).
 *
 * Imports the pure module directly from the package source by relative path —
 * offeringCta imports ONLY types (no RN runtime), so it resolves under ts-jest.
 */

import { resolveRsvpCta } from "../../../../../packages/offering-rendering/offeringCta";

describe("ORCH-1150 — resolveRsvpCta", () => {
  it("open when not full and guest has no row", () => {
    expect(
      resolveRsvpCta({ capacityFull: false, waitlistEnabled: false, manualApproval: false }).state,
    ).toBe("open");
  });

  it("full when cap hit, waitlist off, auto mode", () => {
    expect(
      resolveRsvpCta({ capacityFull: true, waitlistEnabled: false, manualApproval: false }).state,
    ).toBe("full");
  });

  it("waitlist when cap hit and waitlist on", () => {
    expect(
      resolveRsvpCta({ capacityFull: true, waitlistEnabled: true, manualApproval: false }).state,
    ).toBe("waitlist");
  });

  it("open (not 'full') when cap hit but manual mode (pending doesn't occupy the cap)", () => {
    expect(
      resolveRsvpCta({ capacityFull: true, waitlistEnabled: false, manualApproval: true }).state,
    ).toBe("open");
  });

  it("pending takes precedence over capacity for a guest awaiting approval", () => {
    expect(
      resolveRsvpCta({
        capacityFull: true,
        waitlistEnabled: false,
        manualApproval: true,
        guestStatus: "going",
        guestApproval: "pending",
      }).state,
    ).toBe("pending");
  });

  it("reflects a guest's confirmed going state", () => {
    expect(
      resolveRsvpCta({
        capacityFull: false,
        waitlistEnabled: false,
        manualApproval: false,
        guestStatus: "going",
        guestApproval: "approved",
      }).state,
    ).toBe("going");
  });

  it("reflects a guest's own waitlisted state", () => {
    expect(
      resolveRsvpCta({
        capacityFull: true,
        waitlistEnabled: true,
        manualApproval: false,
        guestStatus: "waitlisted",
        guestApproval: "approved",
      }).state,
    ).toBe("waitlist");
  });
});
