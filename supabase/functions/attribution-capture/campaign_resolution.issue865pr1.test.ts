// ISSUE-865 PR1 WP-1 — campaign resolution in attribution-capture::recordTouch.
//
// NEW (append-only). Proves the forward-only campaign link: a touch that carries
// the campaign click param (first-party `mc_id`, else the AppsFlyer `af_c_id` —
// both = ad_campaigns.external_campaign_id) is inserted with a RESOLVED
// campaign_id + brand_id (previously hard-coded null), and that the resolution is
// FAIL-OPEN (an unknown param / a missing campaign leaves them null, never
// throws, never blocks the touch).
//
// fails-on-revert target: restore `campaign_id: null` in recordTouch and the
// "resolves mc_id → campaign_id + brand_id" case fails.
//
// Hermetic: an injected fake client (per-table canned rows + a captured insert).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { type CaptureDeps, handleCapture } from "./index.ts";

interface FakeTables {
  ad_connections?: Record<string, unknown> | null;
  ad_campaigns?: Record<string, unknown> | null;
  brands?: Record<string, unknown> | null;
}

/** Fake Supabase — canned per-table rows + a captured ad_attribution_touches insert. */
function fakeClient(tables: FakeTables) {
  const inserted: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === "ad_attribution_touches") {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    const canned = (tables as Record<string, unknown>)[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      ilike: () => builder,
      is: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as NonNullable<
      ReturnType<CaptureDeps["getClient"]>
    >,
    inserted,
  };
}

function post(body: unknown): Request {
  return new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("WP-1: a touch with mc_id resolves campaign_id + brand_id (was hard-coded null)", async () => {
  const { client, inserted } = fakeClient({
    ad_connections: { id: "conn-lane" },
    ad_campaigns: {
      id: "cmp-123",
      connection_id: "conn-owned",
      platform: "meta",
      dest_brand_slug: "smoke-and-rhythm",
    },
    brands: { id: "brand-777" },
  });
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      lane: "consumer",
      surface: "web",
      mc_id: "EXT-CMP-9",
    }),
    { getClient: () => client },
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assertEquals(inserted.length, 1);
  const row = inserted[0];
  assertEquals(row.campaign_id, "cmp-123");
  assertEquals(row.brand_id, "brand-777");
});

Deno.test("WP-1: af_c_id resolves too (reuse the existing AppsFlyer param)", async () => {
  const { client, inserted } = fakeClient({
    ad_connections: { id: "conn-lane" },
    ad_campaigns: {
      id: "cmp-af",
      connection_id: "conn-af",
      platform: "tiktok",
      dest_brand_slug: "b",
    },
    brands: { id: "brand-af" },
  });
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "tiktok",
      lane: "consumer",
      surface: "web",
      af_c_id: "EXT-AF-1",
    }),
    { getClient: () => client },
  );
  assertEquals(res.status, 200);
  assertEquals(inserted[0].campaign_id, "cmp-af");
  assertEquals(inserted[0].brand_id, "brand-af");
});

Deno.test("WP-1: mc_id takes precedence over af_c_id when both present", async () => {
  let lookedUp = "";
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === "ad_attribution_touches") {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    if (table === "ad_campaigns") {
      return {
        select: () => ({
          eq: (_col: string, val: string) => {
            lookedUp = val;
            return {
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            };
          },
        }),
      };
    }
    const b = {
      select: () => b,
      eq: () => b,
      ilike: () => b,
      is: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    return b;
  };
  const client = { from } as unknown as NonNullable<
    ReturnType<CaptureDeps["getClient"]>
  >;
  await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      lane: "consumer",
      surface: "web",
      mc_id: "MC-WINS",
      af_c_id: "AF-LOSES",
    }),
    { getClient: () => client },
  );
  assertEquals(lookedUp, "MC-WINS");
});

Deno.test("WP-1 FAIL-OPEN: an unknown campaign param leaves campaign_id/brand_id null; the touch still records", async () => {
  const { client, inserted } = fakeClient({
    ad_connections: { id: "conn-lane" },
    ad_campaigns: null, // param does not resolve to any campaign
    brands: null,
  });
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      lane: "consumer",
      surface: "web",
      mc_id: "does-not-exist",
    }),
    { getClient: () => client },
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assertEquals(inserted[0].campaign_id, null);
  assertEquals(inserted[0].brand_id, null);
});

Deno.test("WP-1: NO campaign param → no lookup, campaign_id/brand_id null (byte-identical to pre-WP-1)", async () => {
  const { client, inserted } = fakeClient({
    ad_connections: { id: "c" },
    ad_campaigns: { id: "should-not-be-used" },
    brands: { id: "nope" },
  });
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      lane: "consumer",
      surface: "web",
      external_click_id: "fbclidX",
    }),
    { getClient: () => client },
  );
  assertEquals(res.status, 200);
  assertEquals(inserted[0].campaign_id, null);
  assertEquals(inserted[0].brand_id, null);
});

Deno.test("WP-1 FAIL-OPEN: a THROWING campaign lookup is absorbed — 200, touch not blocked", async () => {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === "ad_attribution_touches") {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    if (table === "ad_campaigns") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              throw new Error("db exploded");
            },
          }),
        }),
      };
    }
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: { id: "c" }, error: null }),
    };
    return b;
  };
  const client = { from } as unknown as NonNullable<
    ReturnType<CaptureDeps["getClient"]>
  >;
  let threw = false;
  let res: Response | undefined;
  try {
    res = await handleCapture(
      post({
        kind: "touch",
        network: "meta",
        lane: "consumer",
        surface: "web",
        mc_id: "boom",
      }),
      { getClient: () => client },
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
  assert(res !== undefined);
  assertEquals(res.status, 200);
});
