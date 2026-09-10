/*
 * #3149 wave 5 — WHERE "Continue with Mingla" ACTUALLY GOES.
 *
 * The button was derived, canonical, typo-proof and wrong. Wave 4 built it as
 * `https://host.usemingla.com/reserve/{brand_id}`, and `/reserve/[brandId]` is
 * not where a booking starts — the whole tree is a payment-RETURN surface. Its
 * index renders "Payment cancelled. You haven't been charged.", `confirm` is
 * the post-payment landing and `manage` edits a booking that already exists.
 * Clicked from the live site, a guest who had chosen nothing and paid nothing
 * was told their payment had been cancelled.
 *
 * Two suites pinned that address as correct, which is why it shipped green and
 * stayed shipped. Both pinned it as a STRING. So the assertions here are about
 * the SHAPE of the destination and, explicitly, about what it must never be:
 * a regression back to any `/reserve/` address fails this file, whatever brand
 * or venue it is built for.
 *
 * Everything below EXECUTES the real `buildPublicationArtifact` over a stubbed
 * Payload and a configurable projection. Nothing reads the builder as text —
 * reading it as text is what let the cancel-page link ship in the first place.
 *
 * fails-on-revert verified at db7e04a38 (`url` restored to
 * `${MINGLA_HOST_ORIGIN}/reserve/${input.tenant.core_brand_id}`, the fail-closed
 * guard and the `wantsVenue` read removed): 14 of the 16 tests here fail. The
 * two that still pass are the ones that must — the brand's own copy travels
 * either way, and a page with no reservation block asks for no venue either
 * way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const stored = new Map<string, Uint8Array>();

/*
 * The projection is CONFIGURABLE so the closed paths are executed rather than
 * argued about. `vi.hoisted` because `vi.mock` factories are hoisted above
 * module-level bindings and would otherwise hit the temporal dead zone.
 */
const state = vi.hoisted(() => ({
  venueSlug: "gogi" as unknown,
  brandSlug: "gogilagos" as unknown,
  calls: [] as { includeMenu: boolean; includeVenue: boolean }[],
}));

