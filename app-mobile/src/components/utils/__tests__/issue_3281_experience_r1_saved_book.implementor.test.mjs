/**
 * #3281 Round 1 PR 1d / #1672 — implementor happy path (node:test).
 *
 * A saved brand experience must keep `cardType: 'experience'`, brand attribution,
 * cover/envelope fields, and map to a BusinessEventCard that can open Book.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
register(
  pathToFileURL(
    path.join(
      __dirname,
      "../../expandedCard/__tests__/issue_1605_ts_resolve_hooks.mjs",
    ),
  ),
);

const UTILS = path.resolve(__dirname, "../../../utils");
const MAPPER = path.resolve(__dirname, "../savedCardToExpandedCardData.ts");

const BRAND_EXPERIENCE = {
  cardType: "experience",
  id: "evt-9001",
  eventId: "evt-9001",
  brandId: "brand-7001",
  brandSlug: "smoke-rhythm",
  brandName: "Smoke & Rhythm",
  eventSlug: "rooftop-supper",
  experienceType: "adventurous",
  title: "Rooftop Supper Club",
  tagline: "Four courses, one skyline",
  coverMediaUrl: "https://cdn.example/cover.jpg",
  currency: "NGN",
  totalPriceMin: 35000,
  totalPriceMax: 35000,
  estimatedDurationMinutes: 135,
  upcomingOccurrences: [
    {
      eventDateId: "d1",
      startAt: "2026-11-01T17:00:00.000Z",
      endAt: "2026-11-01T20:00:00.000Z",
      capacity: 20,
      sold: 2,
      remaining: 18,
    },
  ],
  stops: [
    {
      stopNumber: 1,
      placeId: "p1",
      placeName: "The Terrace",
      address: "1 Sky Way",
      priceMin: 0,
      priceMax: 0,
      imageUrl: "https://cdn.example/stop1.jpg",
      imageUrls: ["https://cdn.example/stop1.jpg"],
    },
    {
      stopNumber: 2,
      placeId: "p2",
      placeName: "The Cellar",
      address: "2 Sky Way",
      priceMin: 0,
      priceMax: 0,
      imageUrl: "",
      imageUrls: [],
    },
  ],
};

test("1d implementor: preserves experience discriminator, brand, cover, occurrences", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);

  assert.equal(isBrandExperiencePayload(BRAND_EXPERIENCE), true);
  const mapped = savedCardToExpandedCardData(BRAND_EXPERIENCE);
  assert.ok(mapped, "mapper returned null");
  assert.equal(
    mapped.cardType,
    "experience",
    "saved brand experience must not be stamped curated (#1672)",
  );
  assert.equal(mapped.brandId, "brand-7001");
  assert.equal(mapped.eventId, "evt-9001");
  assert.equal(mapped.coverMediaUrl, "https://cdn.example/cover.jpg");
  assert.equal(mapped.upcomingOccurrences?.length, 1);
  assert.equal(mapped.title, "Rooftop Supper Club");
});

test("1d implementor: maps to BusinessEventCard Book route", async () => {
  const { experienceRecToBusinessEventCard } = await import(
    path.join(UTILS, "experienceRecToBusinessEventCard.ts")
  );
  const bec = experienceRecToBusinessEventCard(BRAND_EXPERIENCE);
  assert.equal(bec.brandSlug, "smoke-rhythm");
  assert.equal(bec.eventSlug, "rooftop-supper");
  assert.equal(bec.experienceStops?.length, 2);
  assert.equal(bec.upcomingOccurrences?.length, 1);
  assert.equal(
    `/exp/${bec.brandSlug}/${bec.eventSlug}`,
    "/exp/smoke-rhythm/rooftop-supper",
  );
});

test("1d implementor: recovers experience when cardType was lost", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const lostTag = { ...BRAND_EXPERIENCE, cardType: undefined };
  assert.equal(isBrandExperiencePayload(lostTag), true);
  assert.equal(savedCardToExpandedCardData(lostTag).cardType, "experience");
});
