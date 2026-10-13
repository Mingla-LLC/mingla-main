/**
 * Issue #3645 — implementor proof that a draft follows its brand's currency on
 * the client.
 *
 * BEFORE. `resolveDraftCurrencyForSave` asked the draft first, the server row
 * second and the brand last, so a draft kept on the device in pounds kept
 * saving pounds after the brand moved to naira, and the mapper read the JSON
 * copy of the currency ahead of the row's own column.
 *
 * AFTER. The wizards pass the brand's currency into every save. When it is
 * passed, the brand wins: a draft in another currency is saved in the brand's
 * with its paid prices and chip-in amounts EMPTY; a draft with no currency yet
 * takes the currency and KEEPS its prices. With nothing passed the old order
 * is unchanged (eventDraftsCurrency.test.ts still owns that).
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
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import {
  adoptBrandCurrencyForDraft,
  currencyPlainName,
  pricesClearedNotice,
} from "../../utils/draftFollowsBrandCurrency";
import { planDraftCurrencyFollow } from "../../hooks/useDraftFollowsBrandCurrency";
import {
  getPricesClearedNote,
  pricesClearedNoteFromTheme,
  resetPricesClearedNotesForTest,
} from "../../utils/draftPricesClearedNote";
import { serverRowToDraft } from "../../utils/serverDraftEventMapper";
import {
  TRIP_PRICE_CLEARED_KEY,
  TRIP_PRICE_REENTRY_MESSAGE,
  tierNeedsPriceReentry,
  tierPriceClearedCurrency,
  withoutPriceClearedMarker,
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
    business_draft: {
      currency: string | null;
      tickets: { id: string; priceGbp: number | null; isFree: boolean; currency?: string }[];
      rsvpContributionSuggestedCents?: number | null;
      rsvpContributionMinCents?: number | null;
    };
  };
}

/** Queue the one read autosave makes, capture the payload it writes. */
const runAutosave = async (
  draft: DraftEvent,
  serverCurrency: string | null,
  options?: { brandCurrency?: string | null },
): Promise<{ payload: SavedPayload; tablesRead: string[] }> => {
  const tablesRead: string[] = [];
  mockFrom.mockImplementation((table: unknown) => {
    tablesRead.push(String(table));
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is"]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.maybeSingle = jest.fn(() =>
      Promise.resolve({
        data:
          table === "brands"
            ? { default_currency: "GBP" }
            : {
                currency: serverCurrency,
                theme: {
                  business_draft: {
                    clientRevision: draft.clientRevision,
                    currency: serverCurrency,
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
  return { payload, tablesRead };
};

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  resetPricesClearedNotesForTest();
});

describe("#3645 a draft saves in its brand's currency", () => {
  test("a GBP draft kept on the device, on a brand that now sells in NGN, saves as NGN with its paid prices empty", async () => {
    const { payload, tablesRead } = await runAutosave(baseDraft(), "GBP", {
      brandCurrency: "NGN",
    });

    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.currency).toBe("NGN");
    // Never pounds, anywhere in what is written.
    expect(JSON.stringify(payload)).not.toContain("GBP");

    const [paid, free] = payload.theme.business_draft.tickets;
    expect(paid.id).toBe("t_paid");
    // "No price yet", NOT free: a paid ticket never becomes a free one.
    expect(paid.priceGbp).toBeNull();
    expect(paid.isFree).toBe(false);
    expect(paid.currency).toBe("NGN");
    // The free ticket is exactly what it was.
    expect(free.id).toBe("t_free");
    expect(free.isFree).toBe(true);
    expect(free.priceGbp).toBeNull();
    // The save makes one read of its own, the draft row. (The brand's fresh
    // currency is read by the autosave hook before the save; see the rework
    // suite.)
    expect(tablesRead).toEqual(["events"]);
  });

  test("the brand's currency is honoured in any letter case", async () => {
    const { payload } = await runAutosave(baseDraft(), "GBP", { brandCurrency: " ngn " });
    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.tickets[0].priceGbp).toBeNull();
  });

  test("a draft with NO currency yet takes the brand's first currency and KEEPS its typed price", async () => {
    const draft = baseDraft({
      currency: null,
      tickets: [ticket({ id: "t_paid", priceGbp: 25 }), freeTicket],
    });
    const { payload } = await runAutosave(draft, null, { brandCurrency: "NGN" });

    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.currency).toBe("NGN");
    expect(payload.theme.business_draft.tickets[0].priceGbp).toBe(25);
    expect(payload.theme.business_draft.tickets[0].isFree).toBe(false);
  });

  test("a draft already in the brand's currency is saved untouched", async () => {
    const draft = baseDraft({
      currency: "NGN",
      tickets: [ticket({ id: "t_paid", priceGbp: 15000, currency: "NGN" })],
    });
    const { payload } = await runAutosave(draft, "NGN", { brandCurrency: "NGN" });
    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.tickets[0].priceGbp).toBe(15000);
  });

  test("an RSVP draft's pound chip-in amounts are not carried into naira", async () => {
    const draft = baseDraft({
      isRsvp: true,
      tickets: [],
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 1500,
      rsvpContributionMinCents: 500,
    });
    const { payload } = await runAutosave(draft, "GBP", { brandCurrency: "NGN" });
    expect(payload.currency).toBe("NGN");
    expect(payload.theme.business_draft.rsvpContributionSuggestedCents ?? null).toBeNull();
    expect(payload.theme.business_draft.rsvpContributionMinCents ?? null).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("1500");
  });

  test("with NO brand currency passed the save is what it always was", async () => {
    const withNothing = await runAutosave(baseDraft(), "USD");
    expect(withNothing.payload.currency).toBe("GBP");
    expect(withNothing.payload.theme.business_draft.tickets[0].priceGbp).toBe(50);

    const withNull = await runAutosave(baseDraft(), "USD", { brandCurrency: null });
    expect(withNull.payload.currency).toBe("GBP");
    expect(withNull.payload.theme.business_draft.tickets[0].priceGbp).toBe(50);
  });
});

describe("#3645 the pure rule", () => {
  test("no brand currency: the very same draft object comes back", () => {
    const draft = baseDraft();
    expect(adoptBrandCurrencyForDraft(draft, null).draft).toBe(draft);
    expect(adoptBrandCurrencyForDraft(draft, "  ").draft).toBe(draft);
    expect(adoptBrandCurrencyForDraft(draft, "gbp")).toEqual({
      draft,
      changed: false,
      pricesCleared: false,
    });
  });

  test("another currency with nothing priced moves quietly", () => {
    const draft = baseDraft({ tickets: [freeTicket] });
    const adoption = adoptBrandCurrencyForDraft(draft, "NGN");
    expect(adoption.changed).toBe(true);
    expect(adoption.pricesCleared).toBe(false);
    expect(adoption.draft.tickets[0]).toEqual(freeTicket);
  });

  test("the notice is in plain words", () => {
    expect(currencyPlainName("ngn")).toBe("Nigerian naira");
    expect(currencyPlainName("XXX")).toBe("XXX");
    expect(pricesClearedNotice("NGN")).toBe(
      "Your brand now sells in Nigerian naira. Enter your prices again.",
    );
  });
});

describe("#3645 what the wizard does when a draft opens", () => {
  test("a stale GBP draft on an NGN brand: adopt, empty the price, tell the host", () => {
    const plan = planDraftCurrencyFollow(baseDraft(), "NGN");
    expect(plan).not.toBeNull();
    expect(plan?.patch.currency).toBe("NGN");
    expect(plan?.patch.tickets?.[0].priceGbp).toBeNull();
    expect(plan?.patch.tickets?.[0].isFree).toBe(false);
    expect(plan?.patch.tickets?.[1].isFree).toBe(true);
    expect(plan?.notice).toBe(
      "Your brand now sells in Nigerian naira. Enter your prices again.",
    );
  });

  test("a draft with no currency adopting the brand's FIRST currency: no change here, no notice", () => {
    const draft = baseDraft({ currency: null });
    expect(planDraftCurrencyFollow(draft, "NGN")).toBeNull();
  });

  test("a draft already in step with its brand: nothing", () => {
    expect(planDraftCurrencyFollow(baseDraft({ currency: "NGN" }), "NGN")).toBeNull();
    expect(planDraftCurrencyFollow(baseDraft(), null)).toBeNull();
  });

  test("the server already cleared the prices: tell the host once, and save so the note goes", () => {
    const draft = baseDraft({
      currency: "NGN",
      tickets: [ticket({ id: "t_paid", priceGbp: null, currency: "NGN" })],
    });
    const plan = planDraftCurrencyFollow(draft, "NGN", { from: "GBP", to: "NGN" });
    expect(plan?.notice).toBe(
      "Your brand now sells in Nigerian naira. Enter your prices again.",
    );
    // Nothing to change in the draft itself; the (empty) update still saves.
    expect(plan?.patch).toEqual({});
  });

  test("a published event is never touched", () => {
    const live = baseDraft({ status: "live" as DraftEvent["status"] });
    expect(planDraftCurrencyFollow(live, "NGN", { from: "GBP", to: "NGN" })).toBeNull();
  });
});

describe("#3645 reading a server draft", () => {
  const row = (theme: Record<string, unknown>, currency: string | null): never =>
    ({
      id: "00000000-0000-4000-8000-000000003645",
      brand_id: "00000000-0000-4000-8000-000000000002",
      created_by: "user-1",
      title: "Lagos launch",
      description: null,
      slug: "draft-event",
      currency,
      theme,
      visibility: "draft",
      status: "draft",
      timezone: "Africa/Lagos",
      created_at: "2026-10-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
      published_at: null,
      deleted_at: null,
    }) as never;

  test("the row's own currency outranks the copy inside the draft JSON", () => {
    const draft = serverRowToDraft(row({ business_draft: { currency: "GBP" } }, "NGN"));
    expect(draft.currency).toBe("NGN");
  });

  test("a row with no currency column value still falls back to the JSON copy", () => {
    const draft = serverRowToDraft(row({ business_draft: { currency: "USD" } }, null));
    expect(draft.currency).toBe("USD");
  });

  test("the server's note is read, and anything malformed is no note", () => {
    expect(
      pricesClearedNoteFromTheme({
        business_draft: { pricesClearedForCurrencyChange: { from: "gbp", to: "ngn" } },
      }),
    ).toEqual({ from: "GBP", to: "NGN" });
    expect(pricesClearedNoteFromTheme({ business_draft: {} })).toBeNull();
    expect(
      pricesClearedNoteFromTheme({
        business_draft: { pricesClearedForCurrencyChange: { from: "GBP" } },
      }),
    ).toBeNull();
    expect(pricesClearedNoteFromTheme(null)).toBeNull();
  });

  test("a save's reply records the note beside the draft, and a reply without one forgets it", async () => {
    const draft = baseDraft({ currency: "NGN", tickets: [] });
    mockFrom.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "is"]) builder[method] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: { currency: "NGN", theme: {} }, error: null }),
      );
      return builder;
    });
    const reply = (theme: Record<string, unknown>): void => {
      mockRpc.mockResolvedValueOnce({
        data: {
          event: {
            id: draft.id, brand_id: draft.brandId, created_by: "user-1", title: "x",
            description: null, slug: "draft-event", currency: "NGN", theme,
            visibility: "draft", status: "draft", timezone: "Africa/Lagos",
            created_at: draft.createdAt, updated_at: draft.updatedAt,
            published_at: null, deleted_at: null,
          },
        },
        error: null,
      });
    };
    reply({ business_draft: { pricesClearedForCurrencyChange: { from: "GBP", to: "NGN" } } });
    await autosaveServerDraft(draft, { brandCurrency: "NGN" });
    expect(getPricesClearedNote(draft.id)).toEqual({ from: "GBP", to: "NGN" });

    reply({ business_draft: {} });
    await autosaveServerDraft(draft, { brandCurrency: "NGN" });
    expect(getPricesClearedNote(draft.id)).toBeNull();
  });
});

