/** Issue #1431 implementor regression: Stay groups enter the shared conversion
 * pipeline with exact net value, original currency, first-touch identity and a
 * stable group dedup key. Hermetic: no network and no database. */

import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";

const GROUP_ID = "stay-group-1431";

function makeClient() {
  const rows: Record<string, unknown> = {
    stay_reservation_groups: {
      id: GROUP_ID,
      brand_id: "brand-1431",
      venue_id: "venue-1431",
      currency_code: "NGN",
      total_minor: 120_000,
      guest_snapshot: {
        email: "Guest@Example.com",
        phoneE164: "+234 801 234 5678",
      },
      attribution_click_id: "click-1431",
      state: "confirmed",
    },
    stay_refunds: [{ amount_minor: 20_000 }, { amount_minor: 5_000 }],
    ad_conversions: null,
    ad_attribution_touches: {
      id: "touch-1431",
      connection_id: "connection-1431",
      campaign_id: "campaign-1431",
      network: "meta",
      external_click_id: "fbclid-1431",
      created_at: "2026-07-31T12:00:00Z",
    },
    ad_connections: { extra: {} },
  };
  const upserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: rows[table] ?? null, error: null }),
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: () => builder,
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows[table] ?? null, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    upserts,
  };
}

function sender(channel: SenderResult["channel"], seen: ConversionSendInput[]) {
  return (input: ConversionSendInput): Promise<SenderResult> => {
    seen.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
}

Deno.test("issue-1431: confirmed Stay conversion is exact-currency, refund-net and group-deduped", async () => {
  const { client, upserts } = makeClient();
  const seen: ConversionSendInput[] = [];
  const result = await fireAdConversion(client, {
    stayGroupId: GROUP_ID,
    surface: "android",
    lane: "consumer",
  }, {
    senders: {
      meta: sender("meta", seen),
      tiktok: sender("tiktok", seen),
      snap: sender("snap", seen),
      reddit: sender("reddit", seen),
      google: sender("google", seen),
    },
  });

  assertEquals(result.ok, true);
  assertEquals(result.eventId, GROUP_ID);
  assertEquals(seen.length, 5);
  for (const sent of seen) {
    assertEquals(sent.eventId, GROUP_ID);
    assertEquals(sent.valueCents, 95_000);
    assertEquals(sent.currency, "NGN");
    assertMatch(sent.hashedEmail ?? "", /^[0-9a-f]{64}$/);
    assertMatch(sent.hashedPhone ?? "", /^[0-9a-f]{64}$/);
  }
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].stay_group_id, GROUP_ID);
  assertEquals(upserts[0].order_id, null);
  assertEquals(upserts[0].click_id, "click-1431");
  assertEquals(upserts[0].value_cents, 95_000);
  assertEquals(upserts[0].currency, "NGN");
});
