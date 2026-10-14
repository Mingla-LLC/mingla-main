/**
 * Issue #3645 — tester adversarial proof for "a draft follows its brand's
 * currency" on the client.
 *
 * The implementor suite proves the rule. This one attacks what a host could
 * lose around it:
 *
 *   - a copy of the draft kept on this device, still in pounds with its old
 *     prices, is saved AFTER the server already moved the draft to naira and
 *     cleared it: the old numbers must not come back, in any field;
 *   - the server's all-in copy of a price is a price too;
 *   - a brand with no usable currency (null, undefined, blank, spaces) clears
 *     nothing and moves nothing;
 *   - a brand choosing its FIRST currency keeps every typed amount, chip-ins
 *     and all-in copies included, and tells the host nothing;
 *   - the host is told once: after the adopting save, opening again is quiet;
 *   - a free ticket stays free; "Who covers the costs?" is not touched;
 *   - a trip package marker that is not the server's shape opens no empty
 *     price field.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { adoptBrandCurrencyForDraft } from "../../utils/draftFollowsBrandCurrency";
import { planDraftCurrencyFollow } from "../../hooks/useDraftFollowsBrandCurrency";
import {
  getPricesClearedNote,
  resetPricesClearedNotesForTest,
} from "../../utils/draftPricesClearedNote";
import {
  TRIP_PRICE_CLEARED_KEY,
  tierNeedsPriceReentry,
} from "../../utils/tripPriceReentry";
import { validateTripPackages } from "../../components/trip/tripPackagesValidation";

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

// A paid ticket carrying BOTH copies of its price, as a saved draft does.
const paidTicket = ticket({
  id: "t_paid",
  priceGbp: 50,
  priceAllInGbp: 52.25,
  currency: "GBP",
});
const vipTicket = ticket({
  id: "t_vip",
  name: "VIP",
  priceGbp: 120,
  priceAllInGbp: 125.4,
  displayOrder: 1,
});
const freeTicket = ticket({
  id: "t_free",
  name: "Community",
  priceGbp: null,
  isFree: true,
  displayOrder: 2,
});

const baseDraft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "00000000-0000-4000-8000-0000000a3645",
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
    tickets: [paidTicket, vipTicket, freeTicket],
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
    pricingSwitches: { passTax: true, passMinglaFee: false, passServiceFee: true },
    lastStepReached: 4,
    status: "draft",
    clientRevision: 3,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...patch,
  }) as DraftEvent;

interface SavedTicket {
  id: string;
  priceGbp: number | null;
  priceAllInGbp?: number | null;
  isFree: boolean;
  currency?: string;
}

interface SavedPayload {
  currency: string | null;
  pass_tax: boolean | null;
  pass_mingla_fee: boolean | null;
  pass_service_fee: boolean | null;
  __expectedClientRevision?: number;
  theme: {
    business_draft: {
      currency: string | null;
      tickets: SavedTicket[];
      rsvpContributionSuggestedCents?: number | null;
      rsvpContributionMinCents?: number | null;
      pricesClearedForCurrencyChange?: unknown;
    };
  };
}

/**
 * Run one autosave. `serverRow` is the draft row the save reads first (what
 * the database holds right now); the payload the save writes is returned.
 */
const runAutosave = async (
  draft: DraftEvent,
  serverRow: { currency: string | null; businessDraft?: Record<string, unknown> },
  options?: { brandCurrency?: string | null },
): Promise<SavedPayload> => {
  mockFrom.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is"]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.maybeSingle = jest.fn(() =>
      Promise.resolve({
        data: {
          default_currency: "GBP",
          currency: serverRow.currency,
          theme: {
            business_draft: {
              clientRevision: draft.clientRevision,
              currency: serverRow.currency,
              ...(serverRow.businessDraft ?? {}),
            },
          },
        },
        error: null,
      }),
    );
    return builder;
  });
  let payload: SavedPayload | null = null;
  mockRpc.mockImplementation((_name: unknown, args: unknown) => {
    payload = (args as { p_payload: SavedPayload }).p_payload;
    return Promise.resolve({
      data: {
        event: {
          id: draft.id,
          brand_id: draft.brandId,
          created_by: "user-1",
          title: draft.name,
          description: draft.description,
          slug: "draft-event",
          currency: payload.currency,
          theme: payload.theme,
          visibility: "draft",
          status: "draft",
          timezone: draft.timezone,
          created_at: draft.createdAt,
          updated_at: draft.updatedAt,
          published_at: null,
          deleted_at: null,
        },
      },
      error: null,
    });
  });
  if (options === undefined) await autosaveServerDraft(draft);
  else await autosaveServerDraft(draft, options);
  if (payload === null) throw new Error("autosave wrote nothing");
  return payload;
};

