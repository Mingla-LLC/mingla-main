/**
 * META-ORCH-1255(tester) — ADVERSARIAL regression suite (tester-owned).
 *
 * Attacks angles the implementors' happy-path suites do NOT cover:
 *  A1 — listingStatusView admin-decision PRECEDENCE (suspended / revoked /
 *       rejected-beats-deck_eligible / verified-beats-needs_fix): a wrong
 *       precedence order would show "Live on Mingla" on a suspended venue.
 *  A2 — businessTodos multi-venue band NEGATIVES: the live-hook shape
 *       (venuePipelines present) must make the legacy `add_venue` nag
 *       UNREACHABLE even when the legacy flags are maliciously set; a
 *       deck_eligible venue must produce NO get_venue_live row; a follow_up
 *       claim with 0 open items must NOT escalate to "Updates requested".
 *  A3 — draftVenueStore v2: reset() no-arg wipes ACTIVE + PARKED drafts
 *       (Constitution #6 logout path); reset(brandA) must not touch parked
 *       brand B; activateBrand round-trip preserves field data.
 *  A4 — anon read-path isolation (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-
 *       SAFE, behavioral half): getPublicVenueBySlug / fetchPublicBrandVenues
 *       must query ONLY venue_public_view (never venue_listings, never
 *       brands); a view miss (pending/draft/unknown venue) returns null (the
 *       single not-found state — no state leak); a PostgREST error THROWS
 *       (no silent empty success); malformed hours jsonb cannot crash the
 *       mapper or fabricate hours rows.
 *  A5 — ORCH-1256 `?section=` deep-link survives the toggle removal: the
 *       closed BrandEditSection set still validates in the route wrapper and
 *       contains NO physical-location target.
 *  A6 — [TRANSITIONAL-1] client shim seam: the slots hook passes p_venue_id
 *       whenever a venue is in scope; the legacy p_brand_id arm is reachable
 *       ONLY when venueId is null.
 *  A7 — per-venue ops write seams: tables INSERT and settings UPSERT carry
 *       venue_id and fail fast (`venue_required`) without a venue — the
 *       client-side half of the cross-brand-splice defense.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const BIZ = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(BIZ, rel), "utf8");

// ---- node-env neutralizers (default ts-jest config has no RN runtime) ----
jest.mock("react-native", () => ({
  __esModule: true,
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Pressable: () => null,
  Text: () => null,
  View: () => null,
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

// ---- supabase client mock (A4) --------------------------------------------
const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../src/services/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    __esModule: true,
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);

// Import AFTER the mocks.
import { listingStatusView } from "../src/utils/listingStatus";
import { buildBusinessTodos } from "../src/utils/businessTodos";
import { useDraftVenueStore } from "../src/store/draftVenueStore";
import {
  getPublicVenueBySlug,
  fetchPublicBrandVenues,
  venuePublicViewRowToPublicVenue,
} from "../src/services/publicEventsService";

// ---------------------------------------------------------------------------
// A1 — listingStatusView precedence
// ---------------------------------------------------------------------------
describe("A1 — listing status admin-decision precedence", () => {
  test("suspended venue NEVER shows Live, whatever the pipeline says", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "suspended",
    });
    expect(v.label).toBe("Suspended");
    expect(v.tone).toBe("warning");
  });

  test("revoked venue shows Removed (warning), not Draft/Live", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: null,
      claimStatus: "revoked",
    });
    expect(v.label).toBe("Removed");
    expect(v.tone).toBe("warning");
  });

  test("rejected claim beats a deck_eligible pipeline (Changes needed)", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "rejected",
    });
    expect(v.label).toBe("Changes needed");
    expect(v.tone).toBe("warning");
  });

  test("verified claim beats a needs_fix pipeline (Live on Mingla)", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "needs_fix",
      claimStatus: "verified",
    });
    expect(v.label).toBe("Live on Mingla");
    expect(v.tone).toBe("success");
  });

  test("pending_review claim shows In review even with a null pipeline", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: null,
      claimStatus: "pending_review",
    });
    expect(v.label).toBe("In review");
    expect(v.tone).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// A2 — businessTodos multi-venue negatives
// ---------------------------------------------------------------------------
const TODO_BASE = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  brandCount: 1,
  counts: { total: 1, live: 1, draft: 0 },
  pipelineFetched: true,
  pipelineStatus: null,
  pipelineRoute: "/venue/create",
  venueDraftInProgress: false,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
} as const;

describe("A2 — per-venue to-do band negatives", () => {
  test("live-hook shape kills add_venue even with hostile legacy flags", () => {
    const todos = buildBusinessTodos({
      ...TODO_BASE,
      hasPhysicalLocation: true, // hostile legacy input — must be inert
      venuePipelines: [],
      venueClaims: [],
    } as never);
    expect(todos.map((t) => t.id)).not.toContain("add_venue");
    expect(todos.map((t) => t.id)).not.toContain("get_venue_live");
  });

  test("two needs_fix venues → two NAMED rows, ids venue-suffixed", () => {
    const todos = buildBusinessTodos({
      ...TODO_BASE,
      venuePipelines: [
        { venueId: "vA", venueName: "Alpha", status: "needs_fix", route: "/a" },
        { venueId: "vB", venueName: "Beta", status: "needs_fix", route: "/b" },
      ],
      venueClaims: [],
    } as never);
    const rows = todos.filter((t) => t.id.startsWith("get_venue_live:"));
    expect(rows.map((t) => t.id).sort()).toEqual([
      "get_venue_live:vA",
      "get_venue_live:vB",
    ]);
    expect(rows[0].label).toContain("Alpha");
    expect(rows[1].label).toContain("Beta");
  });

  test("a deck_eligible venue produces NO get_venue_live row", () => {
    const todos = buildBusinessTodos({
      ...TODO_BASE,
      venuePipelines: [
        {
          venueId: "vA",
          venueName: "Alpha",
          status: "deck_eligible",
          route: "/a",
        },
      ],
      venueClaims: [],
    } as never);
    expect(todos.some((t) => t.id.startsWith("get_venue_live"))).toBe(false);
  });

  test("follow_up claim with 0 open items stays a plain review row (no badge)", () => {
    const todos = buildBusinessTodos({
      ...TODO_BASE,
      venuePipelines: [],
      venueClaims: [
        {
          venueId: "vA",
          venueName: "Alpha",
          variant: "follow_up",
          openCount: 0,
          route: "/r",
          feedbackRoute: "/r?focus=feedback",
        },
      ],
    } as never);
    const row = todos.find((t) => t.id === "venue_claim_review:vA");
    expect(row).toBeDefined();
    expect(row?.label).not.toContain("Updates requested");
    expect((row as { badge?: string }).badge).toBeUndefined();
    // 0 open items must route to the PLAIN listing, not the feedback sheet.
    expect((row?.action as { route: string }).route).toBe("/r");
  });
});

// ---------------------------------------------------------------------------
// A3 — draftVenueStore v2 reset scoping
// ---------------------------------------------------------------------------
describe("A3 — per-brand draft store reset scoping", () => {
  test("reset(brandA) preserves parked brand B; reset() wipes everything", () => {
    const store = useDraftVenueStore.getState();
    store.reset(); // clean slate

    // Brand A draft.
    useDraftVenueStore.getState().activateBrand("brand-A");
    useDraftVenueStore.setState({ displayName: "Alpha Venue" });
    // Park A, activate B.
    useDraftVenueStore.getState().activateBrand("brand-B");
    expect(useDraftVenueStore.getState().displayName).not.toBe("Alpha Venue");
    useDraftVenueStore.setState({ displayName: "Beta Venue" });

    // reset(A) — the PARKED A draft dies, active B survives.
    useDraftVenueStore.getState().reset("brand-A");
    expect(useDraftVenueStore.getState().displayName).toBe("Beta Venue");
    useDraftVenueStore.getState().activateBrand("brand-A");
    expect(useDraftVenueStore.getState().displayName).toBe("");

    // Rebuild both, then no-arg reset (logout, Constitution #6): ALL gone.
    useDraftVenueStore.setState({ displayName: "Alpha again" });
    useDraftVenueStore.getState().activateBrand("brand-B");
    useDraftVenueStore.setState({ displayName: "Beta again" });
    useDraftVenueStore.getState().reset();
    expect(useDraftVenueStore.getState().displayName).toBe("");
    // [TEST-MOD-APPROVED #1685] `drafts` is a draft-id-keyed LIST now, not a
    // per-brand record. The assertion's INTENT — logout wipes EVERYTHING
    // (Constitution #6) — is preserved exactly.
    expect(useDraftVenueStore.getState().drafts).toEqual([]);
  });

  test("activateBrand round-trip preserves parked field data", () => {
    useDraftVenueStore.getState().reset();
    useDraftVenueStore.getState().activateBrand("b1");
    useDraftVenueStore.setState({
      displayName: "Round Trip",
      city: "Lisbon",
    });
    useDraftVenueStore.getState().activateBrand("b2");
    useDraftVenueStore.getState().activateBrand("b1");
    const s = useDraftVenueStore.getState();
    expect(s.displayName).toBe("Round Trip");
    expect(s.city).toBe("Lisbon");
    useDraftVenueStore.getState().reset();
  });
});

// ---------------------------------------------------------------------------
// A4 — anon read-path isolation (behavioral)
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };
const chainFor = (result: QueryResult) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.order = jest.fn(async () => result);
  chain.maybeSingle = jest.fn(async () => result);
  return chain;
};

describe("A4 — anon venue reads flow ONLY through venue_public_view", () => {
  test("getPublicVenueBySlug: view-only; a view miss is null (not-found), no table fallback", async () => {
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => chainFor({ data: null, error: null }));
    const out = await getPublicVenueBySlug("brandx", "pendingvenue");
    expect(out).toBeNull();
    const tables = mockFrom.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(["venue_public_view"]);
    expect(tables).not.toContain("venue_listings");
    expect(tables).not.toContain("brands");
  });

  test("getPublicVenueBySlug: a PostgREST error THROWS (no silent empty success)", async () => {
    mockFrom.mockReset();
    mockFrom.mockImplementation(() =>
      chainFor({ data: null, error: { code: "42501", message: "denied" } }),
    );
    await expect(getPublicVenueBySlug("b", "v")).rejects.toBeTruthy();
  });

  test("fetchPublicBrandVenues: view-only; error THROWS; [] on no rows", async () => {
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => chainFor({ data: [], error: null }));
    const out = await fetchPublicBrandVenues("brandx");
    expect(out).toEqual([]);
    expect(mockFrom.mock.calls.map((c) => c[0])).toEqual(["venue_public_view"]);

    mockFrom.mockReset();
    mockFrom.mockImplementation(() =>
      chainFor({ data: null, error: { message: "boom" } }),
    );
    await expect(fetchPublicBrandVenues("brandx")).rejects.toBeTruthy();
  });

  test("malformed hours jsonb cannot crash the mapper or fabricate rows", () => {
    const base = {
      id: "v1",
      brand_id: "b1",
      brand_slug: "bs",
      brand_name: "B",
      slug: "v",
      name: "V",
      address: null,
      city: null,
      country_code: null,
      lat: 0,
      lng: 0,
      venue_category: "restaurant",
      google_place_id: null,
      contact_email: null,
      contact_phone: null,
      cover_media_url: null,
      cover_media_type: null,
      place_pool_id: null,
      theme_color: null,
      theme_font: null,
      theme_animation: null,
      cover_hue: 25,
      default_currency: null,
      pool_photo_urls: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    for (const hostileHours of [
      "not-an-array",
      42,
      { weekday: 1 },
      [{ weekday: 99, open_time: "09:00" }, "junk", null],
      null,
    ]) {
      const mapped = venuePublicViewRowToPublicVenue({
        ...base,
        hours: hostileHours,
      } as never);
      expect(Array.isArray(mapped.hours)).toBe(true);
      // weekday 99 / junk items are dropped, never fabricated into rows.
      expect(mapped.hours.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A5 — ORCH-1256 ?section= deep-links survive the toggle removal (source)
// ---------------------------------------------------------------------------
describe("A5 — BrandEditView section deep-links post-toggle-removal", () => {
  const routeSrc = read("app/brand/[id]/edit.tsx");
  const viewSrc = read("src/components/brand/BrandEditView.tsx");

  test("route wrapper still validates ?section= against the closed set and wires initialSection", () => {
    expect(routeSrc).toContain("isBrandEditSection(");
    expect(routeSrc).toContain("initialSection=");
  });

  test("the closed section set has NO physical-location target", () => {
    const m = viewSrc.match(
      /export type BrandEditSection =([\s\S]*?);/,
    );
    expect(m).not.toBeNull();
    const union = (m as RegExpMatchArray)[1];
    for (const sec of ["photo", "about", "cover", "address", "contact", "social"]) {
      expect(union).toContain(`"${sec}"`);
    }
    expect(union).not.toMatch(/physical|location|venue/);
  });

  test("BrandEditView keeps section anchors (onLayout handlers) for the deep-link scroller", () => {
    expect(viewSrc).toContain('handleSectionLayout("photo")');
    expect(viewSrc).toContain('handleSectionLayout("about")');
    // And the removed block stayed removed:
    expect(viewSrc).not.toContain("hasPhysicalLocation");
    expect(viewSrc).not.toContain("handleClaimVenue");
  });
});

// ---------------------------------------------------------------------------
// A6 — [TRANSITIONAL-1] slots shim seam (source)
// ---------------------------------------------------------------------------
describe("A6 — slots RPC venue-first, brand arm only when venueId is null", () => {
  const src = read("src/hooks/useVenueAvailability.ts");

  test("venue scope wins; legacy p_brand_id only without a venue", () => {
    const idx = src.indexOf("p_venue_id");
    const brandIdx = src.indexOf("p_brand_id");
    expect(idx).toBeGreaterThan(-1);
    expect(brandIdx).toBeGreaterThan(-1);
    // The ternary shape: venueId present → p_venue_id, else p_brand_id.
    expect(src).toMatch(
      /venueId[\s\S]{0,200}\?\s*\{\s*p_venue_id[\s\S]{0,120}:\s*\{\s*p_brand_id/,
    );
  });
});

// ---------------------------------------------------------------------------
// A7 — per-venue ops write seams (source)
// ---------------------------------------------------------------------------
describe("A7 — ops writes carry venue_id and fail fast without one", () => {
  test("venue tables INSERT is venue-keyed + venue_required guard", () => {
    const src = read("src/hooks/useVenueTables.ts");
    expect(src).toContain('throw new Error("venue_required")');
    expect(src).toMatch(/venue_id:\s*venueId/);
  });

  test("reservation settings UPSERT keys on venue_id (PK moved brand→venue)", () => {
    const src = read("src/hooks/useVenueReservationSettings.ts");
    expect(src).toContain('throw new Error("venue_required")');
    expect(src).toContain('onConflict: "venue_id"');
  });
});
