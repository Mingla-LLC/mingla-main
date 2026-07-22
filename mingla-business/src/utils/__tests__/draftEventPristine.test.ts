import { describe, expect, test } from "@jest/globals";

import type { DraftEvent } from "../../store/draftEventStore";
import { isDraftEventPristine } from "../draftEventPristine";

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "draft-1",
  brandId: "brand-1",
  serverSlug: null,
  name: "",
  description: "",
  format: "in_person",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
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
  lastStepReached: 0,
  status: "draft",
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
  ...patch,
});

describe("draft pristine guard", () => {
  test("treats a brand-new empty draft as pristine", () => {
    expect(isDraftEventPristine(draft())).toBe(true);
  });

  test("treats uploaded cover media as a non-pristine edit", () => {
    expect(
      isDraftEventPristine(
        draft({
          coverMediaUrl: "https://cdn.example.com/cover.gif",
          coverMediaType: "gif",
        }),
      ),
    ).toBe(false);
  });
});
