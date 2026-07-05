// ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1] — backend S2S (§4.D)
// Deno unit tests for the api3 correctness fixes in `_shared/appsFlyerS2S.ts`:
//   T-D1  happy  : token set + iOS device → POST `…/inappevent/id<id>`,
//                  header `authentication: <token>`, body `os:"ios"`, returns true.
//   T-D2  advers.: APPSFLYER_S2S_TOKEN unset → returns false, NEVER sends the dev key
//                  (fail-closed; no api3 fetch at all).
//   T-D3  edge   : iOS secret already `id`-prefixed → single `id` prefix (no `idid`).
//   T-D4  happy  : Android device → bare package path, body `os:"android"`.
//   T-D5  regress: dead `process-referral/` function directory is gone.
//   ensureIdPrefix idempotency: `6768737367` and `id6768737367` both → `id6768737367`.
//
// These are the fails-on-revert guards for I-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY
// and I-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED. Reverting the header to the dev key
// (T-D1/T-D2) or removing ensureIdPrefix (T-D3/idempotency) fails these tests.
//
// Append-only per feedback_test_append_only_gate — new file, no existing test modified.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { ensureIdPrefix, postAppsFlyerS2SEvent } from "../appsFlyerS2S.ts";

// A chainable Supabase stub whose device lookup resolves to `device`.
// deno-lint-ignore no-explicit-any
function makeSupabaseReturningDevice(
  device: { appsflyer_uid: string; platform: "ios" | "android" } | null,
  // deno-lint-ignore no-explicit-any
): any {
  // deno-lint-ignore no-explicit-any
  const chain: any = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: device, error: null }),
  };
  return chain;
}

// Capture only the api3 AppsFlyer POST (ignore the fire-and-forget
// apiHealthLog insert, which also uses fetch).
interface CapturedFetch {
  url: string;
  authHeader: string | null;
  body: Record<string, unknown>;
}
function installFetchCapture(captured: CapturedFetch[]): typeof fetch {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api3.appsflyer.com/inappevent")) {
      const headers = new Headers(init?.headers);
      captured.push({
        url,
        authHeader: headers.get("authentication"),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  return original;
}

function withInertSupabaseEnv(): {
  restore: () => void;
} {
  // apiHealthLog.recordApiCall constructs its own client from these — inert values
  // keep it from throwing; the insert is swallowed (best-effort).
  const priorUrl = Deno.env.get("SUPABASE_URL");
  const priorKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example-test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-not-real");
  return {
    restore: () => {
      if (priorUrl === undefined) Deno.env.delete("SUPABASE_URL");
      else Deno.env.set("SUPABASE_URL", priorUrl);
      if (priorKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorKey);
    },
  };
}

const DEV_KEY_SENTINEL = "DEVKEY_MUST_NEVER_BE_SENT";
const S2S_TOKEN = "S2STOKEN_api3_v2";

function setAfEnv(opts: { token?: string; iosId: string; androidId: string }): {
  restore: () => void;
} {
  const prior = {
    token: Deno.env.get("APPSFLYER_S2S_TOKEN"),
    devKey: Deno.env.get("APPSFLYER_BUSINESS_DEV_KEY"),
    ios: Deno.env.get("APPSFLYER_BUSINESS_IOS_APP_ID"),
    android: Deno.env.get("APPSFLYER_BUSINESS_ANDROID_APP_ID"),
  };
  if (opts.token === undefined) Deno.env.delete("APPSFLYER_S2S_TOKEN");
  else Deno.env.set("APPSFLYER_S2S_TOKEN", opts.token);
  // Always present so we can prove it is NEVER used as the auth credential.
  Deno.env.set("APPSFLYER_BUSINESS_DEV_KEY", DEV_KEY_SENTINEL);
  Deno.env.set("APPSFLYER_BUSINESS_IOS_APP_ID", opts.iosId);
  Deno.env.set("APPSFLYER_BUSINESS_ANDROID_APP_ID", opts.androidId);
  return {
    restore: () => {
      const put = (k: string, v: string | undefined) =>
        v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
      put("APPSFLYER_S2S_TOKEN", prior.token);
      put("APPSFLYER_BUSINESS_DEV_KEY", prior.devKey);
      put("APPSFLYER_BUSINESS_IOS_APP_ID", prior.ios);
      put("APPSFLYER_BUSINESS_ANDROID_APP_ID", prior.android);
    },
  };
}

Deno.test("ensureIdPrefix is idempotent (bare + prefixed both → id-prefixed)", () => {
  assertEquals(ensureIdPrefix("6768737367"), "id6768737367");
  assertEquals(ensureIdPrefix("id6768737367"), "id6768737367");
});

Deno.test({
  name: "T-D1: iOS device, token set → id-prefixed URL, token auth header, os:ios, true",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: S2S_TOKEN,
      iosId: "6768737367",
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-ios",
          platform: "ios",
        }),
        userId: "user-1",
        eventName: "first_ticket_sold",
        eventValues: { af_revenue: 25, af_currency: "USD" },
      });
      assertEquals(ok, true);
      assertEquals(captured.length, 1);
      const call = captured[0];
      assertStringIncludes(
        call.url,
        "https://api3.appsflyer.com/inappevent/id6768737367",
      );
      assert(!call.url.includes("idid"), "must not double-prefix");
      assertEquals(call.authHeader, S2S_TOKEN);
      assert(
        call.authHeader !== DEV_KEY_SENTINEL,
        "dev key must NEVER be sent as the api3 auth credential",
      );
      assertEquals(call.body.os, "ios");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "T-D2: token unset → fail-closed, returns false, NEVER sends the dev key",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: undefined, // APPSFLYER_S2S_TOKEN absent
      iosId: "6768737367",
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-ios",
          platform: "ios",
        }),
        userId: "user-1",
        eventName: "first_ticket_sold",
      });
      assertEquals(ok, false);
      assertEquals(captured.length, 0, "no api3 POST may leave the function");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "T-D3: iOS secret already id-prefixed → single id prefix (no idid)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: S2S_TOKEN,
      iosId: "id6768737367", // already prefixed
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-ios",
          platform: "ios",
        }),
        userId: "user-1",
        eventName: "first_payout",
      });
      assertEquals(ok, true);
      assertEquals(captured.length, 1);
      assertStringIncludes(
        captured[0].url,
        "https://api3.appsflyer.com/inappevent/id6768737367",
      );
      assert(!captured[0].url.includes("idid"), "must not double-prefix");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "T-D4: Android device → bare package path, os:android",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: S2S_TOKEN,
      iosId: "6768737367",
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-android",
          platform: "android",
        }),
        userId: "user-1",
        eventName: "first_activated",
      });
      assertEquals(ok, true);
      assertEquals(captured.length, 1);
      assertStringIncludes(
        captured[0].url,
        "https://api3.appsflyer.com/inappevent/com.sethogieva.minglabusiness",
      );
      assert(
        !captured[0].url.includes("/id"),
        "Android package must not be id-prefixed",
      );
      assertEquals(captured[0].body.os, "android");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  // sanitizers off: prior tests' fire-and-forget apiHealthLog insert (supabase-js)
  // can leave a short-lived timer that completes during this test.
  name: "T-D5: dead process-referral function directory is removed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let exists = true;
    try {
      await Deno.stat(
        new URL("../../process-referral/index.ts", import.meta.url),
      );
    } catch {
      exists = false;
    }
    assertEquals(
      exists,
      false,
      "supabase/functions/process-referral/ must be deleted (dead, deprecated api2 path)",
    );
  },
});
