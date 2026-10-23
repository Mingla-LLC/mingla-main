import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { saleAvailabilityCopy } from "../saleAvailabilityCopy.ts";
import { experiencePriceBasisLabel } from "../experiencePriceBasis.ts";

const read = (file: string): string =>
  Deno.readTextFileSync(new URL(`../${file}`, import.meta.url));

Deno.test("#3872 offering scarcity outranks the end time", () => {
  assertEquals(
    saleAvailabilityCopy(3, "2027-12-01T12:00:00Z", "UTC"),
    "Only 3 left at this price",
  );
  assertMatch(
    saleAvailabilityCopy(11, "2027-12-01T12:00:00Z", "UTC") ?? "",
    /^Sale ends /,
  );
});

for (const [kind, file, remainingNeedle, saleNeedle] of [
  ["event", "EventOfferingBody.tsx", "ticket.saleRemaining", "saleAllIn"],
  ["experience", "ExperienceOfferingBody.tsx", "ticket.saleRemaining", "saleAllInCents"],
  ["trip", "TripOfferingBody.tsx", "tier.saleRemaining", "tripTierListPriceLabel(tier)"],
] as const) {
  Deno.test(`#3872 ${kind} renders server sale fields beside list price`, () => {
    const source = read(file);
    assertStringIncludes(source, "saleAvailabilityCopy");
    assertStringIncludes(source, remainingNeedle);
    assertStringIncludes(source, saleNeedle);
    assert(/textDecorationLine:\s*["']line-through["']/.test(source));
  });
}

Deno.test("#3872 experience retains the per-block basis label", () => {
  assertStringIncludes(read("ExperienceOfferingBody.tsx"), "experiencePriceBasisLabel");
  assertEquals(experiencePriceBasisLabel("block", 30), "per 30 min");
});
