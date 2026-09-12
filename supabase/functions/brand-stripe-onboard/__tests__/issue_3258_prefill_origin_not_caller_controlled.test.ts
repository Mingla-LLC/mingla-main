/**
 * Issue #3258 — a REQUEST BODY FIELD MUST NOT DECIDE THE URL THAT IS BAKED
 * PERMANENTLY INTO A LIVE STRIPE ACCOUNT.
 *
 * WHY THIS FILE EXISTS
 *
 * `business_web_origin_override` comes straight off the POST body, and
 * `_shared/businessWebOrigin.ts` accepts any
 * `https://mingla-business-<anything>.vercel.app`. Before #3258 that override
 * only shaped the EPHEMERAL return/refresh journey — harmless. #3258 then fed
 * the same resolved origin into `defaults.profile.business_url`, which is
 * PERSISTED on a live Stripe connected account and which this function
 * deliberately never overwrites afterwards.
 *
 * A Vercel preview domain is deployment-protected (401) and is eventually
 * deleted. Baking one in leaves `card_payments` at `pending` with
 * `pending_verification: ["business_profile.url"]` forever — the exact defect
 * #3258 exists to kill, reachable through our own API by any authenticated
 * brand-payments manager.
 *
 * WHAT THIS FILE PROVES, AND HOW
 *
 * It drives the REAL exported `handler`, over a stubbed `globalThis.fetch`
 * that serves BOTH PostgREST/GoTrue and api.stripe.com, and reads the bytes
 * that were actually serialized onto the wire. A source-text pin could not
 * tell these two origins apart at the call site; the wire body can.
 *
 * Both halves are asserted IN THE SAME REQUEST, because the fix is a split and
 * a regression could pass by getting either half alone right:
 *   1. `defaults.profile.business_url` is built from
 *      `PRODUCTION_BUSINESS_WEB_ORIGIN` and carries no `vercel.app` anywhere.
 *   2. `onboarding_url` and the `return_to` it carries STILL honour the
 *      override — that journey is what the override is for and it is unchanged.
 *
 * FAILS-ON-REVERT: restore `origin: businessWebOrigin` in the
 * `resolveBrandPublicUrl({ ... })` call in `../index.ts` and assertion (1)
 * fails with the preview host on the wire.
 *
 * Run: deno test --allow-env --allow-net --allow-read \
 *   supabase/functions/brand-stripe-onboard/__tests__/issue_3258_prefill_origin_not_caller_controlled.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../../_shared/businessWebOrigin.ts";

const SUPABASE_URL = "https://proj-issue3258.supabase.co";
const PREVIEW_ORIGIN = "https://mingla-business-preview.vercel.app";
const BRAND_ID = "11111111-2222-4333-8444-555555555555";
const BRAND_SLUG = "lanternroom";
const USER_ID = "99999999-8888-4777-8666-555555555555";

// Env has to exist BEFORE `../index.ts` is imported: the module throws at load
// without BUSINESS_WEB_ORIGIN, and reads the Stripe mode + key at request time.
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-issue3258");
// Deliberately the PRODUCTION value, so the only thing that can put a preview
// host on the wire is the request-body override this test sends.
Deno.env.set("BUSINESS_WEB_ORIGIN", PRODUCTION_BUSINESS_WEB_ORIGIN);
Deno.env.set("MINGLA_STRIPE_MODE", "test");
Deno.env.set("STRIPE_RAK_ONBOARD_TEST", "rk_test_issue3258");

const { handler } = await import("../index.ts");

interface CapturedRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Serves every outbound call the handler makes on the fresh-create path —
 * GoTrue, PostgREST and api.stripe.com — and records the Stripe ones.
 *
 * PostgREST GET responses are ARRAYS on purpose: supabase-js resolves
 * `maybeSingle()` from the array length, so `[]` is the honest encoding of
 * "this brand has no stripe_connect_accounts row yet" and takes the handler
 * down the create branch this test is about.
 */
