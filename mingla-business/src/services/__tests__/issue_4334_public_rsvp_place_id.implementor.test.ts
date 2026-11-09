/**
 * issue #4334 N-1 follow-up — a PUBLIC RSVP page's Maps link opens the picked
 * Google place.
 *
 * Public RSVPs have no ticketed bundle, so buyer web and the Business app read
 * them from `business_public_events_view` (getPublicEventBySlug / ById → the
 * view → detailFromRow → publicEventViewRowToEvent). The view now appends
 * `location_provider_place_id` (NULL when the street is withheld); the mapper
 * carries it as `event.googlePlaceId`, PublicEventPage passes it to the shared
 * body, and `selectVenueMapsTarget` / `buildMapsDeepLink` anchor the link on it.
 * Only the Supabase transport is mocked.
 *
 *   R-1  by slug and by id, the view's place id reaches the event
 *   R-2  the resulting web Maps link carries query_place_id
 *   R-3  a withheld (NULL), blank or absent column maps to null; the link falls
 *        back to the coordinate
 *
 * FAILS-ON-REVERT: drop the `googlePlaceId:` line in publicEventViewRowToEvent and
 * R-1/R-2 fail; drop it from venuePublicViewRowToPublicVenue → V-1; from the
 * venue screen's target or either adapter → V-2.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn() as ReturnType<typeof jest.fn>;
const fromMock = jest.fn() as ReturnType<typeof jest.fn>;
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);

/* eslint-disable import/first */
import {
  getPublicEventById,
  getPublicEventBySlug,
  venuePublicViewRowToPublicVenue,
} from "../publicEventsService";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildMapsDeepLink,
  selectVenueMapsTarget,
} from "../../../../packages/offering-rendering/mapsDeepLink";
/* eslint-enable import/first */

const EVENT_ID = "4334a0de-0000-4000-8000-000000004334";
const PLACE_ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";

const viewRow = (patch: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  brand_id: "brand-didi",
  brand_slug: "didi",
  brand_name: "Didi Museum",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: false,
  brand_address: null,
  brand_cover_media_url: null,
  brand_theme_color: null,
  brand_theme_font: null,
  brand_theme_animation: null,
  title: "Garden Party",
  description: "",
  slug: "garden-party",
  event_type: "rsvp",
  location_text: "175 Akin Adesola St, Lagos",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_gallery: [],
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "NGN",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2099-09-15T10:23:04Z",
  timezone: "Africa/Lagos",
  created_at: "2099-09-15T10:00:00Z",
  updated_at: "2099-09-15T10:23:04Z",
  public_theme: {
    business_event: {
      hideAddressUntilTicket: false,
      location: { venueName: "Didi Museum", address: "175 Akin Adesola St, Lagos" },
    },
  },
  theme_color_override: null,
  theme_font_override: null,
  theme_animation_override: null,
  master_start_at: "2099-10-03T18:00:00Z",
  master_end_at: "2099-10-03T22:00:00Z",
  master_timezone: "Africa/Lagos",
  master_event_date_id: "date-garden",
  location_geo: "(3.4236,6.4325)",
  rsvp_discoverable: true,
  rsvp_capacity: 40,
  rsvp_allow_plus_ones: false,
  rsvp_plus_ones_max: 0,
  rsvp_waitlist_enabled: false,
  rsvp_approval_mode: "auto",
  rsvp_going_count: 0,
  location_provider_place_id: PLACE_ID,
  ...patch,
});

const viewQuery = (data: unknown) => ({
  select: () => ({
    eq: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }),
      maybeSingle: () => Promise.resolve({ data, error: null }),
    }),
  }),
});

