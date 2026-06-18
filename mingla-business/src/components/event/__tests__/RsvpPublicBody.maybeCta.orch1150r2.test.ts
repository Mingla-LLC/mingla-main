/**
 * ORCH-1150 R2 — RsvpPublicBody source-structure regression (happy-path).
 *
 * Owner: mingla-implementor (the tester adds a SECOND adversarial angle).
 *
 * @testing-library/react-native is NOT a dependency of mingla-business (see the
 * repo-wide pre-existing TS2307s), so the CTA + layering invariants are enforced
 * as SOURCE-STRUCTURE assertions. Each assertion FAILS if the corresponding fix
 * line is deleted — proving fails-on-revert without a runtime renderer.
 *
 * ORCH-1157 [rsvp-public-redesign] UPDATE ([TEST-MOD-APPROVED ORCH-1157]):
 * Direction C moved the inline Going/Maybe/Can't CTA buttons OUT of
 * RsvpPublicBody and INTO the shared `RsvpMomentumDecision` unit (one shared
 * decision across buyer-web + business + consumer). The lucide `<Check/HelpCircle/
 * X size={19}>` inline buttons + the `ctaBtn` style no longer live here — the
 * shared unit owns them (covered by orch_1157_* tests). What RsvpPublicBody STILL
 * owns + MUST keep (these assertions enforce it): (a) the `submit` 3-status union
 * + the `void submit("maybe")` wiring, (b) the A4-NEW contact gate applied to BOTH
 * going and maybe, (c) the resolved-maybe response copy, (d) delegation to the
 * shared RsvpMomentumDecision threading the ORCH-1150 testIDs.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC_RAW = readFileSync(
  join(__dirname, "..", "RsvpPublicBody.tsx"),
  "utf8",
);
const SRC = SRC_RAW;
// Comment-stripped view for the no-checkout assertion (the doc comments
// legitimately NAME the forbidden affordances to explain WHY they are absent).
const SRC_NO_COMMENTS = SRC_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);

describe("ORCH-1157 — RsvpPublicBody delegates the Going/Maybe/Can't decision to the shared unit", () => {
  it("renders the shared RsvpMomentumDecision (the Direction-C decision hero)", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*RsvpMomentumDecision[\s\S]*\}\s*from\s*["']@mingla\/offering-rendering["']/,
    );
    expect(SRC).toMatch(/<RsvpMomentumDecision[\s\S]*?\/>/);
  });

  it("threads the ORCH-1150 going / maybe / not-going testIDs into the shared decision", () => {
    expect(SRC).toContain('goingTestID="orch-1150-rsvp-going"');
    expect(SRC).toContain('maybeTestID="orch-1150-rsvp-maybe"');
    expect(SRC).toContain('notGoingTestID="orch-1150-rsvp-not-going"');
  });

  it("submit() accepts the three-status union and routes 'maybe'", () => {
    expect(SRC).toMatch(
      /rsvpStatus:\s*["']going["']\s*\|\s*["']not_going["']\s*\|\s*["']maybe["']/,
    );
    expect(SRC).toContain('void submit("maybe")');
  });

  it("applies the A4-NEW contact gate to BOTH going and maybe (a Maybe must be reachable)", () => {
    expect(SRC).toMatch(
      /\(rsvpStatus === "going" \|\| rsvpStatus === "maybe"\) && !contactReady/,
    );
  });

  it("shows the keep-posted response copy for a resolved maybe", () => {
    expect(SRC).toContain("You're marked as Maybe");
    expect(SRC).toMatch(/we'll keep you posted/i);
  });

  it("never wires a checkout / price / cart affordance (RSVP is ticketless)", () => {
    // I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE (RsvpPublicBody half). Assert on
    // the comment-stripped source — the invariant is about RENDERED code, not the
    // doc comments that NAME the forbidden affordances to explain their absence.
    expect(SRC_NO_COMMENTS).not.toMatch(/\/checkout/);
    expect(SRC_NO_COMMENTS).not.toMatch(/ticket-checkout-create/);
    expect(SRC_NO_COMMENTS).not.toMatch(/Reserve|Get tickets/);
    expect(SRC_NO_COMMENTS).not.toMatch(/priceAllIn|TicketCartSheet/);
  });
});
