import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleDiscoverCards,
  resolveDiscoveryFxContext,
} from "./index.ts";

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
    "input.requestedDisplayCurrency &&\n      supportedCurrencyCodes.has(input.requestedDisplayCurrency)",
  );
  assertStringIncludes(
    edge,
    "!supportedCurrencyCodes.has(input.priceFilterCurrency)",
  );
  assertStringIncludes(edge, "throw new Error('FX_UNAVAILABLE')");
  assertStringIncludes(
    migration,
    "unsupported viewer\n  -- currency degrades to exact source money",
  );
});

Deno.test("issue 1384 returns and validates one pinned snapshot", () => {
  assertStringIncludes(edge, ".eq('id', input.requestedFxSnapshotId)");
  assertStringIncludes(edge, ".in('status', ['active', 'superseded'])");
  assertStringIncludes(edge, "Date.parse(requestedSnapshot.expires_at) < nowMs()");
  assertStringIncludes(edge, "fxSnapshotId,");
  assertEquals(
    edge.includes("p_fx_snapshot_id: fxSnapshotId"),
    true,
  );
});

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const NOW_MS = Date.parse("2026-07-30T00:00:00.000Z");

function makeFxClient(
  requestedSnapshot:
    | { id: string; status: "active" | "superseded"; expires_at: string }
    | null,
) {
  const rpcNames: string[] = [];
  const requestedIds: string[] = [];
  const client = {
    rpc(name: string) {
      rpcNames.push(name);
      if (name === "issue_1384_supported_currencies") {
        return Promise.resolve({
          data: [{ code: "USD" }, { code: "NGN" }],
          error: null,
        });
      }
      if (name === "fx_latest_servable_snapshot") {
        return Promise.resolve({
          data: [{ snapshot_id: S2 }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from(table: string) {
      assertEquals(table, "fx_rate_snapshots");
      const query = {
        select(_columns: string) {
          return query;
        },
        eq(column: string, value: string) {
          assertEquals(column, "id");
          requestedIds.push(value);
          return query;
        },
        in(column: string, statuses: string[]) {
          assertEquals(column, "status");
          assertEquals(statuses, ["active", "superseded"]);
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: requestedSnapshot, error: null });
        },
      };
      return query;
    },
  };
  return { client, rpcNames, requestedIds };
}

function discoveryRequest(overrides: Record<string, unknown>): Request {
  return new Request("https://example.test/functions/v1/discover-cards", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      categories: ["Fine Dining"],
      location: { lat: 35.7796, lng: -78.6382 },
      ...overrides,
    }),
  });
}

async function assertFxUnavailable(
  request: Request,
  requestedSnapshot:
    | { id: string; status: "active" | "superseded"; expires_at: string }
    | null,
): Promise<void> {
  const fake = makeFxClient(requestedSnapshot);
  const response = await handleDiscoverCards(request, {
    adminClient: fake.client,
    nowMs: () => NOW_MS,
  });
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    kind: "error",
    code: "FX_UNAVAILABLE",
    cards: [],
  });
  assertEquals(
    fake.rpcNames.includes("issue_1384_query_servable_places_by_signal"),
    false,
  );
}

Deno.test("issue 1384 live handler rejects an absent requested snapshot before serving", async () => {
  await assertFxUnavailable(
    discoveryRequest({ fxSnapshotId: S1, displayCurrency: "NGN" }),
    null,
  );
});

Deno.test("issue 1384 live handler rejects an expired requested snapshot before serving", async () => {
  await assertFxUnavailable(
    discoveryRequest({ fxSnapshotId: S1, displayCurrency: "NGN" }),
    {
      id: S1,
      status: "superseded",
      expires_at: "2026-07-29T23:59:59.000Z",
    },
  );
});

Deno.test("issue 1384 live handler rejects unsupported filter currency before serving", async () => {
  await assertFxUnavailable(
    discoveryRequest({
      priceFilterCurrency: "ZZZ",
      priceFilterMinMinor: 1,
    }),
    null,
  );
});

Deno.test("issue 1384 resolver keeps a valid superseded requested snapshot pinned", async () => {
  const fake = makeFxClient({
    id: S1,
    status: "superseded",
    expires_at: "2026-08-01T00:00:00.000Z",
  });
  const result = await resolveDiscoveryFxContext(
    {
      requestedDisplayCurrency: "NGN",
      requestedFxSnapshotId: S1,
      priceFilterCurrency: "NGN",
    },
    { client: fake.client, nowMs: () => NOW_MS },
  );
  assertEquals(result, { displayCurrency: "NGN", fxSnapshotId: S1 });
  assertEquals(fake.requestedIds, [S1]);
  assertEquals(fake.rpcNames.includes("fx_latest_servable_snapshot"), false);
});

Deno.test("issue 1384 resolver degrades unsupported display but fails unsupported filter", async () => {
  const displayFake = makeFxClient(null);
  const displayResult = await resolveDiscoveryFxContext(
    {
      requestedDisplayCurrency: "ZZZ",
      requestedFxSnapshotId: null,
      priceFilterCurrency: null,
    },
    { client: displayFake.client, nowMs: () => NOW_MS },
  );
  assertEquals(displayResult, {
    displayCurrency: null,
    fxSnapshotId: null,
  });

  const filterFake = makeFxClient(null);
  let error: unknown = null;
  try {
    await resolveDiscoveryFxContext(
      {
        requestedDisplayCurrency: null,
        requestedFxSnapshotId: null,
        priceFilterCurrency: "ZZZ",
      },
      { client: filterFake.client, nowMs: () => NOW_MS },
    );
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof Error);
  assertEquals(error.message, "FX_UNAVAILABLE");
});
