/**
 * ORCH-1150 — implementor happy-path regression test for the RSVP validator.
 *
 * Proves: (a) party-type is STILL required for RSVP Basics (steering #2 — not
 * silently dropped); (b) the RSVP-setup step has NO ≥1 requirement (steering #3
 * — unlike validateTickets); (c) freeform location is accepted (no city gate).
 *
 * Fails-on-revert: removing the `validateBasics(draft)` call from case 0 (so
 * the party-type gate is dropped) makes the first test FAIL.
 */

import { buildDraftEvent, type DraftEvent } from "../../store/draftEventStore";
import { validateRsvpStep, validateRsvpPublish } from "../draftRsvpValidation";

const baseRsvp = (over: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent("brand_1", "d_test"),
  isRsvp: true,
  name: "House party",
  description: "Come through, it's gonna be a vibe.",
  partyTypes: ["house-party"],
  format: "in_person",
  venueName: "My place",
  address: "123 Real St",
  city: null, // freeform — NO structured city; must NOT block
  date: "2099-12-31",
  doorsOpen: "19:00",
  endsAt: "23:00",
  ...over,
});

describe("ORCH-1150 — RSVP validator", () => {
  it("KEEPS the party-type gate on Basics (steering #2)", () => {
    const noParty = baseRsvp({ partyTypes: [] });
    const errs = validateRsvpStep(0, noParty);
    expect(errs.some((e) => e.fieldKey === "partyTypes")).toBe(true);
  });

  it("accepts Basics with a party type", () => {
    expect(validateRsvpStep(0, baseRsvp())).toHaveLength(0);
  });

  it("RSVP-setup step has NO required fields (steering #3)", () => {
    expect(validateRsvpStep(4, baseRsvp())).toHaveLength(0);
  });

  it("accepts a freeform location (no structured-city gate)", () => {
    expect(validateRsvpStep(2, baseRsvp({ city: null }))).toHaveLength(0);
  });

  it("a complete RSVP draft publishes clean (no ticket/stripe gate)", () => {
    expect(validateRsvpPublish(baseRsvp())).toHaveLength(0);
  });

  it("blocks a past date in When", () => {
    const past = baseRsvp({ date: "2000-01-01" });
    expect(validateRsvpStep(1, past).some((e) => e.fieldKey === "date")).toBe(true);
  });
});
