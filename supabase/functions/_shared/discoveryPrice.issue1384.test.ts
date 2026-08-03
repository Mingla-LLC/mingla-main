import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isExplicitFreeRange,
  mapDiscoveryPriceView,
  normalizeIsoCurrency,
  shouldShowDiscoveryPrice,
} from "./discoveryPrice.ts";

Deno.test("issue 1384 maps canonical source and pinned display money", () => {
  const value = mapDiscoveryPriceView({
    price_range_status: "active",
    source_min_minor: "150000",
    source_max_minor: "300000",
    source_currency_code: "NGN",
    display_min_minor: "1000",
    display_max_minor: "2000",
    display_currency_code: "USD",
    price_is_approximate: true,
    fx_snapshot_id: "snapshot-1",
    fx_provider: "exchange_rate_api_open_v6",
    fx_freshness: "fresh",
  });
  assertEquals(value?.sourceCurrencyCode, "NGN");
  assertEquals(value?.sourceMinMinor, 150000);
  assertEquals(value?.displayCurrencyCode, "USD");
  assertEquals(value?.priceIsApproximate, true);
  assertEquals(shouldShowDiscoveryPrice(value), true);
});

Deno.test("issue 1384 never fabricates free from absent or unresolved data", () => {
  assertEquals(isExplicitFreeRange(null), false);
  assertEquals(isExplicitFreeRange(mapDiscoveryPriceView({
    price_range_status: "legacy_unresolved",
  })), false);
  assertEquals(isExplicitFreeRange(mapDiscoveryPriceView({
    price_range_status: "active",
    source_min_minor: 0,
    source_max_minor: 0,
    source_currency_code: "USD",
    price_is_approximate: false,
    fx_freshness: "not_needed",
  })), true);
});

Deno.test("issue 1384 rejects malformed and unpinned approximate views", () => {
  assertEquals(normalizeIsoCurrency(" ngn "), "NGN");
  assertEquals(normalizeIsoCurrency("$"), null);
  assertEquals(mapDiscoveryPriceView({
    price_range_status: "active",
    source_min_minor: 100,
    source_currency_code: "USD",
    price_is_approximate: true,
    fx_snapshot_id: null,
  }), null);
});
