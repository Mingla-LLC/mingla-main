/** Issue #1431 tester-owned adversarial coverage.
 *
 * Negative-space proof that Stay ad conversions cannot report negative revenue
 * after refunds and cannot re-fire any provider after all five lanes settle.
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";

const GROUP_ID = "stay-group-1431-tester";

function makeClient(options: { overRefunded?: boolean; settled?: boolean } = {}) {
  const rows: Record<string, unknown> = {
    stay_reservation_groups: {
      id: GROUP_ID,
      brand_id: "brand-1431-tester",
      venue_id: "venue-1431-tester",
      currency_code: "NGN",
      total_minor: 20_000,
      guest_snapshot: {},
      attribution_click_id: null,
      state: "confirmed",
    },
    stay_refunds: options.overRefunded
      ? [{ amount_minor: 30_000 }, { amount_minor: 20_000 }]
      : [],
    ad_conversions: options.settled
      ? {
        event_id: GROUP_ID,
        brand_id: "brand-1431-tester",
        order_id: null,
        stay_group_id: GROUP_ID,
        value_cents: 20_000,
        currency: "NGN",
        mingla_event_id: null,
        meta_capi_status: "sent",
        tiktok_events_status: "sent",
        snap_capi_status: "sent",
        reddit_capi_status: "sent",
        google_ads_status: "sent",
      }
      : null,
  };
  const upserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
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
      update: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") updates.push(row);
        return builder;
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows[table] ?? null, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    upserts,
    updates,
  };
}

function sender(channel: SenderResult["channel"], seen: ConversionSendInput[]) {
  return (input: ConversionSendInput): Promise<SenderResult> => {
    seen.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
}

function senders(seen: ConversionSendInput[]) {
  return {
    meta: sender("meta", seen),
    tiktok: sender("tiktok", seen),
    snap: sender("snap", seen),
    reddit: sender("reddit", seen),
    google: sender("google", seen),
  };
}

Deno.test("issue-1431 tester: refunds beyond the Stay total clamp attributed revenue to zero", async () => {
  const { client, upserts } = makeClient({ overRefunded: true });
  const seen: ConversionSendInput[] = [];

  const result = await fireAdConversion(client, {
    stayGroupId: GROUP_ID,
    surface: "android",
    lane: "consumer",
  }, { senders: senders(seen) });

  assertEquals(result.ok, true);
  assertEquals(seen.length, 5);
  assertEquals(seen.map((input) => input.valueCents), [0, 0, 0, 0, 0]);
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].value_cents, 0);
});

Deno.test("issue-1431 tester: an all-five-settled Stay replay sends and writes nothing", async () => {
  const { client, upserts, updates } = makeClient({ settled: true });
  const seen: ConversionSendInput[] = [];

  const result = await fireAdConversion(client, {
    stayGroupId: GROUP_ID,
    surface: "web",
    lane: "consumer",
  }, { senders: senders(seen) });

  assertEquals(result, {
    ok: true,
    eventId: GROUP_ID,
    deduped: true,
    results: [],
  });
  assertEquals(seen.length, 0);
  assertEquals(upserts.length, 0);
  assertEquals(updates.length, 0);
});
