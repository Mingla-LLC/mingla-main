// MINGLA-INVARIANT: I-4238-CLICK-WINDOW-7D | issue #4238 | the conversion writer credits an ad tap only when the conversion happened at most 7 days after it (no view-through); an older, future-dated or undated tap writes no touch/campaign/connection on ad_conversions, sends no click id or Meta fbc to any platform, and records why in provider_response.attribution.
/**
 * #4238 W7 (amendment B decision 6). Mingla's count already enforced the
 * 7 days on read (hostAdAttribution.ts); this pins the WRITER
 * (adConversionFire resolveTouch) and the platform sends to the same rule,
 * plus the free-order Google kind and the opt-out.
 * Hermetic: an in-memory supabase fake and recording senders.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdCheckoutStart,
  fireAdConversion,
  type SenderConnection,
  touchWindowExpiry,
} from "../adConversionFire.ts";
import {
  countedByMingla,
  HOST_AD_CLICK_WINDOW_MS,
} from "../hostAdAttribution.ts";

const SALE_MS = Date.parse("2026-11-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

type Captured = {
  upserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
};

function db(opts: {
  touchCreatedAt: string | null;
  totalCents?: number;
  optOut?: boolean;
  extra?: Record<string, unknown>;
  network?: string;
}): { client: Parameters<typeof fireAdConversion>[0]; captured: Captured } {
  const captured: Captured = { upserts: [], updates: [] };
  const tables: Record<string, Record<string, unknown> | null> = {
    orders: {
      id: "order-w7",
      event_id: "ev-1",
      total_cents: opts.totalCents ?? 2500,
      currency: "GBP",
      buyer_email: "buyer@example.com",
      buyer_phone: "+447700900123",
      payment_status: "paid",
      source: "online_checkout",
    },
    ticket_checkout_sessions: {
      id: "sess-w7",
      event_id: "ev-1",
      brand_id: "b-1",
      total_cents: opts.totalCents ?? 2500,
      currency: "GBP",
      attribution_click_id: "click-w7",
      buyer_user_id: null,
      fbp: "fb.1.1.fbp",
      fbc: "fb.1.1.FBCLID_FROM_SESSION",
      scid: null,
      ttp: null,
      ad_tracking_opt_out: opts.optOut === true,
      client_ip: null,
      client_user_agent: null,
      checkout_surface: null,
      ad_checkout_start_sent_at: null,
      ad_checkout_start_provider_response: null,
      created_at: iso(SALE_MS),
    },
    events: { brand_id: "b-1", slug: "s", event_type: "event" },
    brands: { slug: "lagos" },
    ad_attribution_touches: {
      id: "t-w7",
      connection_id: "conn-w7",
      campaign_id: "camp-w7",
      network: opts.network ?? "google",
      external_click_id: "CLICK_FROM_TAP",
      external_click_id_type: "gclid",
      created_at: opts.touchCreatedAt,
      consent_state: "granted",
    },
  };
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      is: () => b,
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") captured.upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") captured.updates.push(row);
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: table === "ad_connections"
            ? { extra: opts.extra ?? {} }
            : table === "ad_conversions"
            ? null
            : tables[table] ?? null,
          error: null,
        }),
      then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
    };
    return b;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    captured,
  };
}

type Channel = "meta" | "tiktok" | "snap" | "reddit" | "google";

function recorders() {
  const seen: Partial<
    Record<Channel, { input: ConversionSendInput; conn: SenderConnection }>
  > = {};
  const record =
    (channel: Channel) =>
    (input: ConversionSendInput, conn: SenderConnection) => {
      seen[channel] = { input, conn };
      return Promise.resolve({ channel, status: "sent" as const });
    };
  return {
    seen,
    senders: {
      meta: record("meta"),
      tiktok: record("tiktok"),
      snap: record("snap"),
      reddit: record("reddit"),
      google: record("google"),
    },
  };
}

async function fireOrder(opts: Parameters<typeof db>[0]) {
  const { client, captured } = db({
    extra: {
      conversion_action_resource: "customers/1/conversionActions/PURCHASE",
      conversion_actions: {
        purchase: "customers/1/conversionActions/PURCHASE",
        free_signup: "customers/1/conversionActions/FREE",
      },
    },
    ...opts,
  });
  const { seen, senders } = recorders();
  const res = await fireAdConversion(client, {
    orderId: "order-w7",
    surface: "web",
    eventTimeMs: SALE_MS,
  }, { senders });
  return { res, seen, captured };
}

Deno.test("#4238 W7 a tap exactly 7 days before the sale is credited and its click id sent", async () => {
  const { seen, captured } = await fireOrder({
    touchCreatedAt: iso(SALE_MS - 7 * DAY),
  });
  assertEquals(captured.upserts[0].touch_id, "t-w7");
  assertEquals(captured.upserts[0].campaign_id, "camp-w7");
  assertEquals(captured.upserts[0].connection_id, "conn-w7");
  assertEquals(seen.google?.input.externalClickId, "CLICK_FROM_TAP");
});

Deno.test("#4238 W7 adversarial: 7 days + 1 second is not credited and nothing tied to the tap is sent", async () => {
  const { seen, captured } = await fireOrder({
    touchCreatedAt: iso(SALE_MS - 7 * DAY - 1000),
    network: "meta",
  });
  const row = captured.upserts[0];
  assertEquals(row.touch_id, null);
  assertEquals(row.campaign_id, null);
  assertEquals(row.connection_id, null);
  // The stored checkout click id stays on the row for audit only.
  assertEquals(row.click_id, "click-w7");
  for (
    const channel of ["meta", "tiktok", "snap", "reddit", "google"] as const
  ) {
    const sent = seen[channel]?.input;
    if (!sent) continue;
    assertEquals(sent.externalClickId ?? null, null, `${channel} click id`);
    assertEquals(sent.fbc ?? null, null, `${channel} fbc`);
  }
  const final = captured.updates.at(-1)?.provider_response as Record<
    string,
    unknown
  >;
  assertEquals(final.attribution, {
    status: "not_attributed",
    reason: "click_older_than_window",
    touch_age_ms: 7 * DAY + 1000,
    window_days: 7,
  });
});

Deno.test("#4238 W7 adversarial: a tap dated after the sale, or undated, is not credited", async () => {
  for (
    const [createdAt, reason] of [
      [iso(SALE_MS + 1000), "click_after_conversion"],
      [null, "click_time_missing"],
      ["not a date", "click_time_missing"],
    ] as const
  ) {
    const { captured, seen } = await fireOrder({ touchCreatedAt: createdAt });
    assertEquals(captured.upserts[0].touch_id, null, String(createdAt));
    assertEquals(seen.google?.input.externalClickId ?? null, null);
    const final = captured.updates.at(-1)?.provider_response as Record<
      string,
      Record<string, unknown>
    >;
    assertEquals(final.attribution.reason, reason);
  }
});

Deno.test("#4238 W7 a credited tap leaves no attribution note (lead and purchase payloads unchanged)", async () => {
  const { captured } = await fireOrder({ touchCreatedAt: iso(SALE_MS - DAY) });
  const final = captured.updates.at(-1)?.provider_response as Record<
    string,
    unknown
  >;
  assertEquals("attribution" in final, false);
});

Deno.test("#4238 W7 adversarial: a free order fires the Google sign-up action, never purchase", async () => {
  const { seen, captured } = await fireOrder({
    touchCreatedAt: iso(SALE_MS - DAY),
    totalCents: 0,
  });
  assertEquals(captured.upserts[0].event_type, "reservation");
  assertEquals(captured.upserts[0].value_cents, 0);
  assertEquals(seen.google?.conn.googleConversionKind, "free_signup");
  assertEquals(
    seen.google?.conn.conversionActionResource,
    "customers/1/conversionActions/FREE",
  );
  assertEquals(seen.meta?.input.eventName === "Purchase", false);
});

Deno.test("#4238 W7 adversarial: an opted-out free buyer is never sent to any platform", async () => {
  const { seen, captured, res } = await fireOrder({
    touchCreatedAt: iso(SALE_MS - DAY),
    totalCents: 0,
    optOut: true,
  });
  assertEquals(Object.keys(seen), []);
  assertEquals(captured.upserts[0].shared_with_platforms, false);
  assertEquals(
    res.ok && res.results?.every((r) => r.reason === "consent_rejected"),
    true,
  );
});

Deno.test("#4238 W7 checkout start: an 8-day-old tap sends no click id and no fbc", async () => {
  const { client } = db({
    touchCreatedAt: iso(SALE_MS - 8 * DAY),
    network: "meta",
  });
  const { seen, senders } = recorders();
  await fireAdCheckoutStart(client, "sess-w7", { senders });
  assertEquals(seen.meta?.input.externalClickId ?? null, null);
  assertEquals(seen.meta?.input.fbc ?? null, null);
  const fresh = db({ touchCreatedAt: iso(SALE_MS - 6 * DAY), network: "meta" });
  const second = recorders();
  await fireAdCheckoutStart(fresh.client, "sess-w7", {
    senders: second.senders,
  });
  assertEquals(second.seen.meta?.input.externalClickId, "CLICK_FROM_TAP");
});

Deno.test("#4238 W7 the writer's window equals Mingla's count on read", () => {
  for (
    const age of [
      -1000,
      0,
      DAY,
      6 * DAY,
      HOST_AD_CLICK_WINDOW_MS,
      HOST_AD_CLICK_WINDOW_MS + 1,
      8 * DAY,
    ]
  ) {
    const touchAt = iso(SALE_MS - age);
    assertEquals(
      touchWindowExpiry(touchAt, SALE_MS) === null,
      countedByMingla(touchAt, iso(SALE_MS)),
      `age ${age}`,
    );
  }
  assertEquals(countedByMingla(null, iso(SALE_MS)), false);
  assertEquals(touchWindowExpiry(null, SALE_MS)?.reason, "click_time_missing");
});
