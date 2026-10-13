/**
 * Issue #3645 — rework proof (tester verdict on PR 3833), client half.
 *
 * MUST-FIX 3. The save trusted a brand currency passed from a list cached on
 * the device, and let it outrank the server row. A second device with a stale
 * list rewrote a correctly re-priced NGN draft to GBP and cleared it; a tab
 * left open wrote GBP and 50 back over the server's cleared row. Now the
 * autosave hook asks the server for the brand's CURRENT currency before a save
 * and passes that; when the server cannot say, the save follows the server
 * ROW's currency, and the cached value is used only for a row that has none.
 * Adopt-on-open asks the server too.
 *
 * MUST-FIX 2 (client). A trip pricing form open across the change saved the
 * old number under the new currency. The pricing save now refuses a price the
 * host did not type after the clear.
 *
 * ALSO. The "prices were cleared" note is written back as JSON null once it
 * has been shown, because the RSVP draft owner merges the draft JSON.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const mockGetUser = jest.fn<
  () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
>();
const mockFrom = jest.fn();
const mockRpc = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: Error | null }>
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

import { autosaveServerDraft } from "../eventDrafts";
import { fetchDraftBrandCurrency, fetchDraftCurrencyTruth } from "../draftCurrencyTruth";
import { updateTripPricing } from "../tripsService";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { planDraftCurrencyFollow } from "../../hooks/useDraftFollowsBrandCurrency";
import {
  getPricesClearedNote,
  recordPricesClearedNote,
  resetPricesClearedNotesForTest,
} from "../../utils/draftPricesClearedNote";
import {
  TRIP_PRICE_CLEARED_KEY,
  TRIP_PRICE_REENTRY_REQUIRED_CODE,
  tierMetadataHasPriceClearedMarker,
} from "../../utils/tripPriceReentry";
import { readRpcFailureMessage } from "../rsvpRpcFailure";

const ticket = (patch: Partial<TicketStub>): TicketStub =>
  ({
    id: "t_1",
    name: "General",
    priceGbp: 50,
    capacity: 100,
    isFree: false,
    isUnlimited: false,
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
    ...patch,
  }) as TicketStub;

const paidTicket = ticket({ id: "t_paid", name: "General", priceGbp: 50, currency: "GBP" });
const freeTicket = ticket({ id: "t_free", name: "Community", priceGbp: null, isFree: true, displayOrder: 1 });

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "00000000-0000-4000-8000-000000003645",
    brandId: "00000000-0000-4000-8000-000000000002",
    serverSlug: "draft-event",
    name: "Lagos launch",
    description: "Draft body",
    format: "in_person",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    whenMode: "single",
    date: "2026-12-01",
    doorsOpen: "18:00",
    endsAt: "21:00",
    endsAtUtc: null,
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Studio",
    address: "1 Test Street",
    city: null,
    locationGeo: null,
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: "GBP",
    tickets: [paidTicket, freeTicket],
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
    lastStepReached: 4,
    status: "draft",
    clientRevision: 3,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...patch,
  }) as DraftEvent;

interface SavedPayload {
  currency: string | null;
  theme: {
    business_draft: Record<string, unknown> & {
      currency: string | null;
      tickets: { id: string; priceGbp: number | null; isFree: boolean; currency?: string }[];
    };
  };
}

/**
 * One autosave against a server that answers every read with the draft row
 * AND (when `brand` is given) the brand's current currency.
 */
const runAutosave = async (
  draft: DraftEvent,
  server: { row: string | null; brand?: string | null },
  options?: {
    brandCurrency?: string | null;
    serverRowWins?: boolean;
    cachedBrandCurrency?: string | null;
  },
): Promise<{ payload: SavedPayload; tablesRead: string[]; selects: string[]; rpcName: string }> => {
  const tablesRead: string[] = [];
  const selects: string[] = [];
  mockFrom.mockImplementation((table: unknown) => {
    tablesRead.push(String(table));
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "in", "is"]) builder[method] = jest.fn(() => builder);
    builder.select = jest.fn((columns: unknown) => {
      selects.push(String(columns));
      return builder;
    });
    builder.maybeSingle = jest.fn(() =>
      Promise.resolve({
        data: {
          currency: server.row,
          theme: { business_draft: { clientRevision: draft.clientRevision, currency: server.row } },
          ...("brand" in server ? { brand: { default_currency: server.brand } } : {}),
        },
        error: null,
      }),
    );
    return builder;
  });
  let payload: SavedPayload | null = null;
  let rpcName = "";
  mockRpc.mockImplementation((name: unknown, args: unknown) => {
    rpcName = String(name);
    payload = (args as { p_payload: SavedPayload }).p_payload;
    return Promise.resolve({
      data: {
        event: {
          id: draft.id, brand_id: draft.brandId, created_by: "user-1", title: draft.name,
          description: draft.description, slug: "draft-event", currency: payload.currency,
          theme: payload.theme, visibility: "draft", status: "draft", timezone: draft.timezone,
          created_at: draft.createdAt, updated_at: draft.updatedAt, published_at: null,
          deleted_at: null,
        },
      },
      error: null,
    });
  });
  if (options === undefined) await autosaveServerDraft(draft);
  else await autosaveServerDraft(draft, options);
  if (payload === null) throw new Error("autosave wrote nothing");
  return { payload, tablesRead, selects, rpcName };
};

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  resetPricesClearedNotesForTest();
});

