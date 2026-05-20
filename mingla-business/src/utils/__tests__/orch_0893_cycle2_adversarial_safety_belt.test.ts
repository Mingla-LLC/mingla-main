// orch_0893_cycle2_adversarial_safety_belt.test
// TESTER-AUTHORED adversarial regression test for ORCH-0893 cycle 2.
//
// DIFFERENT ANGLE FROM IMPLEMENTOR'S CYCLE-2 TEST:
// The implementor's `orch_0893_cycle2_legacy_loop_skips_untouched.test.ts`
// is source-contract style (grep tokens in the source). This adversarial
// is BEHAVIORAL — it exercises the safety-belt scan logic and the
// legacy-loop filter semantics with synthetic fixtures. Catches drift
// between the documented spec and the impl, AND catches edge cases
// (multi-brand cache, missing legacyLocalDraftId, empty cache) that the
// source-contract test cannot.
//
// Replica functions below mirror the cycle-2 production logic at:
//   - src/hooks/useServerDraftEvents.ts:107-119 (Part 1 filter)
//   - app/event/[id]/edit.tsx:213-239 (Part 2 safety-belt scan)
//
// The implementor's source-contract test pins WHICH tokens appear in the
// source. This adversarial pins WHAT THE LOGIC ACTUALLY DOES given
// realistic inputs. The two together form a drift-proof pair.

import { describe, expect, test } from "@jest/globals";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { isDraftDirty } from "../draftDirtyCheck";

// Synthetic DraftEvent fixture — mirrors the pattern in
// draftDirtyCheck.test.ts to avoid the Supabase/Expo runtime chain.
const draft = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "d_test",
  brandId: "b_test",
  serverSlug: null,
  name: "",
  description: "",
  format: "in_person",
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
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: null,
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
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
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  ...overrides,
});

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "t_test",
  name: "Standard",
  priceGbp: 10,
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
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

// Replica of the cycle-2 Part 1 filter in src/hooks/useServerDraftEvents.ts
// lines 107-119. Catches drift in the documented behaviour.
function legacyMigrationFilter(
  drafts: DraftEvent[],
  brandId: string,
): DraftEvent[] {
  return drafts.filter(
    (d) =>
      d.brandId === brandId && d.id.startsWith("d_") && isDraftDirty(d),
  );
}

// Replica of the cycle-2 Part 2 safety-belt scan from
// app/event/[id]/edit.tsx:220-237. Returns the swapped server uuid (string)
// if a server draft with `legacyLocalDraftId === idParam` is found in any
// brand-draft cache list; returns null otherwise.
function safetyBeltScan(
  cacheLists: Array<DraftEvent[]>,
  idParam: string,
): string | null {
  for (const drafts of cacheLists) {
    if (!Array.isArray(drafts)) continue;
    const swapped = drafts.find(
      (d) =>
        (d as DraftEvent & { legacyLocalDraftId?: string })
          .legacyLocalDraftId === idParam,
    );
    if (swapped !== undefined) return swapped.id;
  }
  return null;
}