function withStubbedNetwork(
  fn: (stripeCalls: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const stripeCalls: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const rawBody = typeof init?.body === "string" ? init.body : "";

    if (url.startsWith("https://api.stripe.com/")) {
      // Stripe v1 paths are form-urlencoded and v2 paths are JSON
      // (`stripeBlueprintRequest` branches on the prefix). Only the v2 body is
      // parsed; a v1 body is recorded raw so a parse error can never be
      // mistaken for a Stripe failure.
      stripeCalls.push({
        url,
        body: url.includes("/v2/")
          ? JSON.parse(rawBody === "" ? "{}" : rawBody) as Record<
            string,
            unknown
          >
          : { raw: rawBody },
      });
      if (url.endsWith("/v2/core/accounts")) {
        return Promise.resolve(json({ id: "acct_issue3258" }));
      }
      if (url.endsWith("/v1/account_sessions")) {
        return Promise.resolve(json({ client_secret: "acs_issue3258" }));
      }
      return Promise.resolve(json({}));
    }

    // GoTrue — the bearer token this test sends resolves to a real user.
    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        json({
          id: USER_ID,
          aud: "authenticated",
          email: "manager@example.com",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      );
    }

    // The permission RPC says yes.
    if (url.includes("/rest/v1/rpc/biz_can_manage_payments_for_brand")) {
      return Promise.resolve(json(true));
    }

    // Mingla ToS accepted.
    if (url.includes("/rest/v1/brand_team_members")) {
      return Promise.resolve(
        json([{ mingla_tos_accepted_at: "2026-01-02T00:00:00.000Z" }]),
      );
    }

    if (url.includes("/rest/v1/stripe_connect_accounts")) {
      // The upsert (`.select(...).single()`) returns the new row as an object.
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        return Promise.resolve(
          json({ id: "sca_issue3258", stripe_account_id: "acct_issue3258" }),
        );
      }
      // The read — no existing account, so the handler creates one.
      return Promise.resolve(json([]));
    }

    if (url.includes("/rest/v1/brands")) {
      return Promise.resolve(
        json([{
          name: "Lantern Room",
          contact_email: "operator@example.com",
          default_currency: "usd",
          slug: BRAND_SLUG,
        }]),
      );
    }

    // Audit log insert and anything else — accepted, unread.
    return Promise.resolve(json([], 201));
  }) as typeof fetch;

  return fn(stripeCalls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function onboardRequest(): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/brand-stripe-onboard`, {
    method: "POST",
    headers: {
      // A trusted browser origin short-circuits the native-version gate, which
      // is not what this test is about.
      "Origin": PRODUCTION_BUSINESS_WEB_ORIGIN,
      "Authorization": "Bearer issue3258-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      brand_id: BRAND_ID,
      // The override is accepted for the return journey, so the return_url
      // must live on the preview origin — that is the point.
      return_url: `${PREVIEW_ORIGIN}/brand/${BRAND_ID}/payments`,
      country: "US",
      business_web_origin_override: PREVIEW_ORIGIN,
    }),
  });
}

const accountCreateBody = (
  calls: readonly CapturedRequest[],
): Record<string, unknown> => {
  const call = calls.find((c) => c.url.endsWith("/v2/core/accounts"));
  assert(call !== undefined, "no POST /v2/core/accounts was made");
  return call.body;
};

const profileOf = (body: Record<string, unknown>): Record<string, unknown> =>
  (body.defaults as Record<string, unknown>).profile as Record<string, unknown>;

const responsibilitiesOf = (
  body: Record<string, unknown>,
): Record<string, unknown> =>
  (body.defaults as Record<string, unknown>).responsibilities as Record<
    string,
    unknown
  >;

/**
 * `createClient` (supabase-js, imported by `../index.ts`) installs auth
 * auto-refresh timers that outlive the request, so Deno's op sanitizer flags
 * them as leaks. Same shape as the other supabase-js-backed edge tests in this
 * repo (`marketing-send/*`, `brand-people-export/*`).
 */
function edgeTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });
}

edgeTest(
  "#3258 — a request-body origin override CANNOT reach defaults.profile.business_url",
  async () => {
    await withStubbedNetwork(async (stripeCalls) => {
      const response = await handler(onboardRequest());
      assertEquals(response.status, 200);

      const body = accountCreateBody(stripeCalls);
      const businessUrl = String(profileOf(body).business_url);

      // (1) The PERSISTED URL is built from the production origin, full stop.
      assertEquals(
        businessUrl,
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/b/${BRAND_SLUG}`,
      );
      assert(
        businessUrl.startsWith(PRODUCTION_BUSINESS_WEB_ORIGIN),
        `business_url must start with the production origin, got ${businessUrl}`,
      );

      // Stated separately from the equality above so the failure message names
      // the actual hazard when someone widens the override allowlist later.
      assert(
        !businessUrl.includes("vercel.app"),
        `a preview host reached a live Stripe account: ${businessUrl}`,
      );
      // Nothing ELSE in the create body may carry the preview host either — the
      // whole serialized request is checked, not just the one field.
      assert(
        !JSON.stringify(body).includes("vercel.app"),
        "the /v2/core/accounts body carries the caller-supplied preview origin",
      );

      // The trap `issue_3258_business_profile_prefill.test.ts` guards, re-checked
      // on the handler path: the `defaults` merge must not drop responsibilities.
      assertEquals(responsibilitiesOf(body).losses_collector, "stripe");
      assertEquals(responsibilitiesOf(body).fees_collector, "stripe");
    });
  },
);

edgeTest(
  "#3258 — the same request's return journey STILL honours the override",
  async () => {
    await withStubbedNetwork(async (stripeCalls) => {
      const response = await handler(onboardRequest());
      assertEquals(response.status, 200);
      const payload = await response.json() as { onboarding_url: string };

      // The ephemeral half is unchanged: a preview build still sends the seller
      // back to the preview. Suppressing this would break preview onboarding.
      assertStringIncludes(
        payload.onboarding_url,
        `${PREVIEW_ORIGIN}/connect-onboarding`,
      );
      assertStringIncludes(
        payload.onboarding_url,
        encodeURIComponent(`${PREVIEW_ORIGIN}/brand/${BRAND_ID}/payments`),
      );

      // And the persisted half is still production, in this very same request —
      // proving the two origins genuinely diverge rather than both following
      // whichever one happens to be configured.
      assert(
        String(profileOf(accountCreateBody(stripeCalls)).business_url)
          .startsWith(
            PRODUCTION_BUSINESS_WEB_ORIGIN,
          ),
      );
    });
  },
);

edgeTest(
  "#3258 — with NO override the two origins agree, so the fix changes nothing for production callers",
  async () => {
    await withStubbedNetwork(async (stripeCalls) => {
      const response = await handler(
        new Request(`${SUPABASE_URL}/functions/v1/brand-stripe-onboard`, {
          method: "POST",
          headers: {
            "Origin": PRODUCTION_BUSINESS_WEB_ORIGIN,
            "Authorization": "Bearer issue3258-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            brand_id: BRAND_ID,
            return_url:
              `${PRODUCTION_BUSINESS_WEB_ORIGIN}/brand/${BRAND_ID}/payments`,
            country: "US",
          }),
        }),
      );
      assertEquals(response.status, 200);
      const payload = await response.json() as { onboarding_url: string };
      assertStringIncludes(
        payload.onboarding_url,
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/connect-onboarding`,
      );
      assertEquals(
        profileOf(accountCreateBody(stripeCalls)).business_url,
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/b/${BRAND_SLUG}`,
      );
    });
  },
);