const repricedNaira = (): DraftEvent =>
  baseDraft({
    currency: "NGN",
    tickets: [ticket({ id: "t_paid", priceGbp: 7000, currency: "NGN" }), freeTicket],
  });

// What the autosave hook passes: the brand's currency FRESH from the server
// (null when the server could not say), "the server row wins", and the value
// cached on this device as a last resort.
const wizardSave = (fresh: string | null, cached: string | null) => ({
  brandCurrency: fresh,
  serverRowWins: true,
  cachedBrandCurrency: cached,
});

describe("#3645 rework: a brand list cached on this device is never believed over the server", () => {
  test("second device, stale list: a re-priced NGN draft stays NGN and keeps its price", async () => {
    // This device's brand list still says pounds. The server knows better.
    for (const fresh of ["NGN", null]) {
      const { payload } = await runAutosave(
        repricedNaira(),
        { row: "NGN" },
        wizardSave(fresh, "GBP"),
      );
      expect(payload.currency).toBe("NGN");
      expect(payload.theme.business_draft.currency).toBe("NGN");
      expect(payload.theme.business_draft.tickets[0]?.priceGbp).toBe(7000);
      expect(JSON.stringify(payload)).not.toContain("GBP");
    }
  });

  test("a tab left open: pounds and 50 are not written back over the server's cleared naira row", async () => {
    for (const fresh of ["NGN", null]) {
      const { payload } = await runAutosave(
        baseDraft(), // still GBP with a 50 ticket on this device
        { row: "NGN" },
        wizardSave(fresh, "GBP"),
      );
      expect(payload.currency).toBe("NGN");
      expect(payload.theme.business_draft.currency).toBe("NGN");
      expect(payload.theme.business_draft.tickets[0]?.priceGbp).toBeNull();
      expect(payload.theme.business_draft.tickets[0]?.isFree).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("GBP");
      expect(JSON.stringify(payload)).not.toContain(":50");
    }
  });

  test("the save itself still makes ONE read, of plain event columns", async () => {
    const { tablesRead, selects } = await runAutosave(
      repricedNaira(),
      { row: "NGN" },
      wizardSave("NGN", "GBP"),
    );
    expect(tablesRead).toEqual(["events"]);
    expect(selects).toEqual(["theme,currency"]);
  });

  test("the brand's fresh currency moves a draft the database has not moved yet, and the host is told", async () => {
    // Row still GBP (the brand trigger has not run for it); the brand is NGN.
    const draft = baseDraft();
    const { payload } = await runAutosave(draft, { row: "GBP" }, wizardSave("NGN", "GBP"));
    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.tickets[0]?.priceGbp).toBeNull();
    // The save itself cleared the prices, so it leaves the note for the notice.
    expect(getPricesClearedNote(draft.id)).toEqual({ from: "GBP", to: "NGN" });
  });

  test("the cached value is used only when the server row has no currency at all", async () => {
    const draft = baseDraft({ currency: null, tickets: [ticket({ id: "t_paid", priceGbp: 25 })] });
    const stamped = await runAutosave(draft, { row: null }, wizardSave(null, "NGN"));
    expect(stamped.payload.currency).toBe("NGN");
    // A first currency: the typed price stays.
    expect(stamped.payload.theme.business_draft.tickets[0]?.priceGbp).toBe(25);
    // With a row currency the cached value is not even looked at.
    const rowWins = await runAutosave(draft, { row: "USD" }, wizardSave(null, "NGN"));
    expect(rowWins.payload.currency).toBe("USD");
    expect(rowWins.payload.theme.business_draft.tickets[0]?.priceGbp).toBe(25);
  });

  test("the hook asks the server before every save and never passes the cached value as the brand's currency", () => {
    const root = path.resolve(__dirname, "../../..");
    const hook = fs
      .readFileSync(path.join(root, "src", "hooks", "useServerDraftEvents.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s+/g, "");
    expect(hook).toContain(
      "returnautosaveServerDraft(draft,{brandCurrency:awaitreadFreshBrandCurrency(draft.id),serverRowWins:true,cachedBrandCurrency:brandCurrencyRef?.current??null,});",
    );
    expect(hook).toContain("constcurrency=awaitfetchDraftBrandCurrency(draftId);");
    // A failed read is logged and yields "not known", never the cached value.
    expect(hook).toMatch(/catch\(error\)\{console\.warn\([^;]*\);returnnull;\}/);
    expect(hook).not.toContain("brandCurrency:brandCurrencyRef");
  });
});

describe("#3645 rework: adopt-on-open asks the server", () => {
  const answer = (data: unknown, error: Error | null = null): string[] => {
    const selects: string[] = [];
    mockFrom.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "in", "is"]) builder[method] = jest.fn(() => builder);
      builder.select = jest.fn((columns: unknown) => {
        selects.push(String(columns));
        return builder;
      });
      builder.maybeSingle = jest.fn(() => Promise.resolve({ data, error }));
      return builder;
    });
    return selects;
  };

  test("the brand's current currency wins; the row's is used when the brand has none", async () => {
    const selects = answer({ currency: "GBP", brand: { default_currency: "ngn" } });
    await expect(fetchDraftCurrencyTruth("draft-1")).resolves.toBe("NGN");
    expect(selects).toEqual(["currency,brand:brands(default_currency)"]);
    answer({ currency: "usd", brand: { default_currency: null } });
    await expect(fetchDraftCurrencyTruth("draft-1")).resolves.toBe("USD");
    answer({ currency: null, brand: [{ default_currency: "NGN" }] });
    await expect(fetchDraftCurrencyTruth("draft-1")).resolves.toBe("NGN");
    answer(null);
    await expect(fetchDraftCurrencyTruth("draft-1")).resolves.toBeNull();
  });

  test("the brand's currency on its own: a currency, none, or not known", async () => {
    answer({ currency: "GBP", brand: { default_currency: "ngn" } });
    await expect(fetchDraftBrandCurrency("draft-1")).resolves.toBe("NGN");
    answer({ currency: "GBP", brand: { default_currency: null } });
    await expect(fetchDraftBrandCurrency("draft-1")).resolves.toBeNull();
    answer({ currency: "GBP" });
    await expect(fetchDraftBrandCurrency("draft-1")).resolves.toBeUndefined();
    answer(null);
    await expect(fetchDraftBrandCurrency("draft-1")).resolves.toBeUndefined();
  });

  test("a failed read is an error, not 'no currency'", async () => {
    const failure = new Error("network unavailable");
    answer(null, failure);
    await expect(fetchDraftCurrencyTruth("draft-1")).rejects.toBe(failure);
  });

  test("a draft already in the server's currency is never cleared, whatever a cached list says", () => {
    // Server truth NGN, local NGN with a price: nothing to do.
    expect(planDraftCurrencyFollow(repricedNaira(), "NGN", null)).toBeNull();
    // No answer from the server yet (or none to be had): nothing is adopted.
    expect(planDraftCurrencyFollow(repricedNaira(), null, null)).toBeNull();
    expect(planDraftCurrencyFollow(baseDraft(), null, null)).toBeNull();
  });

  test("the hook reads the server and takes no brand currency from the route", () => {
    const root = path.resolve(__dirname, "../../..");
    const code = (rel: string): string =>
      fs
        .readFileSync(path.join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const hook = code(path.join("src", "hooks", "useDraftFollowsBrandCurrency.ts"));
    expect(hook).toContain("await fetchDraftCurrencyTruth(draftId)");
    expect(hook).toContain("planDraftCurrencyFollow(draft, serverCurrency, serverNote)");
    expect(hook).not.toContain("defaultCurrency");
    expect(hook).not.toContain("useBrandList");
    for (const rel of [
      path.join("app", "event", "[id]", "edit.tsx"),
      path.join("app", "rsvp", "[id]", "edit.tsx"),
    ]) {
      expect(code(rel).replace(/\s+/g, "")).toContain(
        "useDraftFollowsBrandCurrency({draft:isEditPublished?null:draft,onSave:handleAutosaveDraft,onNotice:showPricesClearedNotice,});",
      );
    }
    const service = code(path.join("src", "services", "eventDrafts.ts")).replace(/\s+/g, "");
    // Fresh brand first; then, for wizard saves, the server row; the cached
    // value only when that row has none.
    expect(service).toContain(
      "constfollowCurrency=nullableCurrency(options.brandCurrency)??(options.serverRowWins===true?existing.currency??nullableCurrency(options.cachedBrandCurrency):null);",
    );
    // The save's own read of the draft row keeps to plain event columns.
    expect(service).toContain('.select("theme,currency")');
  });
});