/** Every number that could be read as an amount of money in a saved draft. */
const moneyNumbersIn = (payload: SavedPayload): number[] => {
  const draft = payload.theme.business_draft;
  const numbers: number[] = [];
  for (const saved of draft.tickets) {
    if (typeof saved.priceGbp === "number") numbers.push(saved.priceGbp);
    if (typeof saved.priceAllInGbp === "number") numbers.push(saved.priceAllInGbp);
  }
  if (typeof draft.rsvpContributionSuggestedCents === "number") {
    numbers.push(draft.rsvpContributionSuggestedCents);
  }
  if (typeof draft.rsvpContributionMinCents === "number") {
    numbers.push(draft.rsvpContributionMinCents);
  }
  return numbers;
};

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  resetPricesClearedNotesForTest();
});

describe("#3645 tester: old prices kept on this device cannot come back", () => {
  test("the server already moved and cleared the draft; this device's pound copy saves NO pound amount", async () => {
    // What the database holds after the brand moved to naira.
    const wipedServerRow = {
      currency: "NGN",
      businessDraft: {
        tickets: [{ id: "t_paid", priceGbp: null, isFree: false }],
        pricesClearedForCurrencyChange: { from: "GBP", to: "NGN" },
      },
    };
    // What this device still holds: pounds, both prices, both copies of each.
    const payload = await runAutosave(baseDraft(), wipedServerRow, {
      brandCurrency: "NGN",
    });

    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.currency).toBe("NGN");
    expect(moneyNumbersIn(payload)).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("GBP");
    // Still two paid tickets waiting for a price, not two free ones.
    const paid = payload.theme.business_draft.tickets.filter((t) => !t.isFree);
    expect(paid.map((t) => t.id)).toEqual(["t_paid", "t_vip"]);
  });

  test("the all-in copy of a price is cleared with the price, on every paid ticket", async () => {
    const payload = await runAutosave(baseDraft(), { currency: "GBP" }, {
      brandCurrency: "NGN",
    });
    for (const saved of payload.theme.business_draft.tickets) {
      expect(saved.priceAllInGbp ?? null).toBeNull();
      expect(saved.priceGbp).toBeNull();
    }
  });

  test("pound chip-in amounts on this device's RSVP copy are not saved as naira", async () => {
    const payload = await runAutosave(
      baseDraft({
        isRsvp: true,
        tickets: [],
        rsvpContributionEnabled: true,
        rsvpContributionSuggestedCents: 1500,
        rsvpContributionMinCents: 500,
      }),
      { currency: "NGN" },
      { brandCurrency: "NGN" },
    );
    expect(payload.currency).toBe("NGN");
    expect(moneyNumbersIn(payload)).toEqual([]);
  });
});

describe("#3645 tester: a brand with no usable currency clears nothing", () => {
  test.each([[null], [undefined], [""], ["   "]])(
    "brand currency %p: the pure rule hands back the same draft",
    (brandCurrency) => {
      const draft = baseDraft();
      const adoption = adoptBrandCurrencyForDraft(draft, brandCurrency);
      expect(adoption.draft).toBe(draft);
      expect(adoption.changed).toBe(false);
      expect(adoption.pricesCleared).toBe(false);
      expect(planDraftCurrencyFollow(draft, brandCurrency, null)).toBeNull();
    },
  );

  test.each([[null], [""], ["   "]])(
    "brand currency %p: the save keeps the draft's own currency and every price",
    async (brandCurrency) => {
      const payload = await runAutosave(baseDraft(), { currency: "GBP" }, {
        brandCurrency,
      });
      expect(payload.currency).toBe("GBP");
      expect(moneyNumbersIn(payload)).toEqual([50, 52.25, 120, 125.4]);
    },
  );
});

