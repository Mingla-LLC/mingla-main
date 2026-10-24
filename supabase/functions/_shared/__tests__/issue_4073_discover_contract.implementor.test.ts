import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { discoverCurrency } from "../discoverCurrency.ts";
import { discoverPriceBands } from "../discoverPriceBands.ts";
import { DISCOVER_CITY_WATCH_COPY, discoverCityWatchCopy } from "../discoverCityWatchCopy.ts";
import { isDiscoverV2Request } from "../../discover-merged-events/_v2_types.ts";
import { buildDiscoverV2Key } from "../../discover-merged-events/_v2_key.ts";

const locales = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
const copyFields = ["pushTitle", "pushBody", "emailSubject", "emailBody", "inappTitle", "inappBody"] as const;

Deno.test("#4073 resolves city currency before falling back to local supply currency", () => {
  assertEquals(discoverCurrency("gb", "NGN"), "GBP");
  assertEquals(discoverCurrency("NG", "USD"), "NGN");
  assertEquals(discoverCurrency(null, "eur"), "EUR");
  assertEquals(discoverCurrency(null, "not-money"), "USD");
});
Deno.test("#4073 publishes currency-specific price bands without fabricating an unknown currency", () => {
  assertEquals(discoverPriceBands("events", "GBP")?.edgesMinor, [2_000, 4_000]);
  assertEquals(discoverPriceBands("experiences", "NGN")?.edgesMinor, [2_000_000, 5_000_000]);
  assertEquals(discoverPriceBands("events", "JPY"), null);
});

Deno.test("#4073 cache keys normalize filter order and bind contract inputs", () => {
  const common = { contract: 2 as const, op: "page" as const, anchor: { name: "London", stateCode: null, countryCode: "GB", lat: 51.5, lng: -0.1, radiusKm: 50 } };
  const a = buildDiscoverV2Key({ ...common, filters: { kind: "events", f: { vibeTags: ["wild", "chill"], partyTypes: ["rave"] } } }, "g1", "Europe/London", "GBP");
  const b = buildDiscoverV2Key({ ...common, filters: { kind: "events", f: { partyTypes: ["rave"], vibeTags: ["chill", "wild"] } } }, "g1", "Europe/London", "GBP");
  assertEquals(a, b);
  assert(a.includes("tmHorizonDays"));
  assert(a.includes("tmSegmentMode"));
});

Deno.test("#4073 v2 discriminator cannot capture a v1 request", () => {
  assert(!isDiscoverV2Request({ city: { name: "London" } }));
  assert(isDiscoverV2Request({ contract: 2, op: "facets", anchor: {}, filters: {} }));
  assert(!isDiscoverV2Request({ contract: 2, op: "delete", anchor: {}, filters: {} }));
});

Deno.test("#4073 city-watch copy covers all 29 locales with byte-exact placeholders", () => {
  assertEquals(Object.keys(DISCOVER_CITY_WATCH_COPY).sort(), [...locales].sort());
  for (const locale of locales) {
    const copy = DISCOVER_CITY_WATCH_COPY[locale];
    for (const field of copyFields) {
      assert(copy[field].trim().length > 0, `${locale}.${field} is empty`);
      const expected = field === "pushTitle" || field === "emailSubject" || field === "emailBody" || field === "inappTitle" ? ["city"] : [];
      const actual = [...copy[field].matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      assertEquals(actual, expected, `${locale}.${field} placeholders`);
    }
  }
  assertEquals(discoverCityWatchCopy("unknown", "Accra").pushTitle, "Accra has plans now");
  assertEquals(discoverCityWatchCopy("fr", "Paris").pushTitle.includes("Paris"), true);
});
