/**
 * Issue #3065 [RSVP draft autosave wedged in production] — service regression.
 *
 * Root cause: the two draft-autosave RPCs disagreed about what `clientRevision`
 * MEANS. `business_update_event_draft` required the NEW revision
 * (`p_client_revision <> stored + 1` -> reject); `business_update_rsvp_graph`
 * required the revision the SERVER already held
 * (`__expectedClientRevision <> current` -> reject). The client only has one
 * convention — `RsvpCreatorWizard.handleUpdate` bumps its counter BEFORE
 * queueing the save — so the RSVP RPC rejected every single call. Proven on
 * production 2026-09-02: `rsvp_domain_operation_receipts` held ZERO rows with
 * operation='update' for all time, and one wedged device put 3,400-4,900
 * `rsvp_revision_conflict` per minute into the database.
 *
 * What made it permanent was not the off-by-one but the absence of any
 * recovery: nothing resynced the client's counter from the server, the counter
 * is persisted in Zustand, and the wizard's `clientRevisionRef` is monotonic —
 * so the losing revision was resent forever, across app restarts.
 *
 * This file owns the CLIENT half of the fix. Migration 20270617003065 owns the
 * server half and `supabase/migrations/__tests__/
 * issue_3065_draft_revision_contract.test.sql` pins that both functions share
 * one rule.
 *
 * Fails-on-revert:
 *   - Drop `toRevisionConflictError` from the RSVP branch -> T-3065-01 gets the
 *     raw PostgREST object instead of DraftRevisionConflictError.
 *   - Drop it from the event branch -> T-3065-02 fails the same way.
 *   - Stop refetching the server draft -> T-3065-03's serverDraft is null and
 *     the caller has nothing to resync from, which is the wedge itself.
 *   - Widen the matcher to swallow unrelated errors -> T-3065-04 fails.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();
const mockRpc = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock("../../store/draftEventStore", () => ({
  buildDraftEvent: jest.fn(),
}));

import {
  autosaveServerDraft,
  isDraftRevisionConflictError,
  type DraftRevisionConflictError,
} from "../eventDrafts";
import type { DraftEvent } from "../../store/draftEventStore";

const DRAFT_ID = "00000000-0000-4000-8000-0000000000aa";
const BRAND_ID = "00000000-0000-4000-8000-000000000002";

// The server row `fetchDraftById` reads back on a conflict. Revision 98 is the
// value production actually held while the wedged client kept resending 41.
const SERVER_ROW = {
  id: DRAFT_ID,
  brand_id: BRAND_ID,
  created_by: "user-1",
  title: "Issue 3065 draft",
  description: "",
  slug: "issue-3065-draft",
  currency: "USD",
  theme: { business_draft: { clientRevision: 98 } },
  visibility: "draft",
  status: "draft",
  timezone: "Europe/London",
  created_at: "2026-09-02T10:00:00.000Z",
  updated_at: "2026-09-02T10:00:00.000Z",
  published_at: null,
  deleted_at: null,
  event_type: "rsvp",
};

// Chainable query-builder mock. Every draft read in this service terminates on
// .maybeSingle(); the caller decides which row that resolves to.
const makeBuilder = (result: { data: unknown; error: Error | null }) => {
  const builder: Record<string, unknown> = {};
  const ret = (): Record<string, unknown> => builder;
  builder.select = jest.fn(ret);
  builder.eq = jest.fn(ret);
  builder.in = jest.fn(ret);
  builder.is = jest.fn(ret);
  builder.order = jest.fn(ret);
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.single = jest.fn(() => Promise.resolve(result));
  return builder;
};

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: DRAFT_ID,
    brandId: BRAND_ID,
    serverSlug: null,
    name: "Issue 3065 draft",
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
    locationGeo: null,
    city: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: "USD",
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
    clientRevision: 41,
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    isRsvp: false,
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: true,
    ...patch,
  }) as unknown as DraftEvent;

// PostgREST hands plpgsql RAISEs back as PLAIN OBJECTS, not Error instances —
// matching on `instanceof` would silently never fire.
const postgrestError = (message: string): Record<string, unknown> => ({
  message,
  details: null,
  hint: null,
  code: message === "rsvp_revision_conflict" ? "40001" : "P0001",
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  mockFrom.mockImplementation(() =>
    makeBuilder({ data: SERVER_ROW, error: null }),
  );
});

describe("issue #3065 — a draft revision conflict reconciles instead of wedging", () => {
  test("T-3065-01 the RSVP RPC's rsvp_revision_conflict surfaces as a typed conflict", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: postgrestError("rsvp_revision_conflict"),
    });

    const thrown = await autosaveServerDraft(
      baseDraft({ isRsvp: true }),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).not.toBeNull();
    expect(isDraftRevisionConflictError(thrown)).toBe(true);
    expect((thrown as DraftRevisionConflictError).draftId).toBe(DRAFT_ID);
  });

  test("T-3065-02 the event RPC's stale_client_revision surfaces the same way", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: postgrestError("stale_client_revision"),
    });

    const thrown = await autosaveServerDraft(
      baseDraft({ isRsvp: false }),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDraftRevisionConflictError(thrown)).toBe(true);
  });

  test("T-3065-03 the conflict carries the SERVER draft so the caller can resync", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: postgrestError("rsvp_revision_conflict"),
    });

    const thrown = (await autosaveServerDraft(
      baseDraft({ isRsvp: true, clientRevision: 41 }),
    ).then(
      () => null,
      (error: unknown) => error,
    )) as DraftRevisionConflictError | null;

    // Without this the wizard's monotonic clientRevisionRef can never learn the
    // server's number, and it resends 41 forever — the production wedge.
    expect(thrown?.serverDraft).not.toBeNull();
    expect(thrown?.serverDraft?.clientRevision).toBe(98);
  });

  test("T-3065-04 an unrelated RPC error is NOT swallowed as a conflict", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: postgrestError("rsvp_not_found_or_forbidden"),
    });

    const thrown = await autosaveServerDraft(
      baseDraft({ isRsvp: true }),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDraftRevisionConflictError(thrown)).toBe(false);
    expect((thrown as { message?: string }).message).toBe(
      "rsvp_not_found_or_forbidden",
    );
  });
});