describe("#3645 tester: a brand's FIRST currency keeps what was typed", () => {
  test("event draft with no currency: both copies of each price are kept, and the host is told nothing", async () => {
    const draft = baseDraft({
      currency: null,
      tickets: [
        ticket({ id: "t_paid", priceGbp: 50, priceAllInGbp: 52.25 }),
        freeTicket,
      ],
    });
    expect(planDraftCurrencyFollow(draft, "NGN", null)).toBeNull();

    const payload = await runAutosave(draft, { currency: null }, {
      brandCurrency: "NGN",
    });
    expect(payload.currency).toBe("NGN");
    expect(moneyNumbersIn(payload)).toEqual([50, 52.25]);
    expect(getPricesClearedNote(draft.id)).toBeNull();
  });

  test("RSVP draft with no currency: chip-in amounts are kept", async () => {
    const draft = baseDraft({
      currency: null,
      isRsvp: true,
      tickets: [],
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 1500,
      rsvpContributionMinCents: 500,
    });
    const adoption = adoptBrandCurrencyForDraft(draft, "NGN");
    expect(adoption.pricesCleared).toBe(false);
    expect(adoption.draft.rsvpContributionSuggestedCents).toBe(1500);
    expect(adoption.draft.rsvpContributionMinCents).toBe(500);
    expect(planDraftCurrencyFollow(draft, "NGN", null)).toBeNull();

    const payload = await runAutosave(draft, { currency: null }, {
      brandCurrency: "NGN",
    });
    expect(payload.currency).toBe("NGN");
    expect(moneyNumbersIn(payload)).toEqual([1500, 500]);
  });
});

describe("#3645 tester: the host is told once", () => {
  test("after the adopting update is applied, opening the draft again is quiet", () => {
    const draft = baseDraft();
    const first = planDraftCurrencyFollow(draft, "NGN", null);
    expect(first).not.toBeNull();
    expect(first?.notice).toContain("Nigerian naira");

    // The route applies the patch to the stored draft; the server note is gone.
    const adopted = { ...draft, ...first?.patch } as DraftEvent;
    expect(planDraftCurrencyFollow(adopted, "NGN", null)).toBeNull();
  });

  test("a draft that only changed currency, with nothing priced, moves without a notice", () => {
    const plan = planDraftCurrencyFollow(
      baseDraft({ tickets: [freeTicket] }),
      "NGN",
      null,
    );
    expect(plan?.patch.currency).toBe("NGN");
    expect(plan?.notice).toBeNull();
  });

  test("the server's note alone asks for a save that changes no price the host has since typed", () => {
    const repriced = baseDraft({
      currency: "NGN",
      tickets: [ticket({ id: "t_paid", priceGbp: 7000 }), freeTicket],
    });
    const plan = planDraftCurrencyFollow(repriced, "NGN", { from: "GBP", to: "NGN" });
    expect(plan).not.toBeNull();
    // Nothing about the draft is patched: its naira price stays.
    expect(plan?.patch).toEqual({});
  });
});

describe("#3645 tester: free stays free, and the cost choices are not touched", () => {
  test("a free ticket is the same object's worth of fields after the move", () => {
    const adopted = adoptBrandCurrencyForDraft(baseDraft(), "NGN").draft;
    const free = adopted.tickets.find((t) => t.id === "t_free");
    expect(free).toEqual(freeTicket);
    // And no paid ticket was turned into a free one.
    expect(adopted.tickets.filter((t) => t.isFree).map((t) => t.id)).toEqual(["t_free"]);
  });

  test("'Who covers the costs?' is saved exactly as the host set it", async () => {
    const payload = await runAutosave(baseDraft(), { currency: "GBP" }, {
      brandCurrency: "NGN",
    });
    expect(payload.pass_tax).toBe(true);
    expect(payload.pass_mingla_fee).toBe(false);
    expect(payload.pass_service_fee).toBe(true);
    const adopted = adoptBrandCurrencyForDraft(baseDraft(), "NGN").draft;
    expect(adopted.pricingSwitches).toEqual({
      passTax: true,
      passMinglaFee: false,
      passServiceFee: true,
    });
  });
});

describe("#3645 tester: a trip package marker that is not the server's shape", () => {
  test.each([[true], ["GBP"], [["GBP", "NGN"]], [null], [0]])(
    "marker %p on a free package does not make it 'no price yet'",
    (marker) => {
      expect(
        tierNeedsPriceReentry({
          priceCents: 0,
          tierMetadata: { [TRIP_PRICE_CLEARED_KEY]: marker },
        }),
      ).toBe(false);
    },
  );

  test("a cleared package: spaces are not a price; 0 is", () => {
    const pkg = {
      name: "Standard",
      capacity: 12,
      paymentPlan: null,
      priceNeedsReentry: true,
    };
    expect(validateTripPackages([{ ...pkg, priceMajor: "   " }]).ok).toBe(false);
    expect(validateTripPackages([{ ...pkg, priceMajor: "0" }]).ok).toBe(true);
    // The same empty field on a package that was never cleared is a free package.
    expect(
      validateTripPackages([{ ...pkg, priceNeedsReentry: false, priceMajor: "" }]).ok,
    ).toBe(true);
  });
});
