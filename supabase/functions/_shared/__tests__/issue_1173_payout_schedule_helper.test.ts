/**
 * #1173 (sub-issue D of #1013) — happy-path regression test for the payout
 * schedule flip helper (SC-1). Mocks global fetch and asserts the EXACT Stripe
 * wire shape the proven S-H1/S-H9 flip requires.
 *
 * Fails-on-revert: deleting `apiVersion: STRIPE_API_VERSION` from the helper
 * (or the body / path) makes these assertions fail.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  restoreDailyPayoutSchedule,
  setManualPayoutSchedule,
  setPayoutScheduleInterval,
} from "../stripeBlueprintClient.ts";

const DUMMY_KEY = "rk_test_1173dummykeyforhelpertest";

interface CapturedRequest {
  url: string;
  method: string;
  authorization: string | null;
  stripeVersion: string | null;
  contentType: string | null;
  idempotencyKey: string | null;
  body: string;
}

function withMockedFetch(
  status: number,
  responseBody: unknown,
): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const headers = new Headers(init?.headers);
    captured.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      stripeVersion: headers.get("Stripe-Version"),
      contentType: headers.get("Content-Type"),
      idempotencyKey: headers.get("Idempotency-Key"),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
}

function setEnv(): void {
  Deno.env.set("MINGLA_STRIPE_MODE", "test");
  Deno.env.set("STRIPE_RAK_ONBOARD_TEST", DUMMY_KEY);
}

Deno.test("setManualPayoutSchedule issues the proven v1 manual-schedule flip", async () => {
  setEnv();
  const { captured, restore } = withMockedFetch(200, {
    id: "acct_test_1173",
    settings: { payouts: { schedule: { interval: "manual" } } },
  });
  try {
    const account = await setManualPayoutSchedule(
      "acct_test_1173",
      "brand-1:payout_hold_flip:acct_test_1173",
    );
    assertEquals(account.id, "acct_test_1173");
    assertEquals(captured.length, 1);
    const req = captured[0];
    // v1 account path (form-urlencoded, per stripeBlueprintRequest /v1/ branch).
    assertEquals(req.url, "https://api.stripe.com/v1/accounts/acct_test_1173");
    assertEquals(req.method, "POST");
    assertEquals(req.contentType, "application/x-www-form-urlencoded");
    // The manual interval, bracket-serialized (brackets are percent-encoded on
    // the wire per encodeURIComponent — assert the decoded, readable form).
    assertStringIncludes(
      decodeURIComponent(req.body),
      "settings[payouts][schedule][interval]=manual",
    );
    // v1 API version pin (NOT the default v2 preview version).
    assertEquals(req.stripeVersion, "2026-04-22.dahlia");
    // ONBOARD restricted key, resolved via stripeMode (test suffix).
    assertEquals(req.authorization, `Bearer ${DUMMY_KEY}`);
    // Caller-supplied idempotency key threads through.
    assertEquals(req.idempotencyKey, "brand-1:payout_hold_flip:acct_test_1173");
  } finally {
    restore();
  }
});

Deno.test("restoreDailyPayoutSchedule issues the daily rollback flip", async () => {
  setEnv();
  const { captured, restore } = withMockedFetch(200, {
    id: "acct_test_1173",
    settings: { payouts: { schedule: { interval: "daily" } } },
  });
  try {
    await restoreDailyPayoutSchedule("acct_test_1173", "brand-1:rollback");
    assertEquals(captured.length, 1);
    assertStringIncludes(
      decodeURIComponent(captured[0].body),
      "settings[payouts][schedule][interval]=daily",
    );
    assertEquals(captured[0].stripeVersion, "2026-04-22.dahlia");
  } finally {
    restore();
  }
});

Deno.test("setPayoutScheduleInterval surfaces Stripe errors (no silent failure)", async () => {
  setEnv();
  const { restore } = withMockedFetch(403, {
    error: { type: "invalid_request_error", message: "no permission" },
  });
  try {
    let threw = false;
    try {
      await setPayoutScheduleInterval("acct_x", "manual", "idem-x");
    } catch (err) {
      threw = true;
      assertStringIncludes(String(err), "no permission");
    }
    assertEquals(threw, true);
  } finally {
    restore();
  }
});
