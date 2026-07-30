import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const edge = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20270129001384_issue_1384_discovery_price_currency.sql",
    import.meta.url,
  ),
);

Deno.test("issue 1384 filters canonical money inside the ranked SQL RPC", () => {
  assertStringIncludes(edge, "issue_1384_query_servable_places_by_signal");
  assertStringIncludes(edge, "p_price_filter_currency: priceFilterCurrency");
  const functionStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1384_query_servable_places_by_signal",
  );
  const orderAt = migration.indexOf(
    "ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST",
    functionStart,
  );
  const limitAt = migration.indexOf("LIMIT p_limit", orderAt);
  const predicateAt = migration.indexOf(
    "p_price_filter_currency IS NULL",
    functionStart,
  );
  assert(functionStart >= 0);
  assert(predicateAt > functionStart && predicateAt < orderAt);
  assert(orderAt < limitAt);
});

Deno.test("issue 1384 unsupported viewer currency degrades but filter fails closed", () => {
  assertStringIncludes(
    edge,
    "requestedDisplayCurrency && supportedCurrencyCodes.has(requestedDisplayCurrency)",
  );
  assertStringIncludes(
    edge,
    "!supportedCurrencyCodes.has(priceFilterCurrency)",
  );
  assertStringIncludes(edge, "throw new Error('FX_UNAVAILABLE')");
  assertStringIncludes(
    migration,
    "unsupported viewer\n  -- currency degrades to exact source money",
  );
});

Deno.test("issue 1384 returns and validates one pinned snapshot", () => {
  assertStringIncludes(edge, ".eq('id', requestedFxSnapshotId)");
  assertStringIncludes(edge, ".in('status', ['active', 'superseded'])");
  assertStringIncludes(edge, "Date.parse(requestedSnapshot.expires_at) < Date.now()");
  assertStringIncludes(edge, "fxSnapshotId,");
  assertEquals(
    edge.includes("p_fx_snapshot_id: fxSnapshotId"),
    true,
  );
});
