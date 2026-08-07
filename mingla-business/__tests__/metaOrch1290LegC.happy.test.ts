/**
 * META-ORCH-1290 Leg C — implementor HAPPY-PATH regression tests
 * [consumer swipe-card pitch + public venue-page "About" pitch].
 *
 * Leg C RENDERS the owner-authored pitch that Leg A surfaced:
 *   - public page: `venue_public_view.pitch` (= place_pool.generative_summary)
 *     → PublicVenue.pitch → an "About" section (4-line clamp + Read more) under
 *     the identity block, pitch-first meta (≤155), and a desktop 2-line clamp;
 *   - consumer deck: discover-cards maps the pitch into the card's
 *     `description`, and the EXPANDED card shows the full pitch.
 *     [TEST-MOD-APPROVED #1609] This used to read "…the swipe FACE clamps
 *     `oneLiner` to 2 lines (a one-taste hook) and the expanded modal shows the
 *     full pitch." #1609 Direction C deleted the blurb from the collapsed face;
 *     the expanded card is now the single route the owner's words take to a
 *     buyer on the deck, and T-B below asserts that whole route end to end.
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
 *   - [TEST-MOD-APPROVED #1609] re-add the `oneLiner` blurb to the collapsed
 *     card face → T-A FAILS; delete any one of the four pitch-delivery hops
 *     (discover-cards `description`, deckService, ExpandedCardModal,
 *     CardInfoSection) → T-B FAILS. (This entry previously read "revert the card
 *     `oneLiner` to `numberOfLines={1}` → the 2-line-clamp assertion FAILS",
 *     which described a slot Direction C removed.)
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
    //
    // [TEST-MOD-APPROVED #1561] — it was `{!isDesktop ? identityBlock : null}`.
    // #1561 renders that block at EVERY width: it now carries the category and
    // city chips and the answer bar, which are three of the four things #1550
    // Leg C found unanswerable above the fold, and suppressing them on desktop
    // would have left 1440 and 2560 scoring what they scored before. The
    // desktop hero caption (which printed the venue name a second time, over
    // the photograph) is what was removed instead, so the name is printed once.
    // The invariant this line guards — identity ABOVE the tab pane — is
    // unchanged and is asserted more strongly below, by source position.
    expect(pageSrc).toContain("{identityBlock}");
    expect(pageSrc.indexOf("{identityBlock}")).toBeLessThan(
      pageSrc.indexOf("profile.overview.map((sectionId)"),
    );
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

  // [TEST-MOD-APPROVED #1609] — the two assertions that stood here, "place card
  // blurb = the pitch clamped to 2 lines (a one-taste hook)" and "title tightens
  // ONLY when a pitch blurb follows (scoped, not global)", are REPLACED, not
  // repaired, and deliberately not restored.
  //
  // WHAT SUPERSEDES THEM: #1609 Direction C DELETES `oneLiner` from the
  // collapsed deck card face (Constitution 8, subtract before adding). The
  // decision and its reasoning are recorded at the two Direction C comments in
  // app-mobile/src/components/SwipeableCards.tsx — the one above the front
  // face's `faceOverlay`, and the one above the deleted `oneLiner` style: two
  // lines of 9pt prose under the title at identical colour was the single
  // largest contributor to the face's register-flatness, and the pitch survives
  // VERBATIM in the expanded card. The data path is untouched. So the old pair
  // was not catching a regression; it was a guard that had not caught up with a
  // product decision that supersedes it.
  //
  // WHY THE REPLACEMENT IS STRICTLY STRONGER: the contract worth protecting is
  // "the venue owner's own words reach the buyer" — NOT "they reach the buyer on
  // the collapsed card". The old pair asserted two PRESENTATION properties, a
  // `numberOfLines={2}` clamp and a 6pt bottom margin, on one optional slot on
  // one surface. Both would have gone on passing, green, while NO owner's pitch
  // reached ANY buyer anywhere: `oneLiner: null` for every venue renders the
  // clamp code and the margin perfectly well and prints not one word. They
  // protected the user-facing promise only by implication.
  //
  // The replacement asserts the promise itself, on both sides:
  //   T-A  the blurb is genuinely ABSENT from the collapsed face — comment-
  //        stripped, so prose that merely mentions `oneLiner` cannot satisfy it,
  //        and vacuity-guarded, so a gutted, truncated or renamed face cannot
  //        silently widen "contains no oneLiner" into a free pass;
  //   T-B  the pitch STILL REACHES THE BUYER, asserted as the whole delivery
  //        chain from `place_pool.generative_summary` to the rendered <Text> in
  //        the expanded card. Four hops, each comment-stripped and vacuity-
  //        guarded; a break at ANY hop fails it. The old pair covered none of
  //        this chain.

  // Comments are stripped so that (a) an ABSENCE assertion cannot be satisfied
  // by prose that merely mentions the symbol, and (b) a PRESENCE assertion
  // cannot be satisfied by a commented-out line. Block comments go first (which
  // also empties JSX comment bodies), then line comments — except a `//` that
  // follows a `:`, which is a URL and not a comment.
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // Strip, and REFUSE to hand back a source that has been emptied, truncated or
  // over-stripped. Every assertion below runs through here, so a deleted or
  // gutted anchor fails loudly instead of quietly turning an absence assertion
  // into a tautology. `read()` itself throws on a missing file, which covers the
  // rename/delete case; these two guards cover the gutted and over-stripped
  // cases. Every source here is >55% code by character, so an unterminated block
  // comment or a stripper regression blows past the 50% floor.
  const liveCodeOf = (raw: string, minChars: number): string => {
    expect(raw.length).toBeGreaterThan(minChars);
    const live = stripComments(raw);
    expect(live.length).toBeGreaterThan(raw.length * 0.5);
    return live;
  };

  test("the comment stripper drops prose and keeps code (stripper self-test)", () => {
    // Proves the mechanism T-A's absence claim rests on. Without this, a
    // stripper that silently became a no-op would make T-A fail for the wrong
    // reason, and one that ate everything would make it pass for the wrong one.
    const fixture = [
      "// oneLiner named in a LINE comment",
      "/* oneLiner named in a BLOCK comment */",
      "{/* oneLiner named in a JSX comment */}",
      'const href = "https://example.com/oneLiner";',
      "const live = currentRec.oneLiner;",
    ].join("\n");
    const out = stripComments(fixture);

    // Prose is gone — all three comment forms.
    expect(out).not.toContain("LINE comment");
    expect(out).not.toContain("BLOCK comment");
    expect(out).not.toContain("JSX comment");
    // Code survives, and a URL's `//` is not mistaken for a comment.
    expect(out).toContain("const live = currentRec.oneLiner;");
    expect(out).toContain('const href = "https://example.com/oneLiner";');
    // Exactly the two CODE occurrences remain — the three commented ones do not.
    expect((out.match(/oneLiner/g) ?? []).length).toBe(2);
  });

  test("T-A the collapsed deck card renders NO pitch blurb (#1609 Direction C)", () => {
    const live = liveCodeOf(cardSrc, 100_000);

    // VACUITY GUARD — the face this test is talking about must still exist and
    // must still be the real thing, or "no blurb" is true for the wrong reason.
    // These are the four things Direction C says the front face DOES render.
    expect(live).toContain("styles.faceOverlay");
    expect(live).toContain("styles.cardTitle");
    expect(live).toContain(
      "{currentRec.title || t('cards:swipeable.experience')}",
    );
    expect(live).toContain("<DeckCardPlate");

    // THE CLAIM: zero LIVE references to the deleted face blurb or its
    // title-tightening style. Fails-on-revert: re-adding the `oneLiner` render
    // (or the `cardTitleWithBlurb` style) to the face puts a hit back here.
    expect(live.match(/oneLiner|cardTitleWithBlurb/g) ?? []).toEqual([]);
  });

  test("T-B the pitch still reaches the buyer — origin to rendered text", () => {
    // HOP 1 — ORIGIN. discover-cards turns the owner-authored pitch
    // (place_pool.generative_summary) into the card payload's `description`.
    // Reverting this to `description: ''` hides the pitch from every buyer, and
    // the old collapsed-card pair would not have noticed.
    const edge = liveCodeOf(
      read("supabase/functions/discover-cards/index.ts"),
      10_000,
    );
    expect(edge).toContain(
      "description: (row.generative_summary as string | null) ?? ''",
    );

    // HOP 2 — TRANSPORT. deckService carries it onto the card model the deck and
    // the expanded card both read.
    const deckSrc = liveCodeOf(
      read("app-mobile/src/services/deckService.ts"),
      5_000,
    );
    expect(deckSrc).toContain("description: card.description");
    expect(deckSrc).toContain("fullDescription: card.description");

    // HOP 3 — DELIVERY. The expanded card hands it to the info section. This is
    // the surface Direction C moved the pitch to, so this hop is now the ONLY
    // route the owner's words take to a buyer on the deck.
    const modalSrc = liveCodeOf(
      read("app-mobile/src/components/ExpandedCardModal.tsx"),
      10_000,
    );
    // #1605 wave 4 [TEST-MOD-APPROVED #1605] — RE-POINTED, behaviour unchanged.
    // The pitch still reaches the same slot; it now travels through a NAMED
    // derivation because the expanded card is one spine and a curated plan's
    // prose is its tagline. Both halves of the hop are still asserted: the
    // derivation must READ card.description, and the slot must RECEIVE it.
    expect(modalSrc).toMatch(
      /const bodyDescription[\s\S]{0,120}card\.description/,
    );
    expect(modalSrc).toMatch(/description=\{bodyDescription\}/);

    // HOP 4 — RENDER. The info section prints it, gated on presence (honest
    // empty: a venue with no pitch shows nothing, never placeholder text).
    const infoSrc = liveCodeOf(
      read("app-mobile/src/components/expandedCard/CardInfoSection.tsx"),
      1_000,
    );
    // The presence gate is now `present()` — a TRIMMING predicate, so a pitch of
    // whitespace is hidden too, which the old truthiness check would have printed
    // as an empty paragraph. Strictly more honest, same contract.
    expect(infoSrc).toMatch(/const hasDescription = present\(description\)/);
    expect(infoSrc).toMatch(/hasDescription \? \(/);
  });

  test("expanded modal renders the full pitch via the description slot", () => {
    const modal = read("app-mobile/src/components/ExpandedCardModal.tsx");
    // [TEST-MOD-APPROVED #1605] — see the note in T-B above.
    expect(modal).toMatch(/const bodyDescription[\s\S]{0,120}card\.description/);
    expect(modal).toMatch(/description=\{bodyDescription\}/);
    const info = read(
      "app-mobile/src/components/expandedCard/CardInfoSection.tsx",
    );
    // Honest empty: the description renders only when text is present.
    expect(info).toMatch(/const hasDescription = present\(description\)/);
    expect(info).toMatch(/hasDescription \? \(/);
  });
});