vi.mock("./config", () => ({
  cmsConfig: () => ({ artifactBucket: "artifact-bucket" }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async (
    _path: string,
    _siteId: string,
    _operationId: string,
    _offeringIds: string[],
    includeMenu: boolean,
    includeVenue: boolean,
  ) => {
    state.calls.push({ includeMenu, includeVenue });
    return {
      offerings: [],
      menu: [],
      menu_venue_id: null,
      venue_slug: includeVenue ? state.venueSlug : null,
      brand_slug: includeVenue ? state.brandSlug : null,
    };
  },
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}:${key}`, bytes);
  },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";

const publicContract = async () =>
  (await import(
    /* @vite-ignore */ path.resolve(
      process.cwd(),
      "../mingla-sites/src/contracts/artifact.ts",
    )
  )) as { assertRestaurantArtifact: (value: unknown) => void };

const TENANT_ID = "00000000-0000-4000-8000-000000000901";
const SITE_ID = "00000000-0000-4000-8000-000000000902";
const BRAND_ID = "00000000-0000-4000-8000-000000000903";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000904";
const MEDIA_ID = "00000000-0000-4000-8000-000000000c01";

const tenant = { id: TENANT_ID, core_site_id: SITE_ID, core_brand_id: BRAND_ID };

const mediaRecord = {
  id: MEDIA_ID,
  tenant: TENANT_ID,
  state: "READY",
  width: 1440,
  height: 1440,
  rendition_manifest: {
    renditions: [{
      width: 1440,
      target_width: 1440,
      digest: "c".repeat(64),
      key: `approved/${SITE_ID}/${MEDIA_ID}/1440.webp`,
    }],
  },
};

const settings = {
  id: "settings-1",
  tenant: TENANT_ID,
  display_name: "gögi",
  short_description: "A 24/7 food house.",
  background_color: "#1c1c1e",
  foreground_color: "#f0eee9",
  accent_color: "#cda052",
  typography: "condensed-display",
  canonical_url: "https://gogi.sites.usemingla.com",
  seo_title: "gögi",
  seo_description: "Where Lagos comes to eat.",
};

const HERO = {
  blockType: "hero",
  heading: "Where Lagos Comes to Eat",
  media: MEDIA_ID,
  ctas: [],
};

const RESERVATION = {
  blockType: "venue_reservation",
  eyebrow: "Come through",
  heading: "Book a table at gögi",
  body: "gögi is walk-in and always open.",
};

async function build(blocks: Record<string, unknown>[]) {
  const page = {
    id: "page-home",
    tenant: TENANT_ID,
    role: "home",
    slug: "home",
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
    blocks,
    seo: { title: "gögi", description: "Where Lagos comes to eat." },
  };
  const collections: Record<string, unknown[]> = {
    pages: [page],
    navigation: [{ id: "nav-1", tenant: TENANT_ID, pages: ["page-home"] }],
    footer: [{ id: "footer-1", tenant: TENANT_ID, address: "69 Admiralty Way" }],
    "site-settings": [settings],
    media: [mediaRecord],
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!,
    navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null,
    settings,
    media: collections.media!,
  });
  const req = {
    context: {},
    payload: {
      find: async ({ collection }: { collection: string }) => ({
        docs: collections[collection] ?? [],
      }),
    },
  } as never;
  return await buildPublicationArtifact(req, {
    tenant,
    operationId: "op-3149-wave5",
    publicationId: PUBLICATION_ID,
    sourceRevisionId: "rev-3149-wave5",
    sourceDigest,
    generatedAt: "2026-09-10T00:00:00Z",
  });
}

const homeBlocks = (artifact: unknown): Record<string, unknown>[] =>
  ((artifact as { pages: { blocks: Record<string, unknown>[] }[] }).pages)[0]!
    .blocks;

const reservationOf = (artifact: unknown) =>
  homeBlocks(artifact).find((block) => block.type === "venue_reservation");

/* The public venue page: /b/{brand_slug}/v/{venue_slug} and nothing else. */
const VENUE_PAGE =
  /^https:\/\/host\.usemingla\.com\/b\/[a-z0-9][a-z0-9-]*\/v\/[a-z0-9][a-z0-9-]*$/;

beforeEach(() => {
  stored.clear();
  state.venueSlug = "gogi";
  state.brandSlug = "gogilagos";
  state.calls.length = 0;
});

describe("#3149 wave 5 the booking button points at a page that takes bookings", () => {
  it("builds the venue's PUBLIC page, and never a /reserve/ address", async () => {
    const { artifact } = await build([HERO, RESERVATION]);
    const block = reservationOf(artifact)!;
    expect(block.url).toBe("https://host.usemingla.com/b/gogilagos/v/gogi");
    expect(block.url).toMatch(VENUE_PAGE);
    /*
     * THE REGRESSION GUARD. Asserting the shape alone would still pass for
     * `/reserve/{something}` if someone rebuilt it that way with a slug, and
     * the whole defect was an address that looked canonical and was a
     * cancellation notice. So the cancel surface is named and refused.
     */
    expect(block.url).not.toContain("/reserve/");
    expect(String(block.url)).not.toMatch(/\/reserve(\/|$)/);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("DERIVES the address — different slugs give a different link", async () => {
    /*
     * Proves the two segments come from Mingla rather than from anything typed
     * or hardcoded. A builder that had "gogilagos/gogi" baked in would pass the
     * test above and fail this one.
     */
    state.brandSlug = "another-brand";
    state.venueSlug = "second-room";
    const { artifact } = await build([HERO, RESERVATION]);
    expect(reservationOf(artifact)!.url).toBe(
      "https://host.usemingla.com/b/another-brand/v/second-room",
    );
    expect(reservationOf(artifact)!.url).toMatch(VENUE_PAGE);
  });

  it("carries the brand's own words through unchanged", async () => {
    const { artifact } = await build([HERO, RESERVATION]);
    const block = reservationOf(artifact)!;
    expect(block.heading).toBe("Book a table at gögi");
    expect(block.body).toBe("gögi is walk-in and always open.");
    expect(block.eyebrow).toBe("Come through");
  });
});

describe("#3149 wave 5 an unresolvable venue drops the block, it never guesses", () => {
  /*
   * FAIL CLOSED. `brand_site_orderable_venue` returns NULL when a brand has no
   * verified venue OR more than one, and `venue_public_view` only publishes
   * verified rows — so "no slugs" is a real, reachable state, not a paranoid
   * one. A reservation section that is briefly absent is a gap. One that is
   * present and lands on a cancellation notice is a lost booking and a guest
   * who thinks the restaurant is broken.
   */
  it.each([
    ["no venue slug", null, "gogilagos"],
    ["no brand slug", "gogi", null],
    ["neither", null, null],
  ])("drops the block when there is %s", async (_label, venue, brand) => {
    state.venueSlug = venue;
    state.brandSlug = brand;
    const { artifact } = await build([HERO, RESERVATION]);
    expect(reservationOf(artifact)).toBeUndefined();
    // The rest of the page still publishes: one bad block is not a dead site.
    expect(homeBlocks(artifact)).toHaveLength(1);
    expect(homeBlocks(artifact)[0]!.type).toBe("hero");
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it.each([
    ["a path separator", "gogi/admin"],
    ["a traversal", "../../reserve"],
    ["a space", "gogi lagos"],
    ["an empty string", ""],
    ["a scheme", "https://evil.example"],
    ["a leading hyphen", "-gogi"],
  ])("refuses %s rather than escaping it into the path", async (_label, bad) => {
    /*
     * These two segments become path segments on Mingla's own host. A value
     * that needs escaping is not a slug, and the honest answer is no link — not
     * a link that quietly addresses somewhere else.
     */
    state.venueSlug = bad;
    const { artifact } = await build([HERO, RESERVATION]);
    expect(reservationOf(artifact)).toBeUndefined();
  });

  it("refuses a non-string slug", async () => {
    state.venueSlug = 12345;
    const { artifact } = await build([HERO, RESERVATION]);
    expect(reservationOf(artifact)).toBeUndefined();
  });
});

describe("#3149 wave 5 the venue is read only when a page needs it", () => {
  it("asks for the venue when a page carries a reservation block", async () => {
    await build([HERO, RESERVATION]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.includeVenue).toBe(true);
  });

  it("a reservation block ALONE still triggers the read", async () => {
    /*
     * The regression this flag exists for. The projection was previously
     * fetched only when a page had offerings or a menu; a site whose only
     * commercial block is a booking button would have reached the reservation
     * case with no slugs at all and dropped its own button.
     */
    await build([HERO, RESERVATION]);
    expect(state.calls[0]).toEqual({ includeMenu: false, includeVenue: true });
  });

  it("does NOT ask for the venue when no page carries one", async () => {
    await build([HERO]);
    // No offerings, no menu, no reservation — no projection at all.
    expect(state.calls).toHaveLength(0);
  });
});
