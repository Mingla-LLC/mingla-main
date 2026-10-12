/**
 * #3645 — an event publish (or unpublish) refusal must keep its reason.
 *
 * `supabase.rpc()` fails with a PLAIN OBJECT `{ message, code, details, hint }`,
 * not an `Error`. `publishBusinessEventDraft` used to `throw error` verbatim and
 * the wizard read it as `error instanceof Error ? error.message : String(error)`
 * — the literal "[object Object]" — so none of the mapped guards
 * (stripe_charges_disabled, event_currency_required, offering_date_past,
 * city_required) could ever fire, and every refusal showed generic copy. The
 * unpublish path hid `event_unpublish_has_commitments` the same way.
 *
 * FAILS ON REVERT:
 *  - restore `if (error !== null) throw error;` in publishBusinessEventDraft
 *    → the "legacy reader" tests see "[object Object]" and no guard copy;
 *  - restore it in callEventDraftLifecycleRpc → the unpublish test fails;
 *  - restore the wizard's `String(error)` reader → the wizard source pin fails.
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
import { resolveProviderNeutralPaidPublishGuardCopy } from "../../utils/paidPublishGuards";

/** The bare object PostgREST hands back for a `RAISE EXCEPTION '<code>'`. */
const postgrestRefusal = (message: string): Record<string, unknown> => ({
  message,
  code: "P0001",
  details: null,
  hint: null,
});

/**
 * The reader every pre-#3645 consumer used (EventCreatorWizard publish, the
 * event dashboard and Hub unpublish handlers). The service must hand it a real
 * Error so this still-shipped shape reads the true code.
 */
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

      expect(thrown).toBeInstanceOf(Error);
      expect(legacyReader(thrown)).toBe(code);
      expect(legacyReader(thrown)).not.toContain("[object Object]");
      const guardCopy = resolveProviderNeutralPaidPublishGuardCopy(
        legacyReader(thrown),
      );
      expect(guardCopy).not.toBeNull();
      expect(guardCopy?.action).toBe(action);
    },
  );

  test("the wizard's reader maps a bare PostgREST object without the service's help", () => {
    const bare = postgrestRefusal("stripe_charges_disabled");
    // What the wizard did before: no guard can match this.
    expect(resolveProviderNeutralPaidPublishGuardCopy(legacyReader(bare))).toBeNull();
    // What it does now.
    expect(
      resolveProviderNeutralPaidPublishGuardCopy(readRpcFailureMessage(bare))?.action,
    ).toBe("payment_onboarding");
    expect(
      resolveProviderNeutralPaidPublishGuardCopy(
        readRpcFailureMessage(postgrestRefusal("city_required")),
      )?.action,
    ).toBe("edit_where");
  });

  test("EventCreatorWizard's publish catch reads the failure with readRpcFailureMessage", () => {
    const wizard = readFileSync(
      path.join(__dirname, "..", "..", "components", "event", "EventCreatorWizard.tsx"),
      "utf8",
    );
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

  test("an unpublish refused for buyer activity reaches the 'cancel it instead' branch", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: postgrestRefusal("event_unpublish_has_commitments"),
    });

    const thrown = await captureRejection(() =>
      unpublishBusinessEventToDraft("00000000-0000-4000-8000-000000000001"),
    );

    expect(thrown).toBeInstanceOf(Error);
    // The exact check both unpublish callers make.
    const code = thrown instanceof Error ? thrown.message : "unpublish_failed";
    expect(code.includes("event_unpublish_has_commitments")).toBe(true);
  });

  test("a refusal with no readable message still rejects with a real Error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "PGRST301" } });

    const thrown = await captureRejection(() =>
      publishBusinessEventDraft(baseDraft()),
    );

    expect(thrown).toBeInstanceOf(Error);
    expect(legacyReader(thrown)).toBe("publish_failed");
  });
});
