/**
 * #3645 — an event publish (or unpublish) refusal must keep its reason.
 *
 * `supabase.rpc()` fails with a PLAIN OBJECT `{ message, code, details, hint }`
 * and businessEvents rejects with that object verbatim (pinned by
 * where_step_pin_survives_autosave_echo.test.ts, so the service shape stays).
 * The READERS were the bug: `error instanceof Error ? error.message :
 * String(error)` yields the literal "[object Object]", so none of the mapped
 * publish guards (stripe_charges_disabled, event_currency_required,
 * offering_date_past, city_required) could fire, and the unpublish callers
 * could never see `event_unpublish_has_commitments`.
 *
 * Every test drives the REAL service with a mocked rpc, then feeds the real
 * rejection to the reader the screen uses.
 *
 * FAILS ON REVERT:
 *  - restore the wizard's `String(error)` reader → the wizard source pin fails;
 *  - restore the inline `instanceof Error` reader in either unpublish caller →
 *    that caller's source pin fails;
 *  - make eventUnpublishFailureCopy read `instanceof Error` only → the
 *    behavioural unpublish test fails.
 *
 *   cd mingla-business && npx jest \
 *     src/services/__tests__/issue_3645_publish_refusal_reason.happy.test.ts --runInBand
 */

/* eslint-disable import/first */

import { readFileSync } from "fs";
import path from "path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import {
  publishBusinessEventDraft,
  unpublishBusinessEventToDraft,
} from "../businessEvents";
import { readRpcFailureMessage } from "../rsvpRpcFailure";
import type { DraftEvent } from "../../store/draftEventStore";
import {
  EVENT_UNPUBLISH_FAILED_COPY,
  EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY,
  eventUnpublishFailureCopy,
} from "../../utils/eventUnpublishFailureCopy";
import { resolveProviderNeutralPaidPublishGuardCopy } from "../../utils/paidPublishGuards";

/** The bare object PostgREST hands back for a `RAISE EXCEPTION '<code>'`. */
const postgrestRefusal = (message: string): Record<string, unknown> => ({
  message,
  code: "P0001",
  details: null,
  hint: null,
});

/** The reader every pre-#3645 consumer used. */
const legacyReader = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? "");

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  serverSlug: "draft-nlhj",
  name: "Visa",
  description: "Free launch event.",
  format: "in_person",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "single",
  date: "2026-06-01",
  doorsOpen: "18:00",
  endsAt: "22:00",
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Main Hall",
  address: "1 High Street",
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  tickets: [
    {
      id: "ticket-local",
      name: "The free",
      priceGbp: null,
      capacity: null,
      isFree: true,
      isUnlimited: true,
      visibility: "public",
      displayOrder: 0,
      approvalRequired: false,
      passwordProtected: false,
      password: null,
      waitlistEnabled: false,
      minPurchaseQty: 1,
      maxPurchaseQty: null,
      allowTransfers: true,
      description: null,
      saleStartAt: null,
      saleEndAt: null,
      availableAt: "online",
    },
  ],
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
  lastStepReached: 6,
  status: "draft",
  clientRevision: 7,
  createdAt: "2026-05-08T18:00:00.000Z",
  updatedAt: "2026-05-08T18:00:00.000Z",
  ...patch,
});

const captureRejection = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
};

const source = (...segments: string[]): string =>
  readFileSync(path.join(__dirname, "..", "..", "..", ...segments), "utf8");

describe("#3645 — event publish refusals keep their reason", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test.each([
    ["stripe_charges_disabled", "payment_onboarding"],
    ["event_currency_required", "payment_onboarding"],
    ["offering_date_past", "edit_date"],
    ["city_required", "edit_where"],
  ])(
    "a plain-object %s refusal reaches its mapped guard (%s)",
    async (code, action) => {
      rpcMock.mockResolvedValueOnce({ data: null, error: postgrestRefusal(code) });

      const thrown = await captureRejection(() =>
        publishBusinessEventDraft(baseDraft()),
      );

      // The old reader: no guard can match what the service really rejects with.
      expect(legacyReader(thrown)).toBe("[object Object]");
      expect(resolveProviderNeutralPaidPublishGuardCopy(legacyReader(thrown))).toBeNull();
      // The reader the wizard uses now.
      expect(readRpcFailureMessage(thrown)).toBe(code);
      expect(
        resolveProviderNeutralPaidPublishGuardCopy(readRpcFailureMessage(thrown))?.action,
      ).toBe(action);
    },
  );

  test("EventCreatorWizard's publish catch reads the failure with readRpcFailureMessage", () => {
    const wizard = source("src", "components", "event", "EventCreatorWizard.tsx");
    const start = wizard.indexOf("const slug = await onPublishDraft(");
    expect(start).toBeGreaterThanOrEqual(0);
    const guardCall = wizard.indexOf(
      "resolveProviderNeutralPaidPublishGuardCopy(code)",
      start,
    );
    expect(guardCall).toBeGreaterThan(start);
    const region = wizard.slice(start, guardCall);
    expect(region).toContain("const code = readRpcFailureMessage(error);");
    expect(region).not.toMatch(/const code = error instanceof Error/);
  });

  test("an unpublish refused for buyer activity produces the 'cancel it instead' copy", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: postgrestRefusal("event_unpublish_has_commitments"),
    });

    const thrown = await captureRejection(() =>
      unpublishBusinessEventToDraft("00000000-0000-4000-8000-000000000001"),
    );

    // What both callers did before: the branch was unreachable.
    const legacyCode = thrown instanceof Error ? thrown.message : "unpublish_failed";
    expect(legacyCode.includes("event_unpublish_has_commitments")).toBe(false);

    expect(eventUnpublishFailureCopy(thrown)).toBe(EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY);
    expect(EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY).toContain("Cancel it instead");
  });

  test("any other unpublish failure keeps the retry copy, for both error shapes", () => {
    expect(eventUnpublishFailureCopy(postgrestRefusal("connection reset"))).toBe(
      EVENT_UNPUBLISH_FAILED_COPY,
    );
    expect(eventUnpublishFailureCopy(new Error("network"))).toBe(
      EVENT_UNPUBLISH_FAILED_COPY,
    );
    expect(
      eventUnpublishFailureCopy(new Error("event_unpublish_has_commitments")),
    ).toBe(EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY);
    expect(eventUnpublishFailureCopy(undefined)).toBe(EVENT_UNPUBLISH_FAILED_COPY);
  });

  test.each([
    ["app", "event", "[id]", "index.tsx"],
    ["app", "(tabs)", "hub", "events.tsx"],
  ])("the unpublish caller %s/%s/%s/%s uses the shared reader", (...segments) => {
    const file = source(...segments);
    const call = file.indexOf("await unpublishBusinessEventToDraft(");
    expect(call).toBeGreaterThanOrEqual(0);
    const region = file.slice(call, call + 700);
    expect(region).toContain("eventUnpublishFailureCopy(error)");
    expect(region).not.toMatch(/error instanceof Error \? error\.message/);
  });
});