describe("#3645 a trip package whose price was cleared", () => {
  const marker = { [TRIP_PRICE_CLEARED_KEY]: { from: "GBP", to: "NGN" } };

  test("price 0 with the marker is 'no price yet'; with a price, or without the marker, it is not", () => {
    expect(tierNeedsPriceReentry({ tierMetadata: marker, priceCents: 0 })).toBe(true);
    expect(tierNeedsPriceReentry({ tierMetadata: marker, priceCents: 9000000 })).toBe(false);
    expect(tierNeedsPriceReentry({ tierMetadata: {}, priceCents: 0 })).toBe(false);
    expect(tierNeedsPriceReentry({ tierMetadata: null, priceCents: 0 })).toBe(false);
    expect(tierPriceClearedCurrency(marker)).toBe("NGN");
    expect(tierPriceClearedCurrency({})).toBeNull();
  });

  test("entering a price removes the marker and nothing else", () => {
    const metadata = { description: "Shared room", installments: { deposit_pct: 25 }, ...marker };
    expect(withoutPriceClearedMarker(metadata)).toEqual({
      description: "Shared room",
      installments: { deposit_pct: 25 },
    });
    const plain = { description: "Shared room" };
    expect(withoutPriceClearedMarker(plain)).toBe(plain);
  });

  test("an empty price on a cleared package blocks publish; any typed price, 0 included, does not", () => {
    const pkg = { name: "Standard", capacity: 12, paymentPlan: null };
    const blocked = validateTripPackages([{ ...pkg, priceMajor: "", priceNeedsReentry: true }]);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(
      'Your brand\'s currency changed. Enter the price for "Standard" again before publishing.',
    );
    expect(validateTripPackages([{ ...pkg, priceMajor: "0", priceNeedsReentry: true }]).ok).toBe(true);
    expect(validateTripPackages([{ ...pkg, priceMajor: "90000", priceNeedsReentry: true }]).ok).toBe(true);
    // An ordinary package with an empty price is still a free package.
    expect(validateTripPackages([{ ...pkg, priceMajor: "" }]).ok).toBe(true);
  });

  test("the server's refusal has plain host copy", () => {
    expect(TRIP_PRICE_REENTRY_MESSAGE).toBe(
      "Your brand's currency changed. Enter this package's price again before publishing.",
    );
  });
});

