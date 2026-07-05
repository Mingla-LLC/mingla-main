// ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1] — TESTER adversarial S2S
// regression (§9 tester angle). Append-only, NEW file — attacks a DIFFERENT angle
// than the implementor's happy-path suite (appsFlyerS2S.orch1313.test.ts):
//
//   Implementor coverage GAP this file closes:
//     • T-D4 (the Android happy-path) asserts URL + os but NEVER checks the
//       `authentication` header — so a silent revert of the auth credential back
//       to the legacy dev key would pass every Android-path test. ADV-1 pins the
//       token auth header ON THE ANDROID BRANCH (fails-on-revert anchor).
//     • No implementor test proves CROSS-APP-DISCRIMINATOR ISOLATION: a user with
//       no `app='business'` device row (e.g. a consumer-only account) must NEVER
//       emit a business S2S postback, and the dev key must never leave the fn.
//       ADV-2 pins that isolation.
//     • T-D2 tests token === undefined; a blank secret (token === "") is a distinct
//       real misconfiguration. ADV-3 pins that empty-string is ALSO fail-closed.
//
// Isolation note: the `.eq("app","business")` filter (appsFlyerS2S.ts:74) is the
// discriminator that keeps consumer device rows from receiving business events;
// the Supabase stub cannot exercise the filter's argument, so ADV-2 pins the
// OBSERVABLE isolation contract (null business device → zero POSTs, fail-closed).
//
// Fails-on-revert (verified by the tester at baseline 3a4c32d58):
//   • revert `"authentication": s2sToken` → dev key  ⇒ ADV-1 fails (authHeader).
//   • remove `os: device.platform` from the body      ⇒ ADV-1 fails (body.os).

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { postAppsFlyerS2SEvent } from "../appsFlyerS2S.ts";

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

function withInertSupabaseEnv(): { restore: () => void } {
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
  // Dev key ALWAYS present — so any test that captures a POST can prove the dev
  // key is never what leaves the function as the auth credential.
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

// ADV-1 — FAILS-ON-REVERT ANCHOR. The Android branch must carry the api3 V2 S2S
// token as its `authentication` header (never the dev key) AND the required `os`
// field — the two ORCH-1313 fixes the implementor's Android happy-path (T-D4)
// leaves unasserted. Also proves the iOS `id`-prefix never leaks onto Android.
Deno.test({
  name:
    "ADV-1: Android S2S carries the TOKEN auth header (not dev key) + os:android + no id-prefix leak",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: S2S_TOKEN,
      iosId: "6768737367", // bare iOS id present in env — must NOT contaminate Android
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-android",
          platform: "android",
        }),
        userId: "biz-owner-1",
        eventName: "first_ticket_sold",
        eventValues: { af_revenue: 40, af_currency: "GBP" },
      });
      assertEquals(ok, true);
      assertEquals(captured.length, 1);
      const call = captured[0];
      // auth header is the S2S token — the assertion T-D4 omits (fails-on-revert)
      assertEquals(
        call.authHeader,
        S2S_TOKEN,
        "Android POST auth header must be APPSFLYER_S2S_TOKEN",
      );
      assert(
        call.authHeader !== DEV_KEY_SENTINEL,
        "dev key must NEVER be sent as the api3 auth credential (Android branch)",
      );
      // os field present (fails-on-revert if the os line is removed)
      assertEquals(call.body.os, "android", "body.os must equal device platform");
      // Android package is bare — the iOS id-prefix must not leak across platforms
      assertStringIncludes(
        call.url,
        "https://api3.appsflyer.com/inappevent/com.sethogieva.minglabusiness",
      );
      assert(
        !call.url.includes("/id"),
        "Android package must never be id-prefixed (no iOS cross-contamination)",
      );
      assert(!call.url.includes("6768737367"), "iOS app id must not leak onto Android URL");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

// ADV-2 — CROSS-APP-DISCRIMINATOR ISOLATION. A user with no business device row
// (fetchBusinessDevice returns null via the app='business' filter) must emit ZERO
// api3 POSTs and return false — a consumer-only account can never trigger a
// business postback, and no credential leaves the function.
Deno.test({
  name: "ADV-2: no business device (consumer-only user) → zero POSTs, false, no credential leak",
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
        supabase: makeSupabaseReturningDevice(null), // no app='business' row
        userId: "consumer-only-user",
        eventName: "first_payout",
      });
      assertEquals(ok, false, "must fail-closed when the user has no business device");
      assertEquals(
        captured.length,
        0,
        "a user without a business device must NEVER trigger a business S2S POST",
      );
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});

// ADV-3 — BLANK-SECRET fail-close. T-D2 covers token === undefined; a secret set
// to an empty string ("") is a distinct real misconfiguration and must ALSO
// fail-closed with no POST and no dev-key leak.
Deno.test({
  name: "ADV-3: empty-string APPSFLYER_S2S_TOKEN → fail-closed, zero POSTs, no dev-key leak",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const captured: CapturedFetch[] = [];
    const originalFetch = installFetchCapture(captured);
    const inert = withInertSupabaseEnv();
    const afEnv = setAfEnv({
      token: "", // blank secret, not undefined
      iosId: "6768737367",
      androidId: "com.sethogieva.minglabusiness",
    });
    try {
      const ok = await postAppsFlyerS2SEvent({
        supabase: makeSupabaseReturningDevice({
          appsflyer_uid: "af-uid-ios",
          platform: "ios",
        }),
        userId: "biz-owner-2",
        eventName: "first_activated",
      });
      assertEquals(ok, false, "blank token must fail-closed like an absent token");
      assertEquals(captured.length, 0, "no api3 POST may leave the function on a blank token");
    } finally {
      afEnv.restore();
      inert.restore();
      globalThis.fetch = originalFetch;
    }
  },
});
