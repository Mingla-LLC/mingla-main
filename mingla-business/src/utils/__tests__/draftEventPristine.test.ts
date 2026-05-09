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
  category: null,
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
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
