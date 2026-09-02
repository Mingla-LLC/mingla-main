/**
 * META-ORCH-1255 Leg C — implementor HAPPY-PATH regression tests
 * (SPEC §7 T-C1 service+route halves, SC-12 Locations feed, the vercel bot
 * rewrite, the T-C3 admin re-point static half, and the D-B/D-C/app-mobile
 * discovery-fix seams). The tester owns the adversarial angles
 * (T-C2 runtime / T-C4 / T-C5 + the logged-out browser run post-deploy).
 *
 * FAILS-ON-REVERT (proven by TRUE LINE DELETION, see the implementation
 * report):
 *  - deleting app/b/[brandSlug]/v/[venueSlug].tsx → the route-contract
 *    assertions FAIL (SPEC §9: "deleting the venue route file fails T-C1");
 *  - re-pointing adminClaimsService at from("brands") → the admin re-point
 *    assertions FAIL (SPEC §9: "re-pointing admin at from('brands') fails
 *    ... T-C3");
 *  - deleting the /b/:brandSlug/v/:venueSlug vercel rewrite → the bot-rewrite
 *    assertion FAILS;
 *  - deleting the p_venue_id arg from the reservation pricing call (D-B) or
 *    the venue cover target (D-C) → their seam assertions FAIL.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const BIZ = join(__dirname, "..");
const REPO = join(BIZ, "..");
const read = (rel: string): string => readFileSync(join(REPO, rel), "utf8");

// ---- T-C1 (service half): venue_public_view read + mapping ----------------

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../src/services/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
// The workspace package does not resolve under the default node/ts-jest
// config (pre-existing — publicEventsService.ve4.test.ts fails the same way
// on origin/main). Mock ONLY the runtime symbols publicEventsService touches;
// type-only imports are erased at compile time.
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

import {
  getPublicVenueBySlug,
  fetchPublicBrandVenues,
} from "../src/services/publicEventsService";

const venueViewRow = (patch: Record<string, unknown> = {}) => ({
  id: "venue-1",
  brand_id: "brand-1",
  brand_slug: "casanoble",
  brand_name: "Casa Noble",
  slug: "downtown",
  name: "Casa Noble Downtown",
  address: "12 Harbor Way",
  city: "Lisbon",
  country_code: "PT",
  lat: 38.7,
  lng: -9.14,
  venue_category: "restaurant",
  google_place_id: "gp-1",
  contact_email: "hello@casanoble.example",
  contact_phone: "+351210000000",
  cover_media_url: "https://cdn.example.com/venue-cover.jpg",
  cover_media_type: "image",
  place_pool_id: "pool-1",
  theme_color: null,
  theme_font: null,
  theme_animation: null,
  cover_hue: 120,
  default_currency: "EUR",
  hours: [
    { weekday: 0, open_time: "09:00", close_time: "17:00", is_closed: false },
    { weekday: 6, open_time: null, close_time: null, is_closed: true },
  ],
  pool_photo_urls: ["https://pool.example.com/a.jpg"],
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  ...patch,
});

const viewQuery = <T,>(result: { data: T; error: Error | null }) => {
  const q = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    order: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
  };
  return q;
};

describe("T-C1 service half — getPublicVenueBySlug reads ONLY venue_public_view", () => {
  test("verified venue maps name / hours / photos / brand backlink fields", async () => {
    const q = viewQuery({ data: venueViewRow(), error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "venue_public_view") return q;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const venue = await getPublicVenueBySlug("casanoble", "downtown");

    expect(mockFrom).toHaveBeenCalledWith("venue_public_view");
    expect(q.eq).toHaveBeenCalledWith("brand_slug", "casanoble");
    expect(q.eq).toHaveBeenCalledWith("slug", "downtown");
    expect(venue).not.toBeNull();
    expect(venue).toMatchObject({
      name: "Casa Noble Downtown",
      brandSlug: "casanoble",
      brandName: "Casa Noble",
      city: "Lisbon",
      defaultCurrency: "EUR",
      placePoolId: "pool-1",
    });
    // Hours agg parsed with the proven claimed-view parser (byte-identical fmt).
    expect(venue?.hours).toEqual([
      { weekday: 0, isClosed: false, openTime: "09:00", closeTime: "17:00" },
      { weekday: 6, isClosed: true, openTime: null, closeTime: null },
    ]);
    // [TEST-MOD-APPROVED #1561] — this asserted the pool photographs were
    // DROPPED whenever a cover existed ("never additive"). That behaviour is
    // the defect #1550 Leg C measured on live production: the operator's whole
    // uploaded gallery was fetched by `venue_public_view` and thrown away one
    // line before it was read, leaving a `PHOTOS` heading — plural — over a
    // single 240x180 duplicate of the hero. #1561 deletes the early return.
    //
    // The ORDER is the contract and is what this now pins, and the assertion is
    // strictly stronger: it names every element and its position rather than
    // asserting a list of one.
    expect(venue?.galleryPhotoUrls).toEqual([
      "https://cdn.example.com/venue-cover.jpg",
      "https://pool.example.com/a.jpg",
    ]);
  });

  test("missing/not-live venue → null (single not-found state, no leak)", async () => {
    const q = viewQuery({ data: null, error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => q);
    await expect(getPublicVenueBySlug("casanoble", "ghost")).resolves.toBeNull();
  });
});

describe("SC-12 — fetchPublicBrandVenues feeds the Locations section", () => {
  test("maps summary rows; cover wins over pool photo; empty → []", async () => {
    const q = viewQuery({
      data: [
        {
          id: "venue-1",
          slug: "downtown",
          name: "Casa Noble Downtown",
          address: "12 Harbor Way",
          city: "Lisbon",
          cover_media_url: null,
          pool_photo_urls: ["https://pool.example.com/a.jpg"],
        },
      ],
      error: null,
    });
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "venue_public_view") return q;
      throw new Error(`Unexpected table ${String(table)}`);
    });
    const rows = await fetchPublicBrandVenues("casanoble");
    expect(rows).toEqual([
      {
        id: "venue-1",
        slug: "downtown",
        name: "Casa Noble Downtown",
        address: "12 Harbor Way",
        city: "Lisbon",
        photoUrl: "https://pool.example.com/a.jpg",
      },
    ]);

    const empty = viewQuery({ data: [], error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => empty);
    await expect(fetchPublicBrandVenues("casanoble")).resolves.toEqual([]);
  });
});

// ---- T-C1 (route half): the anon route file contract ----------------------

describe("T-C1 route half — /b/[brandSlug]/v/[venueSlug] anon route", () => {
  const routeSrc = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
  // [TEST-MOD-APPROVED #1559] — the buyer-web venue BODY moved to
// `packages/brand-rendering/PublicVenueScreen.tsx` (a pure move: render parity
// proven by publicVenueRenderParity.issue1559.happy.test.tsx). These assertions
// follow the code; the contract each one pins is unchanged.
  const pageSrc = read("packages/brand-rendering/PublicVenueScreen.tsx");

  test("route mounts the venue page + single not-found state, venue-keyed", () => {
    expect(routeSrc).toContain("usePublicVenueBySlug");
    expect(routeSrc).toContain("PublicVenueScreen");
    expect(routeSrc).toContain("PublicVenueNotFound");
    expect(routeSrc).toContain('offering_type: "venue"');
  });

  test("anon-route rule: NO auth hook anywhere in the chain", () => {
    // Strip comments so the assertion bites on real CODE only (the route's
    // doc header legitimately NAMES the rule).
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(stripComments(routeSrc)).not.toContain("useAuth");
    expect(stripComments(pageSrc)).not.toContain("useAuth");
  });

  test("page reads the server static-map proxy + fail-closed reserve gate", () => {
    expect(pageSrc).toContain("buildStaticMapUrl");
    // Fail-safe: no map URL → block hidden (never a fabricated tile).
    expect(pageSrc).toContain("staticMapUrl !== null");
    // Reserve: bar ONLY when the display gate is affirmatively true.
    expect(pageSrc).toContain("reservable.reservable === true");
    // Currency-aware menu via the ONE shared renderer.
    expect(pageSrc).toContain("PublicMenuSections");
  });
});

// ---- SC-11 unified public route + retired-host compatibility ---------------

describe("UA-independent venue discovery and Business compatibility", () => {
  test("/b/:brandSlug/v/:venueSlug always resolves through Host's public handler", () => {
    const vercel = JSON.parse(read("mingla-business/vercel.json")) as {
      rewrites: Array<{ source: string; destination: string; has?: unknown }>;
      redirects: Array<{ source: string; destination: string; permanent: boolean; has?: unknown }>;
    };
    const rule = vercel.rewrites.find(
      (r) => r.source === "/b/:brandSlug/v/:venueSlug",
    );
    expect(rule).toBeDefined();
    // [TEST-MOD-APPROVED #1615] The old parent-brand destination was correct
    // before venue-specific S5 existed. The approved surface now has its own
    // handler and must keep both slugs.
    expect(rule?.destination).toBe(
      "/api/public-venue?brandSlug=:brandSlug&venueSlug=:venueSlug",
    );
    expect(rule?.has).toBeUndefined();

    const compatibility = vercel.redirects.find(
      (redirect) => redirect.source === "/b/:brandSlug/v/:venueSlug",
    );
    expect(compatibility).toEqual({
      source: "/b/:brandSlug/v/:venueSlug",
      destination: "https://host.usemingla.com/b/:brandSlug/v/:venueSlug",
      permanent: true,
      has: [{ type: "host", value: "business\\.usemingla\\.com" }],
    });
  });
});

// ---- T-C3 static half: admin re-point --------------------------------------

describe("T-C3 static half — mingla-admin claims queue is venue-keyed", () => {
  const svc = read("mingla-admin/src/services/adminClaimsService.js");
  const page = read("mingla-admin/src/pages/ClaimsPage.jsx");

  test("queue lists venue_listings rows with the embedded brand join", () => {
    expect(svc).toContain('.from("venue_listings")');
    expect(svc).not.toContain('.from("brands")');
    expect(svc).toContain("brand:brand_id (");
    expect(svc).toContain("duplicate_of_venue_id");
  });

  test("review/bundle/tweak/feedback are venue-keyed end-to-end", () => {
    expect(svc).toContain("p_venue_id: venueId");
    expect(svc).toContain('body = { venue_id: venueId, action }');
    expect(svc).toContain('venue_id: venueId, action: "tweak_fields"');
    expect(page).toContain('.eq("venue_id", row.id)');
    expect(page).toContain("duplicate_of_venue_id");
  });
});

// ---- Discovery-fix seams (D-B / D-C / app-mobile passthrough) ---------------

describe("discovery-fix seams", () => {
  test("D-B: venue-reservation-create resolves pricing venue-scoped", () => {
    const fn = read("supabase/functions/venue-reservation-create/index.ts");
    // The PRICING call specifically (not the slots call) must be venue-scoped
    // — reverting it re-opens the arbitrary-rows[0] override winner.
    expect(fn).toMatch(
      /resolve_brand_pricing_inputs",\s*\{\s*p_brand_id:\s*brandId,\s*p_venue_id:\s*venueId\s*\}/,
    );
  });

  test("D-C: the venue cover target exists and the wizard flow uses it", () => {
    const target = read("mingla-business/src/components/ui/coverTarget.ts");
    expect(target).toContain('kind: "venue"');
    // META-ORCH-1255(R2) [TEST-MOD-APPROVED META-ORCH-1255] pin supersession:
    // the deck-readiness setup (the cover-upload leg of the wizard flow) moved
    // VERBATIM from VenueCreatorWizard.tsx to VenueDeckReadinessSetup.tsx
    // (ORCH-1083 web bundle budget — the wizard-file sharing hoisted it into
    // the eager __common chunk). Same assertions, following the move; the
    // wizard file must still never use a brand cover target.
    const setup = read(
      "mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx",
    );
    const wizard = read(
      "mingla-business/src/components/venue/VenueCreatorWizard.tsx",
    );
    expect(setup).toContain('kind: "venue"');
    expect(setup).not.toContain('kind: "brand"');
    expect(wizard).not.toContain('kind: "brand"');
    // The server sync writes the venue row's cover columns (one owner).
    const pipeline = read(
      "supabase/functions/run-business-place-authoring-pipeline/index.ts",
    );
    expect(pipeline).toContain("cover_media_url: mediaUrl.length > 0 ? mediaUrl : null");
  });

  test("app-mobile reserve flow passes venue_id end-to-end (deck untouched)", () => {
    const availability = read("app-mobile/src/hooks/useVenueAvailability.ts");
    expect(availability).toContain("p_venue_id: venueId");
    const service = read("app-mobile/src/services/venueReservationService.ts");
    expect(service).toContain("venueId: input.venueId");
    const reservableHook = read("app-mobile/src/hooks/useVenueReservable.ts");
    expect(reservableHook).toContain("venue_id: string | null");
  });
});