const emptyTicketsQuery = {
  select: () => ({
    eq: () => ({
      eq: () => ({
        is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  }),
};

const wire = (row: unknown) => {
  fromMock.mockImplementation((table: unknown) =>
    table === "business_public_events_view" ? viewQuery(row) : emptyTicketsQuery,
  );
  // The ticketed bundle answers SQL NULL for an RSVP; every other RPC is empty.
  rpcMock.mockImplementation(() => Promise.resolve({ data: null, error: null }));
};

const webLinkFor = (event: {
  venueName?: string | null;
  address?: string | null;
  locationGeo?: { lat: number; lng: number } | null;
  googlePlaceId?: string | null;
}) => {
  const target = selectVenueMapsTarget({
    venueName: event.venueName ?? null,
    address: event.address ?? null,
    addressHidden: false,
    locationGeo: event.locationGeo ?? null,
    googlePlaceId: event.googlePlaceId ?? null,
  });
  if (target === null) throw new Error("no maps target");
  return buildMapsDeepLink({ platform: "web", ...target });
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("#4334 — public RSVP pages carry the Google place id from the view", () => {
  test("R-1 by slug and by id, the view's place id reaches the event", async () => {
    wire(viewRow());
    const bySlug = await getPublicEventBySlug("didi", "garden-party");
    expect(bySlug?.event.event_type).toBe("rsvp");
    expect(bySlug?.event.googlePlaceId).toBe(PLACE_ID);
    wire(viewRow());
    const byId = await getPublicEventById(EVENT_ID);
    expect(byId?.event.googlePlaceId).toBe(PLACE_ID);
  });

  test("R-2 the web Maps link is anchored on the place id", async () => {
    wire(viewRow());
    const detail = await getPublicEventBySlug("didi", "garden-party");
    if (detail === null) throw new Error("RSVP did not resolve");
    const link = webLinkFor(detail.event);
    expect(link?.url).toContain(`query_place_id=${PLACE_ID}`);
  });

  test("R-3 a withheld, blank or absent id maps to null and the link uses the coordinate", async () => {
    for (const patch of [
      { location_provider_place_id: null },
      { location_provider_place_id: "  " },
      { location_provider_place_id: undefined },
    ]) {
      wire(viewRow(patch));
      const detail = await getPublicEventBySlug("didi", "garden-party");
      expect(detail?.event.googlePlaceId).toBeNull();
      if (detail === null) throw new Error("RSVP did not resolve");
      const link = webLinkFor(detail.event);
      expect(link?.url).not.toContain("query_place_id");
      expect(link?.url).toContain("6.4325,3.4236");
    }
  });
});

// ── R3-1 venue pages: the venue's Google place id reaches the Maps target ─────
const REPO = path.resolve(__dirname, "../../../..");
const code = (rel: string): string =>
  readFileSync(path.join(REPO, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("#4334 R3-1 — venue pages carry the venue's Google place id to the Maps link", () => {
  test("V-1 venue_public_view.google_place_id maps to PublicVenue.googlePlaceId (blank → null)", () => {
    const row = {
      id: "v1", brand_id: "b1", brand_slug: "didi", brand_name: "Didi", slug: "museum", name: "Didi Museum",
      address: "175 Akin Adesola St", city: "Lagos", country_code: "NG", lat: 6.4325, lng: 3.4236,
      venue_category: "creative_and_arts", contact_email: null, contact_phone: null, cover_media_url: null,
      cover_media_type: null, place_pool_id: null, theme_color: null, theme_font: null, theme_animation: null,
      cover_hue: 25, default_currency: "NGN", hours: [], iana_timezone: "Africa/Lagos", pitch: null,
      google_place_id: PLACE_ID,
    } as unknown as Parameters<typeof venuePublicViewRowToPublicVenue>[0];
    expect(venuePublicViewRowToPublicVenue(row).googlePlaceId).toBe(PLACE_ID);
    expect(
      venuePublicViewRowToPublicVenue({ ...row, google_place_id: " " } as typeof row).googlePlaceId,
    ).toBeNull();
  });

  test("V-2 the shared venue screen puts it on the target; both apps' adapters pass it", () => {
    expect(code("packages/brand-rendering/PublicVenueScreen.tsx")).toContain(
      "const candidate: MapsOpenTarget = { label, geo, googlePlaceId: venue.googlePlaceId ?? null };",
    );
    expect(code("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx")).toContain(
      "googlePlaceId: venue.googlePlaceId ?? null,",
    );
    expect(code("app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx")).toContain("googlePlaceId: venue.googlePlaceId,");
    expect(code("app-mobile/src/services/publicVenueService.ts")).toMatch(/googlePlaceId:\s*typeof row\.google_place_id === "string"/);
  });
});
