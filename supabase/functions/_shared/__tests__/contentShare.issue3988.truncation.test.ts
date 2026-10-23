import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapAuthoritativeShareFacts } from "../contentShare.ts";
import { validatePublicContentShareEnvelope } from "../contentShareService.ts";

Deno.test("#3988 event descriptions truncated on whitespace still produce a valid public share", () => {
  const description = `${"a".repeat(599)} ${"more event details ".repeat(20)}`;
  const mapped = mapAuthoritativeShareFacts("event", {
    row: {
      id: "9132b8c6-7f80-4833-bf69-c37879f4f560",
      title: "FoodieFantasy By The Sea",
      slug: "foodiefantasy-by-the-sea",
      description,
      timezone: "Africa/Lagos",
      location_text: "Lagos",
      brands: { slug: "foodiefantasybythesea" },
    },
    date: { start_at: "2026-11-01T12:00:00Z", timezone: "Africa/Lagos" },
    addressWithheld: false,
  });
  const envelope = {
    state: "active",
    gone: false,
    version: 1,
    shortCode: "Aa0Bb1Cc2Dd3Ee4F",
    facts: mapped.facts,
    media: mapped.mediaIdentity,
    destination: Object.fromEntries(
      Object.entries(mapped.destinationManifest).filter(([key]) =>
        key !== "publicDetails"
      ),
    ),
    publicDetails: mapped.publicDetails,
  };

  assertEquals(mapped.facts.description.length, 599);
  assertEquals(mapped.facts.description, mapped.facts.description.trim());
  assertNotEquals(validatePublicContentShareEnvelope(envelope), null);
});
