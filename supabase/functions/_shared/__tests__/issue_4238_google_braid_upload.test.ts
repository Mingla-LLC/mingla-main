// MINGLA-INVARIANT: I-4238-CLICK-ID-TYPED | issue #4238 | every stored external click id records which URL parameter it came from, and the Google upload uses that parameter's field (gclid, gbraid or wbraid).
/**
 * #4238 W2-6 (D18 capture half). Google sends gbraid/wbraid on iOS and
 * privacy-limited clicks. They were never captured, and the upload only ever
 * built `gclid`, so a braid click could never be uploaded.
 * Hermetic: pure builder, a recording requestImpl, injected fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GoogleClient } from "../google.ts";
import {
  buildGoogleClickConversion,
  sendGoogleConversion,
} from "../googleConversionUpload.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderConnection,
} from "../adConversionFire.ts";
import {
  handleCapture,
  validatedClickIdType,
} from "../../attribution-capture/index.ts";

const ACTION = "customers/1234567890/conversionActions/555";
const CONN: SenderConnection = {
  pixelId: null,
  tokenEnvVar: null,
  lane: "consumer",
  conversionActionResource: ACTION,
};

function input(overrides: Partial<ConversionSendInput> = {}): ConversionSendInput {
  return {
    eventId: "order-4238-braid",
    eventName: "Purchase",
    valueCents: 2500,
    currency: "GBP",
    eventSourceUrl: "https://host.usemingla.com/e/brand/event",
    hashedEmail: "a".repeat(64),
    hashedPhone: "b".repeat(64),
    fbc: null,
    fbp: null,
    externalClickId: "BRAID_ABC",
    clientIpAddress: null,
    clientUserAgent: null,
    eventTimeMs: 1_700_000_000_000,
    ...overrides,
  };
}

Deno.test("#4238 W2-6 a gbraid touch uploads gbraid, never gclid, and drops user identifiers", () => {
  const body = buildGoogleClickConversion(
    input({ externalClickIdType: "gbraid" }),
    ACTION,
    CONN,
  );
  assertEquals(body.gbraid, "BRAID_ABC");
  assertEquals("gclid" in body, false);
  assertEquals("wbraid" in body, false);
  assertEquals("userIdentifiers" in body, false);
  assertEquals(body.orderId, "order-4238-braid");
});

Deno.test("#4238 W2-6 a wbraid touch uploads wbraid", () => {
  const body = buildGoogleClickConversion(
    input({ externalClickIdType: "wbraid" }),
    ACTION,
    CONN,
  );
  assertEquals(body.wbraid, "BRAID_ABC");
  assertEquals("gclid" in body, false);
});

Deno.test("#4238 W2-6 gclid and a legacy untyped touch are unchanged (gclid + user identifiers)", () => {
  for (const type of ["gclid", null, undefined]) {
    const body = buildGoogleClickConversion(
      input({ externalClickId: "GCLID_1", externalClickIdType: type }),
      ACTION,
      CONN,
    );
    assertEquals(body.gclid, "GCLID_1");
    assertEquals("gbraid" in body, false);
    assertEquals(Array.isArray(body.userIdentifiers), true);
  }
});

Deno.test("#4238 W2-6 the sender posts the braid field on the wire", async () => {
  const calls: Record<string, unknown>[] = [];
  const result = await sendGoogleConversion(
    input({ externalClickIdType: "gbraid" }),
    CONN,
    {
      resolveClient: () =>
        Promise.resolve({ customerId: "1234567890" } as unknown as GoogleClient),
      requestImpl: (_c: GoogleClient, _p: string, body: Record<string, unknown>) => {
        calls.push(body);
        return Promise.resolve({ payload: {}, requestId: "r" });
      },
    },
  );
  assertEquals(result.status, "sent");
  const conversion = (calls[0].conversions as Record<string, unknown>[])[0];
  assertEquals(conversion.gbraid, "BRAID_ABC");
  assertEquals("gclid" in conversion, false);
});

Deno.test("#4238 W2-6 attribution-capture keeps a type only when it matches the network", () => {
  assertEquals(validatedClickIdType("gbraid", "google", "x"), "gbraid");
  assertEquals(validatedClickIdType("WBRAID", "google", "x"), "wbraid");
  assertEquals(validatedClickIdType("gclid", "google", "x"), "gclid");
  assertEquals(validatedClickIdType("fbclid", "meta", "x"), "fbclid");
  assertEquals(validatedClickIdType("rdt_cid", "reddit", "x"), "rdt_cid");
  // Mismatched pair: the touch is kept, the type is null.
  assertEquals(validatedClickIdType("gbraid", "meta", "x"), null);
  assertEquals(validatedClickIdType("utm_source", "google", "x"), null);
  assertEquals(validatedClickIdType("gclid", "google", null), null);
  assertEquals(validatedClickIdType(42, "google", "x"), null);
});

Deno.test("#4238 W2-6 attribution-capture stores external_click_id_type on the touch row", async () => {
  const inserted: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        or: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === "ad_attribution_touches") inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
  const req = new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "touch",
      network: "google",
      external_click_id: "BRAID_ABC",
      external_click_id_type: "gbraid",
      utm: {},
    }),
  });
  const res = await handleCapture(req, { getClient: () => client });
  assertEquals((await res.json()).ok, true);
  assertEquals(inserted[0].external_click_id, "BRAID_ABC");
  assertEquals(inserted[0].external_click_id_type, "gbraid");
  assertEquals(inserted[0].network, "google");
});

Deno.test("#4238 W2-6 fireAdConversion threads the touch's click-id type to the Google sender only", async () => {
  const canned: Record<string, unknown> = {
    orders: {
      id: "order-4238-braid",
      event_id: null,
      total_cents: 2500,
      currency: "GBP",
      buyer_email: null,
      buyer_phone: null,
      payment_status: "paid",
      source: "online_checkout",
    },
    ticket_checkout_sessions: { attribution_click_id: "click-1" },
    ad_attribution_touches: {
      id: "touch-1",
      connection_id: null,
      campaign_id: null,
      network: "google",
      external_click_id: "BRAID_ABC",
      external_click_id_type: "gbraid",
      created_at: "2026-11-14T08:00:00.000Z",
      consent_state: "granted",
    },
    ad_connections: { extra: { conversion_action_resource: ACTION } },
  };
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        upsert: () => Promise.resolve({ data: null, error: null }),
        update: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: canned[table] ?? null, error: null }),
        then: (resolve: (v: { data: null; error: null }) => unknown) =>
          resolve({ data: null, error: null }),
      };
      return builder;
    },
  };
  const seen: Record<string, ConversionSendInput> = {};
  const record = (channel: "meta" | "tiktok" | "snap" | "reddit" | "google") =>
  (sendInput: ConversionSendInput) => {
    seen[channel] = sendInput;
    return Promise.resolve({ channel, status: "sent" as const });
  };
  await fireAdConversion(client, { orderId: "order-4238-braid" }, {
    senders: {
      meta: record("meta"),
      tiktok: record("tiktok"),
      snap: record("snap"),
      reddit: record("reddit"),
      google: record("google"),
    },
  });
  assertEquals(seen.google.externalClickId, "BRAID_ABC");
  assertEquals(seen.google.externalClickIdType, "gbraid");
  assertEquals(seen.meta.externalClickIdType ?? null, null);
  assertEquals(seen.reddit.externalClickIdType ?? null, null);
});