describe("#3645 rework: the cleared-prices note is resolved once shown", () => {
  test("with no note waiting, the save writes the note back as JSON null (an RSVP merge then drops it)", async () => {
    const rsvp = baseDraft({ isRsvp: true, tickets: [], currency: "NGN" });
    const { payload, rpcName } = await runAutosave(rsvp, { row: "NGN", brand: "NGN" });
    expect(rpcName).toBe("business_update_rsvp_graph");
    expect(payload.theme.business_draft).toHaveProperty("pricesClearedForCurrencyChange", null);
  });

  test("while a note is still waiting to be shown, the key is left out so a merge keeps it", async () => {
    const rsvp = baseDraft({ isRsvp: true, tickets: [], currency: "NGN" });
    recordPricesClearedNote(rsvp.id, {
      business_draft: { pricesClearedForCurrencyChange: { from: "GBP", to: "NGN" } },
    });
    const { payload } = await runAutosave(rsvp, { row: "NGN", brand: "NGN" });
    expect(payload.theme.business_draft).not.toHaveProperty("pricesClearedForCurrencyChange");
  });

  test("a note stored as null, or as resolved, is no note", () => {
    recordPricesClearedNote("d-1", { business_draft: { pricesClearedForCurrencyChange: null } });
    expect(getPricesClearedNote("d-1")).toBeNull();
    recordPricesClearedNote("d-1", {
      business_draft: { pricesClearedForCurrencyChange: { resolved: true } },
    });
    expect(getPricesClearedNote("d-1")).toBeNull();
  });
});

