// ORCH-426 G1 — pre-serialized gzip response bytes for hot-path serving.

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  encodeDiscoverResponse,
  wantsGzip,
} from "../_response-bytes.ts";
import type { DiscoverMergedResponse } from "../_types.ts";

const SAMPLE: DiscoverMergedResponse = {
  items: [],
  meta: {
    businessCount: 0,
    ticketmasterCount: 0,
    businessTotalAvailable: 0,
    ticketmasterTotalAvailable: 0,
    tmCalled: false,
    tmError: null,
    page: 1,
    pageSize: 20,
    fromCache: false,
  },
};

Deno.test("encodeDiscoverResponse produces smaller gzip payload", async () => {
  const large: DiscoverMergedResponse = {
    ...SAMPLE,
    items: Array.from({ length: 20 }, (_, i) => ({
      source: "business_event" as const,
      item: {
        eventId: `evt-${i}`,
        brandId: "brand",
        brandSlug: "brand",
        eventSlug: `event-${i}`,
        brandName: "Brand",
        brandProfilePhotoUrl: null,
        title: "Sample event title with enough text to compress",
        description: "Long description ".repeat(40),
        coverMediaUrl: "https://example.com/cover.jpg",
        coverMediaType: "image" as const,
        coverHue: 25,
        masterDateUtc: "2026-06-15T00:00:00Z",
        masterEndAtUtc: "2026-06-16T00:00:00Z",
        doorsOpenLocal: "7:00 PM",
        endsAtLocal: "11:00 PM",
        timezone: "America/Chicago",
        venueName: "Venue",
        city: "Austin",
        address: "123 Main St",
        hideAddressUntilTicket: true,
        format: "in-person" as const,
        locationGeo: { lat: 30.27, lng: -97.74 },
        partyTypes: ["nightlife"],
        vibeTags: ["live-music"],
        musicGenres: ["pop"],
        priceMin: 10,
        priceMax: 50,
        displayPriceCents: 2500,
        displayCurrency: "USD",
        currency: "USD",
        publicBuyerUrl: "https://business.mingla.app/e/brand/event",
      },
    })),
  };

  const { json, gzip } = await encodeDiscoverResponse(large);
  assert(gzip.length > 0);
  assert(gzip.length < json.length, "gzip should shrink repetitive JSON");
});

Deno.test("wantsGzip respects Accept-Encoding header", () => {
  const gzipReq = new Request("https://example.com", {
    headers: { "Accept-Encoding": "gzip, deflate" },
  });
  const plainReq = new Request("https://example.com");
  assert(wantsGzip(gzipReq));
  assert(!wantsGzip(plainReq));
});
