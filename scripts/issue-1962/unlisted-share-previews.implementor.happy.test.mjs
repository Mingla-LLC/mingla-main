/**
 * Issue #1962 implementor proof.
 * FAILS-ON-REVERT: removing hidden from the exact share mapper fails H1; moving
 * crawler reads back to the discovery view fails H3-H6.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createContentShareV1 } from "../../supabase/functions/_shared/contentShareService.ts";

const require = createRequire(import.meta.url);
const {
  directEventBundleToPreviewRow,
  fetchPublicEventById,
  fetchPublicEventBySlug,
  renderEventHtml,
} = require("../../mingla-business/server/socialPreview.js");

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = {};
  }
  select() { return this; }
  eq(key, value) { this.filters[key] = value; return this; }
  in() { return this; }
  not() { return this; }
  is() { return this; }
  limit() { return this; }
  order() { return this; }
  gte() { return this; }
  async maybeSingle() {
    if (this.table !== "events") return { data: null, error: null };
    if (this.db.eventType !== this.filters.event_type) return { data: null, error: null };
    return {
      data: {
        id: "event-id",
        title: "Collector's Preview",
        description: "An exact-link gallery preview.",
        slug: this.filters.slug || "collectors-preview",
        location_text: "Art Roost Gallery",
        status: "scheduled",
        visibility: this.db.visibility,
        published_at: this.db.publishedAt,
        deleted_at: this.db.deletedAt,
        timezone: "Africa/Lagos",
        event_type: this.db.eventType,
        brands: [{ name: "Mingla Nigeria", slug: this.filters["brands.slug"] || "minglanigeria", deleted_at: null }],
      },
      error: null,
    };
  }
  then(resolve) {
    if (this.table === "event_dates") return resolve({ data: [{ start_at: "2026-08-29T17:00:00Z", end_at: "2026-08-29T20:00:00Z", timezone: "Africa/Lagos", is_master: true }], error: null });
    if (this.table === "ticket_types") return resolve({ data: [], error: null });
    return resolve({ data: [], error: null });
  }
}

class ShareDb {
  constructor(visibility, { publishedAt = "2026-08-12T18:27:13Z", deletedAt = null, eventType = "event" } = {}) {
    this.visibility = visibility;
    this.publishedAt = publishedAt;
    this.deletedAt = deletedAt;
    this.eventType = eventType;
  }
  from(table) { return new Query(this, table); }
  async rpc(name, args) {
    if (name === "pg_public_ticket_types_remaining" || name === "pg_public_event_tier_allin") return { data: [], error: null };
    if (name === "resolve_content_share_message") return { data: `Collector's Preview\n\nhttps://usemingla.com/s/${args.p_code}`, error: null };
    assert.equal(name, "upsert_content_share_version");
    return { data: { shortCode: "Aa0Bb1Cc2Dd3Ee4F", version: 1, versionCreated: true }, error: null };
  }
}

const createEventShare = (visibility, options) => createContentShareV1(
  new ShareDb(visibility, options),
  null,
  { kind: "event", identity: { brandSlug: "minglanigeria", eventSlug: "collectors-preview" } },
  { serverCreated: true },
);

test("H1 exact Unlisted event identity creates a share while denied rows stay unavailable", async () => {
  const hidden = await createEventShare("hidden");
  assert.equal(hidden.status, 201);
  assert.equal(hidden.body.shortCode, "Aa0Bb1Cc2Dd3Ee4F");
  assert.equal(hidden.body.facts.title, "Collector's Preview");
  assert.equal(hidden.body.destination.webPath, "/e/minglanigeria/collectors-preview");

  for (const denied of [
    await createEventShare("private"),
    await createEventShare("hidden", { publishedAt: null }),
    await createEventShare("hidden", { deletedAt: "2026-08-12T18:27:13Z" }),
    await createEventShare("hidden", { eventType: "rsvp" }),
  ]) assert.deepEqual(denied, { status: 404, body: { error: "not_found" } });
});

test("H2 Public event share behavior remains compatible", async () => {
  const result = await createEventShare("public");
  assert.equal(result.status, 201);
  assert.equal(result.body.facts.kind, "event");
  assert.equal(result.body.publicDetails.kind, "event");
});

const directPayload = {
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
  brand: { id: "brand-id", slug: "minglanigeria", name: "Mingla Nigeria", profilePhotoUrl: null },
  tickets: [],
};

test("H3 the pure exact-event adapter supplies real crawler metadata", () => {
  const row = directEventBundleToPreviewRow(directPayload);
  assert.equal(row.brand_name, "Mingla Nigeria");
  assert.equal(row.slug, "collectors-preview");
  assert.equal(row.event_type, "event");
  const html = renderEventHtml(row);
  assert.match(html, /Collector&#39;s Preview by Mingla Nigeria \| Mingla/);
  assert.match(html, /property="og:image" content="https:\/\/business\.usemingla\.com\/og\/event\/event-id\.png"/);
});

test("H3b video covers use a real authored gallery image and local event date", () => {
  const row = directEventBundleToPreviewRow({
    ...directPayload,
    masterStartAt: "2026-08-30T03:30:00Z",
    timezone: "America/New_York",
    coverMediaType: "video",
    coverMediaUrl: "https://videos.pexels.com/video-files/1/cover.mp4",
    coverGallery: [
      { type: "video", url: "https://videos.pexels.com/video-files/2/gallery.mp4" },
      { type: "image", url: "https://images.pexels.com/photos/2/gallery.jpg" },
    ],
  });
  assert.equal(row.cover_media_url, "https://images.pexels.com/photos/2/gallery.jpg");
  assert.equal(row.cover_media_type, "image");
  assert.equal(row.public_theme.business_event.when.date, "2026-08-29");
});

const withFetch = async (implementation, run) => {
  const prior = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); } finally { globalThis.fetch = prior; }
};

test("H4 slug and ID crawler reads use the exact RPC and never enumerate the discovery view", async () => {
  const calls = [];
  await withFetch(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(directPayload), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    assert.equal((await fetchPublicEventBySlug("minglanigeria", "collectors-preview")).title, "Collector's Preview");
    assert.equal((await fetchPublicEventById("event-id")).id, "event-id");
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.endsWith("/rest/v1/rpc/pg_direct_event_checkout_bundle")));
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_event_id: null, p_brand_slug: "minglanigeria", p_event_slug: "collectors-preview" });
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_event_id: "event-id", p_brand_slug: null, p_event_slug: null });
});

test("H5 SQL null opens only the RSVP fallback", async () => {
  const calls = [];
  const rsvp = { id: "rsvp-id", event_type: "rsvp", title: "Gallery RSVP" };
  const result = await withFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes("/rpc/")) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify([rsvp]), { status: 200, headers: { "content-type": "application/json" } });
  }, () => fetchPublicEventBySlug("minglanigeria", "gallery-rsvp"));
  assert.deepEqual(result, rsvp);
  assert.match(calls[1], /business_public_events_view/);
  assert.match(calls[1], /event_type=eq\.rsvp/);
  assert.doesNotMatch(calls[1], /visibility/);
});

test("H6 RPC failure is operational failure, not fabricated not-found or fallback", async () => {
  let calls = 0;
  await assert.rejects(withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  }, () => fetchPublicEventBySlug("minglanigeria", "collectors-preview")), /preview RPC failed: 503/);
  assert.equal(calls, 1);
});
