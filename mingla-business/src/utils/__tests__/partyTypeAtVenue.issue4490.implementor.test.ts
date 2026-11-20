/**
 * #4490 07-A — Party Type is optional for an event at a venue.
 *
 * Fails-on-revert: deleting the `opts.atVenue !== true` guard in
 * validateBasics makes the "at a venue" cases FAIL (party-type error returns).
 */
import { buildDraftEvent, type DraftEvent } from "../../store/draftEventStore";
import { validateBasics, validateStep } from "../draftEventValidation";
import { validateRsvpPublish, validateRsvpStep } from "../draftRsvpValidation";
import { resolveEventAtVenue } from "../eventVenueIntent";

const draft = (over: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent("brand_1", "d_test"),
  name: "Afrobeats Saturdays",
  description: "Our Saturday night.",
  partyTypes: [],
  format: "in_person",
  venueName: "Club Meridian",
  address: "1 Akin Adesola St",
  city: null,
  date: "2099-12-31",
  doorsOpen: "19:00",
  endsAt: "23:00",
  ...over,
});

const hasPartyError = (errs: { fieldKey: string }[]): boolean =>
  errs.some((e) => e.fieldKey === "partyTypes");

describe("#4490 07-A party type at a venue", () => {
  it("still requires a party type when not at a venue (default)", () => {
    expect(hasPartyError(validateBasics(draft()))).toBe(true);
    expect(hasPartyError(validateStep(0, draft()))).toBe(true);
    expect(hasPartyError(validateBasics(draft(), { atVenue: false }))).toBe(true);
  });

  it("does not require a party type at a venue (event and RSVP)", () => {
    expect(hasPartyError(validateBasics(draft(), { atVenue: true }))).toBe(false);
    expect(hasPartyError(validateStep(0, draft(), { atVenue: true }))).toBe(false);
    expect(hasPartyError(validateRsvpStep(0, draft({ isRsvp: true }), { atVenue: true }))).toBe(false);
    expect(hasPartyError(validateRsvpPublish(draft({ isRsvp: true }), { atVenue: true }))).toBe(false);
  });

  it("a stale or unknown party type is still refused at a venue", () => {
    expect(hasPartyError(validateBasics(draft({ partyTypes: ["not-a-type"] }), { atVenue: true }))).toBe(true);
  });

  it("at-venue rule: a saved link or a venue intent", () => {
    expect(resolveEventAtVenue("venue-1", false)).toBe(true);
    expect(resolveEventAtVenue(null, false)).toBe(false);
    expect(resolveEventAtVenue(undefined, false)).toBe(false);
    expect(resolveEventAtVenue(undefined, true)).toBe(true);
    expect(resolveEventAtVenue(null, true)).toBe(true);
  });
});