describe("#3645 rework: a trip pricing form left open across the change cannot save the old number", () => {
  const marker = { [TRIP_PRICE_CLEARED_KEY]: { from: "GBP", to: "NGN" } };
  const TIER = "tt-standard";

  /** Server: the tier row (fresh), what the package costs now, and the reads after a save. */
  const server = (state: {
    tierMetadata: Record<string, unknown>;
    priceCents: number;
  }): { tables: string[]; sent: () => Record<string, unknown> | null } => {
    const tables: string[] = [];
    let sent: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: unknown) => {
      tables.push(String(table));
      const rows =
        table === "trip_pricing_tiers"
          ? [{ id: "tier-1", event_id: "trip-1", ticket_type_id: TIER, tier_name: "Standard",
               tier_metadata: state.tierMetadata, created_at: "2026-10-01T00:00:00Z" }]
          : [{ id: TIER, event_id: "trip-1", price_cents: state.priceCents, currency: "NGN",
               quantity_total: 12, is_unlimited: false }];
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
        builder[method] = jest.fn(() => builder);
      }
      builder.maybeSingle = jest.fn(() => Promise.resolve({ data: rows[0], error: null }));
      return builder;
    });
    mockRpc.mockImplementation((_name: unknown, args: unknown) => {
      const tiers = (args as { p_patch: { tiers: Record<string, unknown>[] } }).p_patch.tiers;
      sent = tiers[0] ?? null;
      return Promise.resolve({ data: {}, error: null });
    });
    return { tables, sent: () => sent };
  };
  const options = { operationId: "op-1", expectedUpdatedAt: "2026-10-13T00:00:00Z" };

  test("the old number is REFUSED and nothing is sent", async () => {
    const s = server({ tierMetadata: { description: "Shared room", ...marker }, priceCents: 0 });
    await expect(
      updateTripPricing("trip-1", { ticketTypeId: TIER, tierName: "Standard", priceCents: 45000, capacity: 12 }, options),
    ).rejects.toThrow("price_reentry_required");
    expect(s.sent()).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a price the host typed after the clear is saved, and the marker goes", async () => {
    const s = server({ tierMetadata: { description: "Shared room", ...marker }, priceCents: 0 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard", priceCents: 9000000, capacity: 12, priceEntered: true },
      options,
    );
    expect(s.sent()?.price_cents).toBe(9000000);
    expect(s.sent()?.tier_metadata).toEqual({ description: "Shared room" });
  });

  test("an explicit free (0, typed) also removes the marker", async () => {
    const s = server({ tierMetadata: { ...marker }, priceCents: 0 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard", priceCents: 0, capacity: 12, priceEntered: true },
      options,
    );
    expect(s.sent()?.price_cents).toBe(0);
    expect(s.sent()?.tier_metadata).toEqual({});
  });

  test("an empty price on a cleared package is saved as it stands: still marked, no extra read", async () => {
    const s = server({ tierMetadata: { ...marker }, priceCents: 0 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard", priceCents: 0, capacity: 12 },
      options,
    );
    expect(tierMetadataHasPriceClearedMarker(s.sent()?.tier_metadata as Record<string, unknown>)).toBe(true);
    // tier row, then the two reads after the save. No price lookup before it.
    expect(s.tables.indexOf("ticket_types")).toBeGreaterThan(s.tables.indexOf("trip_pricing_tiers"));
    expect(s.tables.filter((t) => t === "ticket_types")).toHaveLength(1);
  });

  test("a left-over marker on a package that already has a price is dropped, not a wall", async () => {
    const s = server({ tierMetadata: { ...marker }, priceCents: 9000000 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard", priceCents: 9500000, capacity: 12 },
      options,
    );
    expect(s.sent()?.price_cents).toBe(9500000);
    expect(s.sent()?.tier_metadata).toEqual({});
  });

  test("the DATABASE's refusal reaches the wizard as the same code the step already puts into words", async () => {
    // The package was cleared between this save's read and its write, so the
    // client check saw no marker; the commit-time rule refuses instead.
    server({ tierMetadata: { description: "Shared room" }, priceCents: 45000 });
    mockRpc.mockImplementation(() =>
      Promise.resolve({
        data: null,
        // The shape PostgREST gives a raised exception (not an Error instance).
        error: {
          message: "price_reentry_required",
          code: "P0001",
          details: null,
          hint: null,
        } as unknown as Error,
      }),
    );
    let caught: unknown = null;
    try {
      await updateTripPricing(
        "trip-1",
        { ticketTypeId: TIER, tierName: "Standard", priceCents: 45000, capacity: 12 },
        options,
      );
    } catch (error) {
      caught = error;
    }
    expect(readRpcFailureMessage(caught)).toBe(TRIP_PRICE_REENTRY_REQUIRED_CODE);
    expect(TRIP_PRICE_REENTRY_REQUIRED_CODE).toBe("price_reentry_required");
  });

  test("the wizard re-seeds a cleared package when the trip is read again, with no new import", () => {
    const root = path.resolve(__dirname, "../../..");
    const wizard = fs
      .readFileSync(path.join(root, "src", "components", "trip", "TripCreatorWizard.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const flat = wizard.replace(/\s+/g, "");
    // Re-seeded on every read of the trip, not only at mount.
    expect(flat).toContain(
      "p.ticketTypeId!==null&&newlyCleared.includes(p.ticketTypeId)?{...p,priceMajor:\"\",priceNeedsReentry:true}:p",
    );
    expect(flat).toContain("},[trip.pricingTiers,showToast]);");
    // A package the host was already told about is not emptied again.
    expect(flat).toContain("constnewlyCleared=clearedIds.filter((id)=>!acknowledged.has(id));");
    // The refusal has plain words on the step.
    expect(wizard).toContain(`if (autosaveErrCode === "price_reentry_required") {`);
    expect(wizard).toContain(
      `showToast("Your brand's currency changed. Enter this package's price again.");`,
    );
    // The compiled-wizard suites allow no new import here.
    expect(wizard).not.toContain("tripPriceReentry");
    expect(wizard).not.toContain("draftFollowsBrandCurrency");
    const hook = fs.readFileSync(path.join(root, "src", "hooks", "useTrips.ts"), "utf8");
    expect(hook.replace(/\s+/g, "")).toContain(
      'if(error.message==="price_reentry_required"){queryClient.invalidateQueries({queryKey:tripKeys.detail(eventId)});}',
    );
  });
});
