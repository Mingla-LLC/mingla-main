/**
 * META-ORCH-1290 Leg C — implementor HAPPY-PATH regression tests
 * [consumer swipe-card pitch + public venue-page "About" pitch].
 *
 * Leg C RENDERS the owner-authored pitch that Leg A surfaced:
 *   - public page: `venue_public_view.pitch` (= place_pool.generative_summary)
 *     → PublicVenue.pitch → an "About" section (4-line clamp + Read more) under
 *     the identity block, pitch-first meta (≤155), and a desktop 2-line clamp;
 *   - consumer deck: discover-cards already maps the pitch into the card's
 *     `oneLiner` + `description`; the swipe FACE clamps `oneLiner` to 2 lines
 *     (a one-taste hook) and the expanded modal shows the full pitch.
 *
 * D-6 / DESIGN §5a + §6. No fabricated data: a venue with no pitch shows
 * NOTHING on every surface (honest empty), never placeholder text.
 *
 * WHY THIS SHAPE: the service half is a REAL behavioral test (mocked supabase →
 * the mapper surfaces `pitch`). PublicVenuePage + SwipeableCards carry heavy
 * native/themed deps that the default node/ts-jest config cannot mount (no RTL
 * here — mirrors metaOrch1255LegC.happy.test.ts, which likewise reads
 * app-mobile source as text). So the render seams are asserted structurally,
 * which gives clean fails-on-revert.
 *
 * FAILS-ON-REVERT (proven by TRUE LINE DELETION — see the implementation report):
 *   - drop `pitch: asStringOrNull(row.pitch)` from the mapper → the service
 *     mapper tests FAIL (pitch is undefined, not the surfaced text/null);
 *   - revert the card `oneLiner` to `numberOfLines={1}` → the 2-line-clamp
 *     assertion FAILS;
 *   - revert the public meta to the mechanical-only line → the pitch-first meta
 *     assertion FAILS;
 *   - delete the aboutBlock / Read-more toggle → the About-section assertions
 *     FAIL.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
// [TEST-MOD-APPROVED #1558] — the Overview order moved from JSX layout into
// data; the ordering assertion below now reads the data. Relative, not the
// "@mingla/…" specifier: node_modules/@mingla is a workspace symlink, which
// under a git worktree would resolve the anchor checkout's copy.
import { VENUE_CATEGORY_PROFILES } from "../../packages/brand-rendering/venueCategoryProfile";

const BIZ = join(__dirname, "..");
const REPO = join(BIZ, "..");
const read = (rel: string): string => readFileSync(join(REPO, rel), "utf8");

// ---- service half: venue_public_view.pitch → PublicVenue.pitch -------------

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../src/services/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
// The workspace package does not resolve under node/ts-jest (pre-existing;
// metaOrch1255LegC.happy.test.ts mocks it the same way). Mock ONLY the runtime
// symbols publicEventsService touches; type-only imports are erased.
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

import { getPublicVenueBySlug } from "../src/services/publicEventsService";

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
  hours: [],
  pool_photo_urls: ["https://pool.example.com/a.jpg"],
  // META-ORCH-1290 M1: generative_summary AS pitch.
  pitch: "A harbourside room where the fish is bought that morning.",
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

describe("META-ORCH-1290 Leg C — service surfaces the pitch (D-6b)", () => {
  test("populated pitch → PublicVenue.pitch carries the owner text", async () => {
    const q = viewQuery({ data: venueViewRow(), error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "venue_public_view") return q;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const venue = await getPublicVenueBySlug("casanoble", "downtown");

    expect(mockFrom).toHaveBeenCalledWith("venue_public_view");
    expect(venue).not.toBeNull();
    // The REAL fails-on-revert bite: drop the mapper line → pitch is undefined.
    expect(venue?.pitch).toBe(
      "A harbourside room where the fish is bought that morning.",
    );
  });

  test("null pitch → PublicVenue.pitch is null (honest empty, no fabrication)", async () => {
    const q = viewQuery({ data: venueViewRow({ pitch: null }), error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => q);
    const venue = await getPublicVenueBySlug("casanoble", "downtown");
    expect(venue?.pitch).toBeNull();
  });

  test("whitespace-only pitch → null (never renders an empty About)", async () => {
    const q = viewQuery({ data: venueViewRow({ pitch: "   " }), error: null });
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => q);
    const venue = await getPublicVenueBySlug("casanoble", "downtown");
    expect(venue?.pitch).toBeNull();
  });
});

// ---- public page render seams (§6) ----------------------------------------

describe("META-ORCH-1290 Leg C — public page 'About' pitch (§6)", () => {
  // [TEST-MOD-APPROVED #1559] — the buyer-web venue BODY moved to
// `packages/brand-rendering/PublicVenueScreen.tsx` (a pure move: render parity
// proven by publicVenueRenderParity.issue1559.happy.test.tsx). These assertions
// follow the code; the contract each one pins is unchanged.
  const pageSrc = read("packages/brand-rendering/PublicVenueScreen.tsx");
  const svcSrc = read("mingla-business/src/services/publicEventsService.ts");

  test("PublicVenue type + mapper carry the pitch column", () => {
    expect(svcSrc).toContain("pitch: string | null");
    expect(svcSrc).toContain("pitch: asStringOrNull(row.pitch)");
  });

  test("About section renders ONLY when a pitch exists (honest empty)", () => {
    // aboutBlock is gated on hasPitch → null pitch renders nothing.
    expect(pageSrc).toContain("const aboutBlock = hasPitch ? (");
    expect(pageSrc).toContain('venue.pitch !== null ? venue.pitch.trim() : ""');
    expect(pageSrc).toContain("const hasPitch = pitchText.length > 0");
  });

  test("About = 4-line clamp with a working Read more / Show less toggle", () => {
    // The clamp toggles between 4 lines and full via aboutExpanded.
    expect(pageSrc).toContain(
      "numberOfLines={aboutExpanded ? undefined : 4}",
    );
    // The toggle is a real Pressable wired to the state setter — NOT a dead tap.
    expect(pageSrc).toContain("onPress={toggleAboutExpanded}");
    expect(pageSrc).toContain("setAboutExpanded((v: boolean) => !v)");
    expect(pageSrc).toContain('aboutExpanded ? "Show less" : "Read more"');
  });

  // [TEST-MOD-APPROVED #1558] — this test used to compare the SOURCE INDEXES of
  // the literals `{aboutBlock}` and `{mapBlock}` inside one JSX pane. #1558
  // deleted that hardcoded pane: the Overview order is now DATA
  // (`profile.overview`, an ordered `VenueSectionId[]`), rendered through a
  // total registry. Keeping the old assertion would have meant keeping the JSX
  // literals purely so a grep could find them — a test that passes on source
  // layout while the real order lives elsewhere is exactly the unfalsifiable
  // class this repo keeps getting bitten by.
  //
  // The invariant is UNCHANGED and now asserted where it actually lives: About
  // sits under the identity block and before Location, in every category's
  // order, and the page renders that array rather than a fixed sequence.
  test("About sits under the identity, before the map — in the ORDER DATA", () => {
    // The identity block is still page chrome above the tab pane.
    expect(pageSrc).toContain("{!isDesktop ? identityBlock : null}");
    // The pane is driven by the profile's ordered section list.
    expect(pageSrc).toContain("profile.overview.map((sectionId)");
    expect(pageSrc).toContain(
      "Record<VenueSectionId, VenueSectionRenderer>",
    );

    const keys = Object.keys(
      VENUE_CATEGORY_PROFILES,
    ) as Array<keyof typeof VENUE_CATEGORY_PROFILES>;
    expect(keys.length).toBeGreaterThanOrEqual(5); // vacuity guard
    let checked = 0;
    for (const key of keys) {
      const order = VENUE_CATEGORY_PROFILES[key].overview;
      const aboutAt = order.indexOf("about");
      const locationAt = order.indexOf("location");
      expect(aboutAt).toBeGreaterThan(-1);
      expect(locationAt).toBeGreaterThan(aboutAt);
      checked += 1;
    }
    expect(checked).toBe(keys.length); // vacuity guard
  });

  test("meta description is pitch-first, clamped ≤155, mechanical fallback kept", () => {
    expect(pageSrc).toContain("const META_MAX = 155");
    expect(pageSrc).toContain("clampPitchForMeta(pitchText)");
    // Fallback survives for the no-pitch case.
    expect(pageSrc).toContain(
      "`${venue.name} — ${venue.brandName} on Mingla`",
    );
    // The clamp collapses whitespace/newlines to a single line and truncates.
    expect(pageSrc).toContain('text.replace(/\\s+/g, " ")');
  });

  test("desktop sticky panel gets a 2-line pitch clamp under the address", () => {
    expect(pageSrc).toContain("styles.deskPitch");
    // The desk pitch is a 2-line clamp gated on hasPitch (hidden when empty).
    const deskPitchIdx = pageSrc.indexOf("styles.deskPitch");
    const region = pageSrc.slice(deskPitchIdx - 120, deskPitchIdx + 160);
    expect(region).toContain("numberOfLines={2}");
  });
});

// ---- consumer swipe-card render seams (§5a) --------------------------------

describe("META-ORCH-1290 Leg C — consumer swipe card pitch (§5a)", () => {
  const cardSrc = read("app-mobile/src/components/SwipeableCards.tsx");

  test("deckService already passes the pitch through to the card model", () => {
    const deck = read("app-mobile/src/services/deckService.ts");
    // oneLiner (face blurb) + description (expanded modal full pitch).
    expect(deck).toContain("oneLiner: card.oneLiner || null");
    expect(deck).toContain("description: card.description");
  });

  test("place card blurb = the pitch clamped to 2 lines (a one-taste hook)", () => {
    // The front place card's oneLiner slot is the pitch, clamped to 2 lines.
    // Isolate the render region so the assertion bites on the place-card face
    // (guarded by `currentRec.oneLiner &&`), not the behind-card title.
    const guardIdx = cardSrc.indexOf("{currentRec.oneLiner && (");
    expect(guardIdx).toBeGreaterThan(-1);
    const region = cardSrc.slice(guardIdx, guardIdx + 200);
    // THE fails-on-revert bite: reverting to numberOfLines={1} breaks this.
    expect(region).toContain("numberOfLines={2}");
    expect(region).toContain("styles.oneLiner");
  });

  test("title tightens ONLY when a pitch blurb follows (scoped, not global)", () => {
    // cardTitleWithBlurb (marginBottom 6) is applied via a style array keyed on
    // currentRec.oneLiner — the behind-card title keeps its base 16pt gap.
    expect(cardSrc).toContain(
      "currentRec.oneLiner ? styles.cardTitleWithBlurb : null",
    );
    expect(cardSrc).toContain("cardTitleWithBlurb: {");
    expect(cardSrc).toContain("marginBottom: 6");
  });

  test("expanded modal renders the full pitch via the description slot", () => {
    const modal = read("app-mobile/src/components/ExpandedCardModal.tsx");
    expect(modal).toContain("description={card.description}");
    const info = read(
      "app-mobile/src/components/expandedCard/CardInfoSection.tsx",
    );
    // Honest empty: the description Text renders only when text is present.
    expect(info).toContain(
      "{description && <Text style={styles.description}>{description}</Text>}",
    );
  });
});
