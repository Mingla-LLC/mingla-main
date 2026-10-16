/**
 * #3281 Round 1 PR 1d / #1672 — tester adversarial (node:test).
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

test("adversarial: curated AI plan with stops stays curated", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const curated = {
    cardType: "curated",
    title: "A Lagos night",
    tagline: "Dinner, then the water",
    experienceType: "romantic",
    stops: [
      { placeId: "s1", placeName: "Dinner" },
      { placeId: "s2", placeName: "The water" },
    ],
  };
  assert.equal(isBrandExperiencePayload(curated), false);
  assert.equal(savedCardToExpandedCardData(curated).cardType, "curated");
});

test("adversarial: legacy stops-only row stays curated", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const legacy = {
    title: "Old save",
    stops: [{ placeId: "s1", placeName: "A" }],
  };
  assert.equal(isBrandExperiencePayload(legacy), false);
  assert.equal(savedCardToExpandedCardData(legacy).cardType, "curated");
});

test("adversarial: explicit experience tag wins even with empty brandId", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const tagged = {
    cardType: "experience",
    brandId: "",
    eventId: "e1",
    brandSlug: "b",
    eventSlug: "e",
    stops: [{ placeId: "s1" }],
  };
  assert.equal(isBrandExperiencePayload(tagged), true);
  assert.equal(savedCardToExpandedCardData(tagged).cardType, "experience");
});

test("adversarial: structural recovery refuses empty brandId", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const incomplete = {
    brandId: "",
    eventId: "e1",
    stops: [{ placeId: "s1" }],
  };
  assert.equal(isBrandExperiencePayload(incomplete), false);
  assert.equal(savedCardToExpandedCardData(incomplete).cardType, "curated");
});

test("adversarial: structural recovery refuses missing eventId", async () => {
  const { isBrandExperiencePayload } = await import(
    path.join(UTILS, "isBrandExperiencePayload.ts")
  );
  const incomplete = {
    brandId: "b1",
    stops: [{ placeId: "s1" }],
  };
  assert.equal(isBrandExperiencePayload(incomplete), false);
});

test("adversarial fails-on-revert: must not stamp curated over experience", async () => {
  const { savedCardToExpandedCardData } = await import(MAPPER);
  const experience = {
    cardType: "experience",
    brandId: "b1",
    eventId: "e1",
    brandSlug: "brand",
    eventSlug: "exp",
    title: "Paid thing",
    stops: [{ placeId: "s1", placeName: "Start" }],
  };
  const mapped = savedCardToExpandedCardData(experience);
  assert.notEqual(
    mapped.cardType,
    "curated",
    "revert of #3281 1d: curated stamp destroys Book (#1672)",
  );
  assert.equal(mapped.cardType, "experience");
});