describe("ORCH-0893 cycle 2 Part 1 — legacy migration filter behavioural", () => {
  test("untouched freshly-minted d_* draft is SKIPPED (the operator-reported bug fix)", () => {
    const freshDraft = draft({ id: "d_abc123", brandId: "b_test" });
    const result = legacyMigrationFilter([freshDraft], "b_test");
    expect(result).toEqual([]);
  });

  test("dirty d_* draft passes the filter (legacy abandoned-typing case)", () => {
    const dirtyDraft = draft({
      id: "d_xyz789",
      brandId: "b_test",
      name: "My abandoned event",
    });
    const result = legacyMigrationFilter([dirtyDraft], "b_test");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("d_xyz789");
  });

  test("server-id draft is skipped regardless of dirty state (filter only targets d_*)", () => {
    const serverDraft = draft({
      id: "srv-uuid-1",
      brandId: "b_test",
      name: "Server event",
    });
    const result = legacyMigrationFilter([serverDraft], "b_test");
    expect(result).toEqual([]);
  });

  test("d_* draft from DIFFERENT brand is skipped (brand-scoped)", () => {
    const otherBrandDraft = draft({
      id: "d_other_brand",
      brandId: "b_other",
      name: "Cross-brand draft",
    });
    const result = legacyMigrationFilter([otherBrandDraft], "b_test");
    expect(result).toEqual([]);
  });

  test("mixed array: only matching brand + d_* + dirty drafts pass", () => {
    const mixed = [
      draft({ id: "d_fresh", brandId: "b_test" }), // untouched — skip
      draft({ id: "d_dirty", brandId: "b_test", name: "typed" }), // pass
      draft({ id: "srv-uuid", brandId: "b_test", name: "server" }), // not d_* — skip
      draft({ id: "d_other", brandId: "b_other", name: "other brand" }), // wrong brand — skip
    ];
    const result = legacyMigrationFilter(mixed, "b_test");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("d_dirty");
  });

  test("EVERY user-meaningful dirty signal independently flips a d_* draft into the filter (no field forgotten)", () => {
    const baseId = "d_test_abc";
    const baseBrand = "b_test";
    const dirtyVariants: Array<{ label: string; patch: Partial<DraftEvent> }> = [
      { label: "name", patch: { name: "X" } },
      { label: "description", patch: { description: "X" } },
      { label: "coverMediaUrl", patch: { coverMediaUrl: "https://x.com" } },
      { label: "tickets", patch: { tickets: [ticket()] } },
      { label: "date", patch: { date: "2026-06-01" } },
      { label: "doorsOpen", patch: { doorsOpen: "19:00" } },
      { label: "endsAt", patch: { endsAt: "22:00" } },
      { label: "venueName", patch: { venueName: "Spot" } },
      { label: "address", patch: { address: "1 St" } },
      { label: "onlineUrl", patch: { onlineUrl: "https://zoom" } },
      { label: "lastStepReached", patch: { lastStepReached: 1 } },
      { label: "partyTypes", patch: { partyTypes: ["dinner"] } },
      { label: "vibeTags", patch: { vibeTags: ["chill"] } },
      { label: "musicGenres", patch: { musicGenres: ["jazz"] } },
      { label: "format", patch: { format: "online" } },
    ];
    for (const { label, patch } of dirtyVariants) {
      const d = draft({ id: baseId, brandId: baseBrand, ...patch });
      const result = legacyMigrationFilter([d], baseBrand);
      expect(result.length).toBe(1);
      if (result.length !== 1) {
        // helpful failure context
        throw new Error(`Field "${label}" did not flip draft to dirty`);
      }
    }
  });
});

