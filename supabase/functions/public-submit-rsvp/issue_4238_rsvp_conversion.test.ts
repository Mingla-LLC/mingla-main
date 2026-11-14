// MINGLA-INVARIANT: I-4238-RSVP-CONVERSION-PAIRED | issue #4238 | a positive public RSVP (going / waitlisted) produces one server free sign-up with event_id = the RSVP id (the browser twin uses the same id), none for maybe / not going or a native caller, and none shared while ads are off.
/**
 * #4238 W2-5 (D7, RSVP part). Public RSVPs sent no ad event on either side.
 * Hermetic: a stateful fake for ad_conversions, canned event_rsvps / events /
 * brands rows, and recording senders.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../_shared/adConversionFire.ts";
import {
  fireRsvpAdConversion,
  parseRsvpAdContext,
  RSVP_AD_FIRE_BOUND_MS,
  rsvpStatusFiresAdConversion,
  scheduleRsvpAdConversion,
} from "./rsvpAdConversion.ts";

const RSVP_ID = "7b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const EVENT_ID = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function fakeDb(rsvpStatus = "going") {
  const state: { ad_conversions: Record<string, unknown> | null } = {
    ad_conversions: null,
  };
  const canned: Record<string, unknown> = {
    event_rsvps: {
      id: RSVP_ID,
      event_id: EVENT_ID,
      user_id: null,
      guest_email: "Guest@Example.com",
      guest_phone: "+447700900123",
      rsvp_status: rsvpStatus,
    },
    reservations: null,
    events: { brand_id: "brand-1", slug: "garden-party", event_type: "rsvp" },
    brands: { slug: "lagos-nights" },
    ad_attribution_touches: null,
    ad_connections: { extra: { dataset_id: "px" } },
  };
  const from = (table: string) => {
    let pending: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions" && !state.ad_conversions) {
          state.ad_conversions = {
            meta_capi_status: "pending",
            tiktok_events_status: "pending",
            snap_capi_status: "pending",
            reddit_capi_status: "pending",
            google_ads_status: "pending",
            created_at: new Date().toISOString(),
            ...row,
          };
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: Record<string, unknown>) => {
        pending = values;
        return builder;
      },
      maybeSingle: () => {
        if (table === "ad_conversions") {
          return Promise.resolve({
            data: state.ad_conversions ? { ...state.ad_conversions } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: canned[table] ?? null, error: null });
      },
      then: (resolve: (value: { data: null; error: null }) => unknown) => {
        if (pending && table === "ad_conversions" && state.ad_conversions) {
          Object.assign(state.ad_conversions, pending);
        }
        pending = null;
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  return { client: { from } as any, state };
}

function recordingSenders() {
  const calls: Array<{ channel: string; input: ConversionSendInput }> = [];
  const make = (channel: "meta" | "tiktok" | "snap" | "reddit" | "google") =>
  (input: ConversionSendInput): Promise<SenderResult> => {
    calls.push({ channel, input });
    return Promise.resolve({ channel, status: "sent" });
  };
  return {
    calls,
    senders: {
      meta: make("meta"),
      tiktok: make("tiktok"),
      snap: make("snap"),
      reddit: make("reddit"),
      google: make("google"),
    },
  };
}

const req = (headers: Record<string, string> = {}) =>
  new Request("https://x/public-submit-rsvp", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "Mozilla/5.0 test",
      ...headers,
    },
  });

const browserContext = (trackingOptOut: boolean) =>
  parseRsvpAdContext(
    {
      clickId: "click-4238",
      fbp: "fb.1.1.1",
      fbc: null,
      scid: "scid-1",
      ttp: "ttp-1",
      trackingOptOut,
    },
    req(),
  );

Deno.test("#4238 W2-5 a going web RSVP fires one server free sign-up with event_id = rsvpId", async () => {
  const { client, state } = fakeDb("going");
  const { calls, senders } = recordingSenders();
  const result = await fireRsvpAdConversion(client, {
    rsvpId: RSVP_ID,
    status: "going",
    adContext: browserContext(false),
  }, { senders });
  assertEquals(result?.ok, true);
  assertEquals(calls.length, 5);
  for (const call of calls) assertEquals(call.input.eventId, RSVP_ID);
  const meta = calls.find((c) => c.channel === "meta")?.input;
  assertEquals(meta?.eventName, "CompleteRegistration");
  assertEquals(meta?.valueCents, 0);
  assertEquals(meta?.fbp, "fb.1.1.1");
  assertEquals(meta?.clientIpAddress, "203.0.113.7");
  assertEquals(meta?.clientUserAgent, "Mozilla/5.0 test");
  assertEquals(meta?.eventSourceUrl, "https://host.usemingla.com/e/lagos-nights/garden-party");
  assertEquals(typeof meta?.hashedEmail, "string");
  assertEquals(calls.find((c) => c.channel === "snap")?.input.eventName, "SIGN_UP");
  assertEquals(calls.find((c) => c.channel === "reddit")?.input.eventName, "SignUp");
  assertEquals(state.ad_conversions?.event_type, "reservation");
  assertEquals(state.ad_conversions?.click_id, "click-4238");
  assertEquals(state.ad_conversions?.shared_with_platforms, true);

  // A second fire (re-submit / retry) sends nothing more.
  await fireRsvpAdConversion(client, {
    rsvpId: RSVP_ID,
    status: "going",
    adContext: browserContext(false),
  }, { senders });
  assertEquals(calls.length, 5);
});

Deno.test("#4238 W2-5 ads off: the row is first-party only and every channel is skipped", async () => {
  const { client, state } = fakeDb("going");
  const { calls, senders } = recordingSenders();
  await fireRsvpAdConversion(client, {
    rsvpId: RSVP_ID,
    status: "going",
    adContext: browserContext(true),
  }, { senders });
  assertEquals(calls.length, 0);
  assertEquals(state.ad_conversions?.shared_with_platforms, false);
  for (
    const column of [
      "meta_capi_status",
      "tiktok_events_status",
      "snap_capi_status",
      "reddit_capi_status",
      "google_ads_status",
    ]
  ) {
    assertEquals(state.ad_conversions?.[column], "skipped");
  }
});

Deno.test("#4238 W2-5 not going, maybe and a native caller (no ad_context) fire nothing", async () => {
  for (const status of ["not_going", "maybe"]) {
    const { client, state } = fakeDb(status);
    const { calls, senders } = recordingSenders();
    assertEquals(
      await fireRsvpAdConversion(client, {
        rsvpId: RSVP_ID,
        status,
        adContext: browserContext(false),
      }, { senders }),
      null,
    );
    assertEquals(calls.length, 0);
    assertEquals(state.ad_conversions, null);
  }
  const { client, state } = fakeDb("going");
  const { calls, senders } = recordingSenders();
  assertEquals(
    await fireRsvpAdConversion(client, {
      rsvpId: RSVP_ID,
      status: "going",
      adContext: parseRsvpAdContext(undefined, req()),
    }, { senders }),
    null,
  );
  assertEquals(calls.length, 0);
  assertEquals(state.ad_conversions, null);
  assertEquals(rsvpStatusFiresAdConversion("waitlisted"), true);
});

Deno.test("#4238 W2-5 the server re-checks the stored RSVP status (a waitlist row that became not going sends nothing)", async () => {
  const { client } = fakeDb("not_going");
  const { calls, senders } = recordingSenders();
  const result = await fireAdConversion(client, { rsvpId: RSVP_ID }, { senders });
  assertEquals(result.reason, "context_unresolved");
  assertEquals(calls.length, 0);
});

Deno.test("#4238 W2-5 the retry lane (reservationId = event_id) resolves an RSVP row and reuses its click id", async () => {
  const { client, state } = fakeDb("going");
  const failing = recordingSenders();
  const failMeta = {
    ...failing.senders,
    meta: (input: ConversionSendInput) => {
      failing.calls.push({ channel: "meta", input });
      return Promise.resolve({
        channel: "meta" as const,
        status: "failed" as const,
        reason: "http_500",
      });
    },
  };
  await fireRsvpAdConversion(client, {
    rsvpId: RSVP_ID,
    status: "going",
    adContext: browserContext(false),
  }, { senders: failMeta });
  assertEquals(state.ad_conversions?.meta_capi_status, "failed");
  // ad-conversion-retry flips the failed channel to pending and re-fires.
  (state.ad_conversions as Record<string, unknown>).meta_capi_status = "pending";
  const retry = recordingSenders();
  const result = await fireAdConversion(client, {
    reservationId: RSVP_ID,
    eventType: "reservation",
  }, { senders: retry.senders });
  assertEquals(result.ok, true);
  assertEquals(retry.calls.map((c) => c.channel), ["meta"]);
  assertEquals(retry.calls[0].input.eventId, RSVP_ID);
  assertEquals(state.ad_conversions?.click_id, "click-4238");
  assertEquals(state.ad_conversions?.meta_capi_status, "sent");
});

Deno.test("#4238 W2-5 the fire runs after the response when waitUntil exists, else bounded", async () => {
  const handed: Promise<unknown>[] = [];
  let resolved = false;
  const slow = new Promise<void>((resolve) =>
    setTimeout(() => {
      resolved = true;
      resolve();
    }, 50)
  );
  await scheduleRsvpAdConversion(slow, (task) => handed.push(task));
  assertEquals(handed.length, 1);
  assertEquals(resolved, false);
  const started = Date.now();
  await scheduleRsvpAdConversion(new Promise(() => undefined), null, 20);
  assertEquals(Date.now() - started < 1_000, true);
  assertEquals(RSVP_AD_FIRE_BOUND_MS, 8_000);
  await slow;
});

Deno.test("#4238 W2-5 public-submit-rsvp accepts ad_context and schedules the fire after the RPC", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(/"guests",\s*"ad_context",\s*\]\.includes\(key\)/.test(source), true);
  const rpc = source.indexOf('admin.rpc("submit_event_rsvp_with_delivery"');
  const fire = source.indexOf("await scheduleRsvpAdConversion(");
  assertEquals(rpc > 0 && fire > rpc, true);
  assertEquals(source.includes("adContext: parseRsvpAdContext(body.ad_context, req)"), true);
});