// ---------------------------------------------------------------------------
// Source contracts. The rule only holds if EVERY draft save carries the
// brand's currency, so these fail when a wizard route stops passing it.
// ---------------------------------------------------------------------------
describe("#3645 every wizard save carries the brand's currency", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
  // Comments must not satisfy (or trip) a contract.
  const code = (rel: string): string =>
    read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const productFiles = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (abs: string): void => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const next = path.join(abs, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
          out.push(path.relative(root, next));
        }
      }
    };
    walk(path.join(root, dir));
    return out;
  };
  const allProduct = [...productFiles("app"), ...productFiles("src")];

  test("the autosave hook is only ever mounted WITH the brand currency ref", () => {
    const users = allProduct.filter(
      (rel) =>
        rel !== path.join("src", "hooks", "useServerDraftEvents.ts") &&
        /useServerDraftAutosave\s*\(/.test(code(rel)),
    );
    // The event and RSVP draft routes; a new caller must make the same promise.
    expect(users.sort()).toEqual([
      path.join("app", "event", "[id]", "edit.tsx"),
      path.join("app", "rsvp", "[id]", "edit.tsx"),
    ]);
    for (const rel of users) {
      const text = code(rel);
      const mounts = text.match(/useServerDraftAutosave\s*\(([^)]*)\)/g) ?? [];
      expect(mounts.length).toBeGreaterThan(0);
      for (const mount of mounts) {
        expect(mount.replace(/\s+/g, "")).toBe(
          "useServerDraftAutosave({brandCurrencyRef})",
        );
      }
      // The ref is filled from the brand the route holds, for drafts only.
      expect(text.replace(/\s+/g, " ")).toContain(
        "brandCurrencyRef.current = isEditPublished ? null : brand?.defaultCurrency ?? null;",
      );
    }
  });

  test("the hook hands that currency to the save, and nothing else calls the save", () => {
    const hook = code(path.join("src", "hooks", "useServerDraftEvents.ts"));
    const calls = hook.match(/autosaveServerDraft\s*\([^;]*\);/g) ?? [];
    expect(calls).toHaveLength(1);
    // Rework: the brand's currency is asked of the server; the value this
    // device holds rides along only as the last resort.
    expect((calls[0] ?? "").replace(/\s+/g, "")).toBe(
      "autosaveServerDraft(draft,{brandCurrency:awaitreadFreshBrandCurrency(draft.id),serverRowWins:true,cachedBrandCurrency:brandCurrencyRef?.current??null,});",
    );
    const otherCallers = allProduct.filter(
      (rel) =>
        rel !== path.join("src", "hooks", "useServerDraftEvents.ts") &&
        rel !== path.join("src", "services", "eventDrafts.ts") &&
        /autosaveServerDraft\s*\(/.test(code(rel)),
    );
    expect(otherCallers).toEqual([]);
  });

  test("both draft routes adopt the brand's currency when a draft opens, and can show the notice", () => {
    for (const rel of [
      path.join("app", "event", "[id]", "edit.tsx"),
      path.join("app", "rsvp", "[id]", "edit.tsx"),
    ]) {
      const text = code(rel).replace(/\s+/g, "");
      expect(text).toContain(
        "useDraftFollowsBrandCurrency({draft:isEditPublished?null:draft,onSave:handleAutosaveDraft,onNotice:showPricesClearedNotice,});",
      );
      // The notice is shown by a Toast rendered BESIDE the wizard; without it
      // the route's message would be set and never seen.
      const wizardReturn = text.slice(text.lastIndexOf("return(<>"));
      expect(wizardReturn).toMatch(/CreatorWizard/);
      expect(wizardReturn).toContain("<Toastvisible={toast.visible}");
    }
  });

  test("the trip wizard opens a cleared package empty, says why, and clears the marker on a typed price", () => {
    const wizard = code(path.join("src", "components", "trip", "TripCreatorWizard.tsx"));
    // The wizard's inline rule and the shared helper name the same marker.
    expect(wizard).toContain(`tier.tierMetadata?.["${TRIP_PRICE_CLEARED_KEY}"]`);
    expect(wizard).toContain('priceMajor: needsReentry ? "" : (tier.priceCents / 100).toFixed(2)');
    expect(wizard).toContain(
      `showToast("Your brand's currency changed. Enter your package prices again.")`,
    );
    expect(wizard.replace(/\s+/g, "")).toContain(
      "...(pkg.priceNeedsReentry===true&&pkg.priceMajor.trim().length>0?{priceEntered:true}:{})",
    );
    const service = code(path.join("src", "services", "tripsService.ts"));
    expect(service.replace(/\s+/g, "")).toContain(
      "if(patch.priceEntered===true){nextMetadata=withoutPriceClearedMarker(nextMetadata);}",
    );
    const review = code(path.join("src", "components", "trip", "TripCreatorStep5Review.tsx"));
    expect(review).toContain("case TRIP_PRICE_REENTRY_REQUIRED_CODE:");
    const step4 = code(path.join("src", "components", "trip", "TripCreatorStep4Pricing.tsx"));
    // A cleared price is never labelled "Free package", and the step names the
    // new currency.
    expect(step4).toContain("priceCents === 0 && !priceAwaitingReentry");
    expect(step4).toContain("{pricesClearedNotice(draft.currency)}");
    // The line the pricing step has always carried stays true and stays put.
    expect(step4).toContain(
      "Currency comes from your brand setup and can&apos;t be changed here.",
    );
  });

  test("the experience wizard is left out of this change", () => {
    const text = code(
      path.join("src", "components", "experience", "ExperienceCreatorWizard.tsx"),
    );
    expect(text).not.toContain("brandCurrencyRef");
    expect(text).not.toContain("useDraftFollowsBrandCurrency");
    expect(text).not.toContain("adoptBrandCurrencyForDraft");
  });
});