describe("ORCH-0893 cycle 2 Part 2 — safety-belt scan behavioural", () => {
  test("scan finds swapped server draft via legacyLocalDraftId match → returns server uuid", () => {
    const swappedDraft = {
      ...draft({ id: "srv-uuid-99" }),
      legacyLocalDraftId: "d_abc123",
    } as DraftEvent & { legacyLocalDraftId: string };

    const cacheLists = [[swappedDraft]];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBe("srv-uuid-99");
  });

  test("scan returns null when no draft matches the d_* id (falls through to bounce-home)", () => {
    const otherDraft = {
      ...draft({ id: "srv-uuid-99" }),
      legacyLocalDraftId: "d_different_id",
    } as DraftEvent & { legacyLocalDraftId: string };

    const cacheLists = [[otherDraft]];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBeNull();
  });

  test("scan returns null when cache is empty (no brand-draft queries fired yet)", () => {
    const result = safetyBeltScan([], "d_abc123");
    expect(result).toBeNull();
  });

  test("scan returns null when brand-draft cache exists but contains NO drafts with legacyLocalDraftId (all directly-server-created)", () => {
    const serverOnlyDrafts = [
      draft({ id: "srv-uuid-1" }),
      draft({ id: "srv-uuid-2" }),
    ];
    const cacheLists = [serverOnlyDrafts];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBeNull();
  });

  test("scan finds swap across MULTIPLE brand-draft cache lists (operator has more than one brand)", () => {
    const brandACache = [draft({ id: "srv-brand-a" })];
    const brandBCache = [
      {
        ...draft({ id: "srv-brand-b-99" }),
        legacyLocalDraftId: "d_abc123",
      } as DraftEvent & { legacyLocalDraftId: string },
    ];
    const cacheLists = [brandACache, brandBCache];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBe("srv-brand-b-99");
  });

  test("scan returns FIRST match if multiple drafts share the same legacyLocalDraftId (defensive — should not happen in practice)", () => {
    const firstMatch = {
      ...draft({ id: "srv-uuid-FIRST" }),
      legacyLocalDraftId: "d_abc123",
    } as DraftEvent & { legacyLocalDraftId: string };
    const secondMatch = {
      ...draft({ id: "srv-uuid-SECOND" }),
      legacyLocalDraftId: "d_abc123",
    } as DraftEvent & { legacyLocalDraftId: string };

    const cacheLists = [[firstMatch, secondMatch]];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBe("srv-uuid-FIRST");
  });

  test("scan gracefully handles non-array entries in cacheLists (React Query returns undefined for empty caches)", () => {
    // Simulates queryClient.getQueriesData returning some [queryKey, undefined] tuples.
    const cacheLists = [
      undefined as unknown as DraftEvent[],
      [
        {
          ...draft({ id: "srv-uuid-99" }),
          legacyLocalDraftId: "d_abc123",
        } as DraftEvent & { legacyLocalDraftId: string },
      ],
    ];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBe("srv-uuid-99");
  });

  test("scan does NOT confuse drafts with same id but different legacyLocalDraftId", () => {
    // A draft whose `id` happens to equal the idParam being searched —
    // but it has no legacyLocalDraftId mapping it back. The scan must NOT
    // match on `id`; it must ONLY match on `legacyLocalDraftId`.
    const trapDraft = draft({ id: "d_abc123" }); // no legacyLocalDraftId field
    const cacheLists = [[trapDraft]];
    const result = safetyBeltScan(cacheLists, "d_abc123");
    expect(result).toBeNull();
  });
});

describe("ORCH-0893 cycle 2 integration — the actual bug flow Seth reported", () => {
  test("operator-reproducer: untouched d_* mint → legacy filter skips it → wizard stays mounted", () => {
    // Step 1: /event/create mints a fresh d_xxx via Zustand
    //         createDraft(brandId). The draft is the cold default.
    const freshlyMinted = draft({ id: "d_orch_0893_repro", brandId: "b_active" });

    // Step 2: home tab's useServerDraftsForBrand picks up the new draft.
    //         Pre-cycle-2: filter MATCHED → createServerDraft fired → replaceDraft
    //         removed d_xxx → edit route bounced home.
    //         Post-cycle-2: filter SKIPS the untouched draft.
    const filterResult = legacyMigrationFilter([freshlyMinted], "b_active");
    expect(filterResult).toEqual([]);

    // Step 3: with the legacy loop skipping the draft, Zustand still
    //         contains d_xxx. The edit route's useDraftById(d_xxx) finds it.
    //         No bounce-home. The wizard stays mounted.
    // This is the structural close of the operator-reported bug.
  });

  test("safety-belt covers the edge case where a parallel tab or future race STILL removes d_*", () => {
    // Defensive belt-and-suspenders: if some other code path managed
    // to migrate d_xxx away (a parallel browser tab, a future race not
    // covered by Part 1), the bounce-home guard's safety belt scans
    // cached brand-drafts for a swapped server draft and navigates to
    // its server uuid INSTEAD of bouncing home.
    const wasSwappedServerDraft = {
      ...draft({ id: "srv-recovered-uuid" }),
      legacyLocalDraftId: "d_orch_0893_repro",
    } as DraftEvent & { legacyLocalDraftId: string };

    const cacheState = [[wasSwappedServerDraft]];
    const swappedUuid = safetyBeltScan(cacheState, "d_orch_0893_repro");

    // The safety belt finds the swap and returns the server uuid for
    // router.replace, instead of returning null (which would trigger
    // bounce-home). User lands on the correct edit URL transparently.
    expect(swappedUuid).toBe("srv-recovered-uuid");
  });
});
