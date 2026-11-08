/**
 * #4334 rework A-2 / A-1 — the Host app sends the picked Google place id in the
 * SAME write as the coordinates, on every save path that writes Google
 * coordinates; buyer web reads googlePlaceId from pg_public_event_by_slug.
 * (The database half — each RPC writing the id beside the pin — is proven in
 * supabase/migrations/__tests__/issue_4334_place_id_write_paths.implementor.pg17.test.sql.)
 *
 *   E-*  events: draft autosave payload + blob echo, published RSVP diff,
 *        live edit taxonomy, Where step pick and typed address
 *   T-*  trips (create + live edit), X-* experience stops
 *   B-*  brand location (direct table write): patch builders + row mapping
 *   V-*  venues: create RPC arg (no separate attach call), identity edits
 *   F-*  a typed (free-text) address carries the place it resolved to
 *   W-*  buyer web: googlePlaceId mapped from the public read and merged
 *
 * Fails-on-revert: delete any one `locationProviderPlaceId` / `p_location_place_id`
 * / `location_provider_place_id` line this suite names → its test goes red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: jest.fn() },
  },
}));

import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import {
  buildRsvpUpdatePayloadDiff,
  draftLocationPlaceId,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../../utils/serverDraftEventMapper";
import {
  brandAddressPatchFromLocation,
  brandAddressPatchFromPlace,
} from "../../utils/brandAddressPatch";
import { mapUiToBrandUpdatePatch } from "../brandMapping";
import { identityPatchToRpcArgs } from "../venueDetailsEditService";
import { resolveFreeTextLocation } from "../../utils/resolveApproxLocation";
import { fetchCanonicalEventBodyFields } from "../publicEventsService";
import type { PlaceDetails } from "../placesService";

const ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const ID2 = "ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8";
const PIN = { lat: 6.4325387, lng: 3.4236889 };
const ROOT = path.resolve(__dirname, "../../..");
const src = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b46d2",
    brandId: "64cb8e35-5b53-4633-8780-d7769bead244",
    name: "Supper",
    description: "",
    format: "in_person",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    whenMode: "single",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: [],
    venueName: "Didi Museum",
    address: "175 Akin Adesola St",
    city: "Lagos",
    locationGeo: PIN,
    coordinatePrecision: "exact",
    locationProviderPlaceId: ID,
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    isRsvp: true,
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: false,
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    lastStepReached: 3,
    status: "draft",
    createdAt: "2026-11-08T08:00:00.000Z",
    updatedAt: "2026-11-08T08:00:00.000Z",
    ...patch,
  }) as DraftEvent;

beforeEach(() => {
  mockRpc.mockReset();
});

describe("events", () => {
  test("E-1 the draft save writes the id beside location_geo, and the blob carries it", () => {
    const payload = draftToServerUpdate(draft(), {});
    expect(payload.location_geo).toBe("(3.4236889,6.4325387)");
    expect(payload.location_provider_place_id).toBe(ID);
    expect(
      (payload.theme as { business_draft: { locationProviderPlaceId: unknown } }).business_draft
        .locationProviderPlaceId,
    ).toBe(ID);
  });

  test("E-2 no pin, no id: an id never outlives its coordinate", () => {
    expect(draftLocationPlaceId({ locationGeo: null, locationProviderPlaceId: ID })).toBeNull();
    expect(draftToServerUpdate(draft({ locationGeo: null }), {}).location_provider_place_id).toBeNull();
    expect(draftToServerUpdate(draft({ locationProviderPlaceId: undefined }), {}).location_provider_place_id).toBeNull();
  });

  test("E-3 the autosave echo restores the id from the blob", () => {
    const payload = draftToServerUpdate(draft(), {});
    const row = {
      id: "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b46d2",
      brand_id: "64cb8e35-5b53-4633-8780-d7769bead244",
      title: "Supper",
      description: "",
      slug: "draft-abcd",
      theme: payload.theme,
      location_geo: "(3.4236889,6.4325387)",
      city: "Lagos",
      timezone: "Africa/Lagos",
      status: "draft",
      visibility: "draft",
      created_at: "2026-11-08T08:00:00.000Z",
      updated_at: "2026-11-08T08:00:00.000Z",
    } as unknown as ServerDraftEventRow;
    expect(serverRowToDraft(row).locationProviderPlaceId).toBe(ID);
  });

  test("E-4 a published RSVP re-pick sends the id with the pin; an untouched pin sends neither", () => {
    const original = { ...draft(), locationGeo: { lat: 6.4, lng: 3.4 } } as unknown as LiveEvent;
    const repicked = buildRsvpUpdatePayloadDiff(original, draft({ locationProviderPlaceId: ID2 }));
    expect(repicked.location_geo).toBe("(3.4236889,6.4325387)");
    expect(repicked.location_provider_place_id).toBe(ID2);
    const same = buildRsvpUpdatePayloadDiff({ ...draft() } as unknown as LiveEvent, draft());
    expect("location_provider_place_id" in same).toBe(false);
  });

  test("E-5 the live edit taxonomy carries the re-picked id; the RPC owner reads it", () => {
    const screen = src("src/components/event/EditPublishedScreen.tsx");
    expect(screen).toMatch(/locationProviderPlaceId:\s*\n\s*patch\.locationGeo === null\s*\n\s*\? null\s*\n\s*: \(editState\.locationProviderPlaceId \?\? null\)/);
  });

  test("E-6 the Where step sets the id on a pick and on a typed address, and clears it with the pin", () => {
    const where = src("src/components/event/CreatorStep3Where.tsx");
    expect(where).toContain("locationProviderPlaceId: details.placeId,");
    expect(where).toContain("locationProviderPlaceId: approx.placeId,");
    expect(where.match(/locationGeo: null,\n\s*locationProviderPlaceId: null,/g)?.length).toBe(4);
  });
});

describe("trips and experience stops", () => {
  test("T-1 trip create and live edit: a typed address keeps its place id", () => {
    for (const file of [
      "src/components/trip/TripCreatorStep1Basics.tsx",
      "src/components/trip/EditPublishedTripScreen.tsx",
    ]) {
      const s = src(file);
      expect(s).toContain("departurePlaceId: approx.placeId,");
      expect(s).toContain("destinationPlaceId: approx.placeId,");
    }
  });

  test("X-1 an experience stop's typed address keeps its place id (sent as stop place_id)", () => {
    expect(src("src/components/experience/ExperienceStopCard.tsx")).toContain("placeId: approx.placeId,");
    expect(src("src/components/experience/ExperienceCreatorWizard.tsx")).toContain("place_id: s.placeId,");
  });
});

describe("brand location (direct table write)", () => {
  const details = {
    placeId: ID,
    formattedAddress: "175 Akin Adesola St, Lagos",
    city: "Lagos",
    countryCode: "NG",
    location: PIN,
  } as unknown as PlaceDetails;

  test("B-1 a picked address patch carries the place id; a pin without one clears it", () => {
    expect(brandAddressPatchFromPlace(details).locationProviderPlaceId).toBe(ID);
    expect(
      brandAddressPatchFromLocation("Lagos", { ...PIN, city: "Lagos", countryCode: "NG" })
        .locationProviderPlaceId,
    ).toBeNull();
  });

  test("B-2 the brand row update writes location_provider_place_id with lat/lng", () => {
    const out = mapUiToBrandUpdatePatch({ lat: PIN.lat, lng: PIN.lng, locationProviderPlaceId: ID });
    expect(out).toMatchObject({ lat: PIN.lat, lng: PIN.lng, location_provider_place_id: ID });
  });

  test("B-3 brand creation sends the picked and the typed id", () => {
    const flow = src("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).toContain("locationProviderPlaceId: p.placeId,");
    expect(flow).toContain("locationProviderPlaceId: approx.placeId,");
    expect(flow).toContain("patch.locationProviderPlaceId = geo.locationProviderPlaceId;");
  });
});

describe("venues", () => {
  test("V-1 venue create passes p_location_place_id in the create RPC; no separate attach call", () => {
    const svc = src("src/services/venueListingsService.ts");
    expect(svc).toContain("p_location_place_id: input.locationProviderPlaceId ?? null,");
    expect(svc).not.toContain("biz_set_location_place_id");
    expect(svc).not.toContain("attachLocationPlaceId");
    expect(src("src/components/venue/VenueStep1Address.tsx")).toContain("locationProviderPlaceId: approx.placeId,");
  });

  test("V-2 identity edits send p_location_place_id only with a changed address", () => {
    const withAddress = identityPatchToRpcArgs("v-1", {
      address: { address: "1 Road", city: "Lagos", countryCode: "NG", ...PIN, coordinatePrecision: "exact", locationProviderPlaceId: ID },
    });
    expect(withAddress.p_location_place_id).toBe(ID);
    expect("p_location_place_id" in identityPatchToRpcArgs("v-1", { name: "New name" })).toBe(false);
    const editor = src("src/components/venue/VenueDetailsEditor.tsx");
    expect(editor).toContain("locationProviderPlaceId: place.placeId,");
    expect(editor).toContain("locationProviderPlaceId: approx.placeId,");
  });
});

describe("typed addresses", () => {
  test("F-1 a free-text resolution carries the place it resolved to", async () => {
    const resolution = await resolveFreeTextLocation("12 Admiralty Way, Lekki", {}, {
      forwardHierarchy: async () => ({
        details: { ...PIN, city: "Lagos", region: "Lagos", countryCode: "NG", placeId: ID },
        matchLevel: "place",
        matchedQuery: "12 Admiralty Way, Lekki",
      }),
    });
    expect(resolution.status === "selected" && resolution.location.placeId).toBe(ID);
  });
});

describe("buyer web", () => {
  test("W-1 the public read's googlePlaceId is mapped (null when withheld or absent)", async () => {
    mockRpc.mockImplementationOnce(async () => ({ data: { googlePlaceId: ID, cityGeo: null }, error: null }));
    expect((await fetchCanonicalEventBodyFields("brand", "event")).googlePlaceId).toBe(ID);
    mockRpc.mockImplementationOnce(async () => ({ data: { googlePlaceId: null }, error: null }));
    expect((await fetchCanonicalEventBodyFields("brand", "event")).googlePlaceId).toBeNull();
  });

  test("W-2 the merged buyer event and the page props carry the id", () => {
    expect(src("src/services/publicEventsService.ts")).toContain("googlePlaceId: canonical.googlePlaceId,");
    expect(src("src/components/event/PublicEventPage.tsx")).toContain("googlePlaceId: event.googlePlaceId ?? null,");
  });
});
