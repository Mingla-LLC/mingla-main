import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { loadManagedBrand, loadOwnedVenue } from "../index.ts";

const BRAND_ID = "9a000000-0000-4000-8000-000000000001";
const USER_ID = "7a000000-0000-4000-8000-000000000009";
const VENUE_ID = "5b000000-0000-4000-8000-000000000002";

const BRAND = {
  id: BRAND_ID,
  account_id: "6a000000-0000-4000-8000-000000000006",
  name: "Lantern Brand",
  description: null,
  place_pool_id: null,
  google_place_id: null,
  venue_category: "stay",
  cover_media_url: null,
  cover_media_type: null,
};

function fakeClient(input: {
  brand?: Record<string, unknown> | null;
  venue?: Record<string, unknown> | null;
  rank?: number | null;
  rankError?: string | null;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const q = {
        select(_columns?: string) {
          return q;
        },
        eq(_column: string, _value: unknown) {
          return q;
        },
        is(_column: string, _value: unknown) {
          return q;
        },
        maybeSingle() {
          const data =
            table === "brands"
              ? input.brand === undefined
                ? BRAND
                : input.brand
              : (input.venue ?? null);
          return Promise.resolve({ data, error: null });
        },
      };
      return q;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: input.rank ?? null,
        error:
          input.rankError === null || input.rankError === undefined
            ? null
            : { message: input.rankError },
      });
    },
  };
  return { client, rpcCalls };
}

// deno-lint-ignore no-explicit-any
type Loose = any;

Deno.test(
  "#1465 brand gate accepts event_manager and owner through canonical effective-rank RPC",
  async () => {
    for (const rank of [40, 60]) {
      const { client, rpcCalls } = fakeClient({ rank });
      const result = await loadManagedBrand(client as Loose, BRAND_ID, USER_ID);
      assert(!(result instanceof Response));
      assertEquals((result as { id: string }).id, BRAND_ID);
      assertEquals(rpcCalls, [
        {
          name: "biz_brand_effective_rank",
          args: { p_brand_id: BRAND_ID, p_user_id: USER_ID },
        },
      ]);
    }
  },
);

Deno.test(
  "#1465 brand gate rejects every below-manager rank without treating account_id as authority",
  async () => {
    for (const rank of [0, 10, 20, 30, 39]) {
      const { client } = fakeClient({ rank });
      const result = await loadManagedBrand(client as Loose, BRAND_ID, USER_ID);
      assert(result instanceof Response);
      assertEquals((result as Response).status, 403);
      assertEquals((await (result as Response).json()).code, "FORBIDDEN");
    }
  },
);

Deno.test(
  "#1465 brand gate fails closed when canonical rank lookup fails",
  async () => {
    const { client } = fakeClient({
      rank: 60,
      rankError: "database unavailable",
    });
    const result = await loadManagedBrand(client as Loose, BRAND_ID, USER_ID);
    assert(result instanceof Response);
    assertEquals((result as Response).status, 500);
    assertEquals(
      (await (result as Response).json()).code,
      "BRAND_ROLE_READ_FAILED",
    );
  },
);

Deno.test(
  "#1465 missing/deleted brand stays 404 and does not perform a rank lookup",
  async () => {
    const { client, rpcCalls } = fakeClient({ brand: null, rank: 60 });
    const result = await loadManagedBrand(client as Loose, BRAND_ID, USER_ID);
    assert(result instanceof Response);
    assertEquals((result as Response).status, 404);
    assertEquals(rpcCalls, []);
  },
);

Deno.test(
  "#1465 successful brand authority never weakens the venue-to-brand binding",
  async () => {
    const { client } = fakeClient({
      rank: 40,
      venue: {
        id: VENUE_ID,
        brand_id: "ffffffff-0000-4000-8000-00000000ffff",
        place_pool_id: null,
        google_place_id: null,
        venue_category: "stay",
        name: "Foreign Stay",
        cover_media_url: null,
        cover_media_type: null,
        claim_status: "pending_review",
      },
    });
    const brand = await loadManagedBrand(client as Loose, BRAND_ID, USER_ID);
    assert(!(brand instanceof Response));
    const venue = await loadOwnedVenue(
      client as Loose,
      VENUE_ID,
      brand as Loose,
    );
    assert(venue instanceof Response);
    assertEquals((venue as Response).status, 403);
  },
);
