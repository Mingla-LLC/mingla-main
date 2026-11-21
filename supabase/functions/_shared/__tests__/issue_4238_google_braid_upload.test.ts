// MINGLA-INVARIANT: I-4238-CLICK-ID-TYPED | issue #4238 | every stored external click id records which URL parameter it came from, and the Google upload uses that parameter's field (gclid, gbraid or wbraid).
// MINGLA-INVARIANT: I-4238-GOOGLE-ACTION-PER-KIND | issue #4238 | a Google upload always targets the conversion action of its own kind (purchase, free_signup, host_lead, host_signup); a free sign-up never lands on the purchase action, and a missing action is failed/pending_config.
/**
 * #4238 W2-6 (D18 capture half). Google sends gbraid/wbraid on iOS and
 * privacy-limited clicks. They were never captured, and the upload only ever
 * built `gclid`, so a braid click could never be uploaded.
 * Hermetic: pure builder, a recording requestImpl, injected fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GoogleClient } from "../google.ts";
import {
  buildConversionActionCreateOperation,
  buildGoogleClickConversion,
  GOOGLE_ADS_CONVERSION_API_VERSION,
  provisionGoogleConversionAction,
  sendGoogleConversion,
} from "../googleConversionUpload.ts";
import { identityHashes } from "../adIdentity.ts";
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
  await fireAdConversion(client, {
    orderId: "order-4238-braid",
    eventTimeMs: Date.parse("2026-11-15T08:00:00.000Z"),
  }, {
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

// ── #4238 W5-1 (D18): one action per kind, E.164 hashing, API v26 ────────────

function googleDb(extra: Record<string, unknown>, rsvp = true) {
  const tables: Record<string, Record<string, unknown> | null> = {
    event_rsvps: rsvp
      ? {
        id: "rsvp-w51",
        event_id: "ev-1",
        user_id: null,
        guest_email: "Guest.Name+promo@Gmail.com",
        guest_phone: "+2348031234567",
        rsvp_status: "going",
      }
      : null,
    events: { brand_id: "b-1", slug: "s", event_type: "event" },
    brands: { slug: "lagos" },
    ad_attribution_touches: {
      id: "t-g",
      network: "google",
      external_click_id: "GCLID_W51",
      external_click_id_type: "gclid",
      created_at: new Date().toISOString(),
      consent_state: "granted",
    },
  };
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: () => b,
      maybeSingle: () =>
        Promise.resolve({
          data: table === "ad_connections"
            ? { extra }
            : table === "ad_conversions"
            ? null
            : tables[table] ?? null,
          error: null,
        }),
      then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
    };
    return b;
  };
  return { from } as unknown as Parameters<typeof fireAdConversion>[0];
}

async function fireRsvpToGoogle(extra: Record<string, unknown>) {
  const seen: { conn: SenderConnection; input: ConversionSendInput }[] = [];
  const res = await fireAdConversion(googleDb(extra), {
    rsvpId: "rsvp-w51",
    clickId: "click-w51",
  }, {
    senders: {
      meta: () => Promise.resolve({ channel: "meta", status: "sent" }),
      tiktok: () => Promise.resolve({ channel: "tiktok", status: "sent" }),
      snap: () => Promise.resolve({ channel: "snap", status: "sent" }),
      reddit: () => Promise.resolve({ channel: "reddit", status: "sent" }),
      google: (input, conn) => {
        seen.push({ conn, input });
        return sendGoogleConversion(input, conn, {
          resolveClient: () =>
            Promise.resolve({ customerId: "1", apiVersion: "v24" } as unknown as GoogleClient),
          requestImpl: () => Promise.resolve({ payload: {}, requestId: null }),
        });
      },
    },
  });
  return { res, seen };
}

Deno.test("#4238 W5-1 a free RSVP uploads to the free_signup action, never the purchase action", async () => {
  const { res, seen } = await fireRsvpToGoogle({
    conversion_action_resource: "customers/1/conversionActions/PURCHASE",
    conversion_actions: {
      purchase: "customers/1/conversionActions/PURCHASE",
      free_signup: "customers/1/conversionActions/FREE",
    },
  });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].conn.conversionActionResource, "customers/1/conversionActions/FREE");
  assertEquals(seen[0].conn.googleConversionKind, "free_signup");
  assertEquals(res.results?.find((r) => r.channel === "google")?.status, "sent");
});

Deno.test("#4238 W5-1 with no free_signup action the RSVP is failed/pending_config, not a purchase", async () => {
  const { res, seen } = await fireRsvpToGoogle({
    conversion_action_resource: "customers/1/conversionActions/PURCHASE",
  });
  assertEquals(seen[0].conn.conversionActionResource, null);
  const google = res.results?.find((r) => r.channel === "google");
  assertEquals(google?.status, "failed");
  assertEquals(google?.reason, "pending_config");
});

Deno.test("#4238 W5-1 Google gets the E.164 phone hash and the gmail-normalised email", async () => {
  const { seen } = await fireRsvpToGoogle({
    conversion_actions: { free_signup: "customers/1/conversionActions/FREE" },
  });
  const expected = await identityHashes("Guest.Name+promo@Gmail.com", "+2348031234567");
  const input = seen[0].input;
  assertEquals(input.hashedPhoneE164, expected.hashedPhoneE164);
  assertEquals(input.hashedEmailGoogle, expected.hashedEmailGoogle);
  // Meta / Snap keep the digits-only phone and the plain lower-cased email.
  assertEquals(input.hashedPhone, expected.hashedPhone);
  const body = buildGoogleClickConversion(input, "customers/1/conversionActions/FREE", seen[0].conn);
  const ids = body.userIdentifiers as Record<string, unknown>[];
  assertEquals(ids, [
    { hashedEmail: expected.hashedEmailGoogle, userIdentifierSource: "FIRST_PARTY" },
    { hashedPhoneNumber: expected.hashedPhoneE164, userIdentifierSource: "FIRST_PARTY" },
  ]);
  // The E.164 hash is of the "+" form; the gmail rule dropped dots and +promo.
  const plus = await identityHashes(null, "+2348031234567");
  const noPlusDigits = await identityHashes(null, "2348031234567");
  assertEquals(plus.hashedPhoneE164, noPlusDigits.hashedPhoneE164);
  const gmail = await identityHashes("guestname@gmail.com", null);
  assertEquals(expected.hashedEmailGoogle, gmail.hashedEmailGoogle);
  // A local number (leading 0) gets no E.164 hash: the country is never guessed.
  assertEquals((await identityHashes(null, "08031234567")).hashedPhoneE164, null);
});

Deno.test("#4238 W5-1 the upload and the provisioning call Google Ads API v26", async () => {
  assertEquals(GOOGLE_ADS_CONVERSION_API_VERSION, "v26");
  const versions: string[] = [];
  await sendGoogleConversion(input({ externalClickIdType: "gclid" }), CONN, {
    resolveClient: () =>
      Promise.resolve({ customerId: "1", apiVersion: "v24" } as unknown as GoogleClient),
    requestImpl: (client) => {
      versions.push(client.apiVersion);
      return Promise.resolve({ payload: {}, requestId: null });
    },
  });
  await provisionGoogleConversionAction(null, {
    kind: "purchase",
    resolveClient: () =>
      Promise.resolve({ customerId: "1", apiVersion: "v24" } as unknown as GoogleClient),
    requestImpl: (client) => {
      versions.push(client.apiVersion);
      return Promise.resolve({ payload: { results: [{ resourceName: "r" }] }, requestId: null });
    },
  });
  assertEquals(versions, ["v26", "v26"]);
});

Deno.test("#4238 W5-1 each kind's category; secondary kinds are updated to primary_for_goal=false after create", async () => {
  const category = (kind: "purchase" | "free_signup" | "host_lead" | "host_signup") =>
    (buildConversionActionCreateOperation({ kind }).create as Record<string, unknown>).category;
  assertEquals(category("purchase"), "PURCHASE");
  assertEquals(category("free_signup"), "SIGNUP");
  assertEquals(category("host_lead"), "SUBMIT_LEAD_FORM");
  assertEquals(category("host_signup"), "SIGNUP");
  for (const kind of ["purchase", "free_signup", "host_lead", "host_signup"] as const) {
    const create = buildConversionActionCreateOperation({ kind }).create as Record<string, unknown>;
    assertEquals("primaryForGoal" in create, false, `${kind}: never set on create (Z8)`);
  }
  const bodies: Record<string, unknown>[] = [];
  const result = await provisionGoogleConversionAction(null, {
    kind: "host_signup",
    resolveClient: () =>
      Promise.resolve({ customerId: "1", apiVersion: "v24" } as unknown as GoogleClient),
    requestImpl: (_client, _path, body) => {
      bodies.push(body);
      return Promise.resolve({
        payload: { results: [{ resourceName: "customers/1/conversionActions/HS" }] },
        requestId: null,
      });
    },
  });
  assertEquals(bodies.length, 2);
  assertEquals((bodies[1].operations as unknown[])[0], {
    update: { resourceName: "customers/1/conversionActions/HS", primaryForGoal: false },
    updateMask: "primaryForGoal",
  });
  assertEquals(result.secondaryUpdate, "updated");
  // The purchase action stays primary: no update call.
  const purchaseBodies: unknown[] = [];
  const purchase = await provisionGoogleConversionAction(null, {
    kind: "purchase",
    resolveClient: () =>
      Promise.resolve({ customerId: "1", apiVersion: "v24" } as unknown as GoogleClient),
    requestImpl: (_c, _p, body) => {
      purchaseBodies.push(body);
      return Promise.resolve({ payload: { results: [{ resourceName: "r" }] }, requestId: null });
    },
  });
  assertEquals(purchaseBodies.length, 1);
  assertEquals(purchase.secondaryUpdate, "not_needed");
});
