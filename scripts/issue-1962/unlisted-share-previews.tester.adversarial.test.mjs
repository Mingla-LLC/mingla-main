/**
 * Issue #1962 independent tester proof.
 * Different angle: exact-reader denials remain indistinguishable and the
 * crawler adapter cannot carry management/payment fields into rendered data.
 * FAILS-ON-REVERT: removing the exact RPC reader breaks A1/A2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  directEventBundleToPreviewRow,
  fetchPublicEventBySlug,
} = require("../../mingla-business/server/socialPreview.js");

const withFetch = async (implementation, run) => {
  const prior = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); } finally { globalThis.fetch = prior; }
};

test("A1 private and unknown exact identities have the same null result and RSVP-only fallback", async () => {
  for (const eventSlug of ["private-event", "unknown-event"]) {
    const calls = [];
    const result = await withFetch(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return String(url).includes("/rpc/")
        ? new Response("null", { status: 200, headers: { "content-type": "application/json" } })
        : new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }, () => fetchPublicEventBySlug("minglanigeria", eventSlug));

    assert.equal(result, null);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/pg_direct_event_checkout_bundle$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      p_event_id: null,
      p_brand_slug: "minglanigeria",
      p_event_slug: eventSlug,
    });
    assert.match(calls[1].url, /business_public_events_view/);
    assert.match(calls[1].url, /event_type=eq\.rsvp/);
  }
});

test("A2 exact crawler adapter emits only public preview fields despite hostile extra payload keys", () => {
  const row = directEventBundleToPreviewRow({
    id: "event-id",
    brandId: "brand-id",
    brandSlug: "minglanigeria",
    eventSlug: "collectors-preview",
    name: "Collector's Preview",
    description: "An exact-link gallery preview.",
    masterStartAt: "2026-08-29T17:00:00Z",
    masterEndAt: "2026-08-29T20:00:00Z",
    timezone: "Africa/Lagos",
    status: "scheduled",
    isOnline: false,
    venueName: "Art Roost Gallery",
    coverMediaUrl: "https://images.pexels.com/photos/1/cover.jpg",
    coverMediaType: "image",
    coverGallery: [],
    city: "Lagos",
    brand: { name: "Mingla Nigeria", profilePhotoUrl: null },
    address: "private street",
    locationGeo: { lat: 1, lng: 2 },
    onlineUrl: "https://secret.example.test",
    tickets: [{ buyerEmail: "private@example.test" }],
    payoutAccount: "acct_private",
  });

  assert.equal(row.title, "Collector's Preview");
  for (const forbidden of ["address", "locationGeo", "onlineUrl", "tickets", "payoutAccount"]) {
    assert.equal(Object.hasOwn(row, forbidden), false, `${forbidden} crossed the preview adapter`);
  }
});

test("A3 incomplete exact payload fails closed instead of fabricating a preview", () => {
  assert.equal(directEventBundleToPreviewRow(null), null);
  assert.equal(directEventBundleToPreviewRow({ id: "event-id", name: "Missing identity" }), null);
  assert.equal(directEventBundleToPreviewRow([]), null);
});
