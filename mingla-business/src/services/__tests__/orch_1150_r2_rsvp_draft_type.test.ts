/**
 * ORCH-1150-R2 (D-2) [RSVP video cover persists] — service regression test.
 *
 * D-2 root cause: `createServerDraft` hardcoded event_type:'event' on the
 * lazily-promoted server row, so an RSVP draft's server `events` row was
 * 'event' for its whole draft lifetime — the cover-video pipeline (keyed on the
 * draft id → its events row) bound to an 'event' row and the processed URL never
 * persisted. Fix: #1977 routes RSVP promotion through
 * business_create_rsvp_draft_graph, which types the row as rsvp at creation.
 *
 * [TEST-MOD-APPROVED #1977] Repin RSVP createServerDraft to the graph RPC after
 * #1977 replaced the client insert path.
 *
 * Paired fetch-widening: the draft reads/updates previously filtered
 * .eq("event_type","event"); now they .in("event_type", ["event","rsvp"]) so an
 * rsvp-typed draft still lists/loads/autosaves (without this, the now-'rsvp'
 * draft vanishes from the Hub and can't be resumed).
 *
 * Fails-on-revert:
 *   - Reverting the insert type pin → the RSVP insert payload's event_type
 *     becomes 'event' → the first assertion fails.
 *   - Reverting the fetch widening → the captured .in() filter is gone (the
 *     query uses .eq("event_type","event")) → the widening assertions fail.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Avoid pulling the real zustand store / RN deps into the node test.
jest.mock("../../store/draftEventStore", () => ({
  buildDraftEvent: jest.fn(),
}));

import {
  createServerDraft,
  fetchDraftsForBrand,
  fetchDraftById,
} from "../eventDrafts";
import type { DraftEvent } from "../../store/draftEventStore";

interface InFilter {
  column: string;
  values: readonly unknown[];
}

// A chainable supabase query-builder mock that records `.in(col, values)` and
// `.insert(payload)`, then resolves at the requested terminal.
const makeBuilder = (
  terminal:
    | { method: "single"; result: { data: unknown; error: Error | null } }
    | { method: "maybeSingle"; result: { data: unknown; error: Error | null } }
    | { method: "thenable"; result: { data: unknown; error: Error | null } },
  capture: { inFilters: InFilter[]; insertPayloads: unknown[] },
) => {
  const builder: Record<string, unknown> = {};
  const ret = () => builder;
  builder.eq = jest.fn(ret);
  builder.is = jest.fn(ret);
  builder.order = jest.fn(() =>
    terminal.method === "thenable"
      ? Promise.resolve(terminal.result)
      : builder,
  );
  builder.in = jest.fn((column: string, values: readonly unknown[]) => {
    capture.inFilters.push({ column, values });
    return builder;
  });
  builder.insert = jest.fn((payload: unknown) => {
    capture.insertPayloads.push(payload);
    return builder;
  });
  builder.select = jest.fn(ret);
  builder.single = jest.fn(() =>
    terminal.method === "single" ? Promise.resolve(terminal.result) : builder,
  );
  builder.maybeSingle = jest.fn(() =>
    terminal.method === "maybeSingle"
      ? Promise.resolve(terminal.result)
      : builder,
  );
  return builder;
};

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "d_abc123",
    brandId: "00000000-0000-4000-8000-000000000002",
    serverSlug: null,
    name: "My event",
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
    clientRevision: 0,
    createdAt: "2026-06-16T10:00:00.000Z",
    updatedAt: "2026-06-16T10:00:00.000Z",
    isRsvp: false,
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: true,
    ...patch,
  }) as unknown as DraftEvent;

beforeEach(() => {
  mockFrom.mockReset();
  mockGetUser.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

describe("ORCH-1150-R2 D-2 — createServerDraft types the server row by RSVP-ness", () => {
  const runCreate = async (
    source: DraftEvent,
  ): Promise<{ insertPayloads: unknown[]; rpcNames: unknown[] }> => {
    const capture = { inFilters: [] as InFilter[], insertPayloads: [] as unknown[] };
    const rpcNames: unknown[] = [];
    const insertedRow = {
      id: "00000000-0000-4000-8000-0000000000aa",
      brand_id: source.brandId,
      created_by: "user-1",
      title: source.name,
      description: "",
      slug: "draft-xyz",
      currency: "USD",
      theme: {},
      status: "draft",
      timezone: source.timezone,
      created_at: source.createdAt,
      updated_at: source.updatedAt,
      event_type: source.isRsvp === true ? "rsvp" : "event",
    };
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brands") {
        return makeBuilder(
          {
            method: "maybeSingle",
            result: { data: { default_currency: "usd" }, error: null },
          },
          capture,
        );
      }
      return makeBuilder(
        { method: "single", result: { data: insertedRow, error: null } },
        capture,
      );
    });
    mockRpc.mockImplementation(
      async (name: unknown, rawArgs: unknown) => {
        const args = rawArgs as { p_payload?: unknown };
        rpcNames.push(name);
        if (source.isRsvp === true) {
          expect(name).toBe("business_create_rsvp_draft_graph");
        } else {
          expect(name).toBe("business_create_event_draft");
        }
        capture.insertPayloads.push(args.p_payload);
        return { data: { event: insertedRow }, error: null };
      },
    );
    await createServerDraft(source.brandId, source);
    return { insertPayloads: capture.insertPayloads, rpcNames };
  };

  test("RSVP draft (isRsvp:true) → graph RPC creates an rsvp-typed row", async () => {
    const { rpcNames } = await runCreate(baseDraft({ isRsvp: true }));
    expect(rpcNames).toEqual(["business_create_rsvp_draft_graph"]);
  });

  test("ticketed draft (isRsvp:false) → server row stays event_type:'event'", async () => {
    const { insertPayloads, rpcNames } = await runCreate(
      baseDraft({ isRsvp: false }),
    );
    expect(rpcNames).toEqual(["business_create_event_draft"]);
    expect(insertPayloads[0]).toMatchObject({
      brand_id: "00000000-0000-4000-8000-000000000002",
    });
  });
});

describe("ORCH-1150-R2 D-2 — draft fetches admit RSVP rows", () => {
  test("fetchDraftsForBrand filters event_type IN ['event','rsvp']", async () => {
    const capture = { inFilters: [] as InFilter[], insertPayloads: [] as unknown[] };
    mockFrom.mockImplementation(() =>
      makeBuilder(
        { method: "thenable", result: { data: [], error: null } },
        capture,
      ),
    );
    await fetchDraftsForBrand("brand-1");
    const eventTypeFilter = capture.inFilters.find(
      (f) => f.column === "event_type",
    );
    expect(eventTypeFilter).toBeDefined();
    expect(eventTypeFilter?.values).toEqual(["event", "rsvp"]);
  });

  test("fetchDraftById filters event_type IN ['event','rsvp']", async () => {
    const capture = { inFilters: [] as InFilter[], insertPayloads: [] as unknown[] };
    mockFrom.mockImplementation(() =>
      makeBuilder(
        { method: "maybeSingle", result: { data: null, error: null } },
        capture,
      ),
    );
    await fetchDraftById("00000000-0000-4000-8000-0000000000aa");
    const eventTypeFilter = capture.inFilters.find(
      (f) => f.column === "event_type",
    );
    expect(eventTypeFilter).toBeDefined();
    expect(eventTypeFilter?.values).toEqual(["event", "rsvp"]);
  });
});
