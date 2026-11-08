/**
 * issue #3645 bundle 2c — payout-release-sweep side of the float forecast and
 * alert changes:
 *   - the Mingla-wide float row (release_id and brand_id NULL) is delivered
 *     with its message as the body, no release ids, and the outbox key;
 *   - release-anchored kinds are delivered exactly as before;
 *   - stay_dispute_hold_open has its own copy and honours the outbox key;
 *   - the stale stay-dispute raise runs before the alert drain on a dark tick,
 *     and its failure never changes the tick's outcome.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePayoutReleaseSweep } from "../index.ts";

type Alert = {
  alert_id: string;
  release_id: string | null;
  brand_id: string | null;
  alert_kind: string;
  error_message: string;
  idempotency_key: string;
  claim_id: string;
};

const EMPTY_ROW_RPCS = new Set([
  "list_missing_payout_source_fees",
  "surface_payout_releases_waiting_for_bank",
  "claim_brand_payout_pause_notices",
  "claim_brand_payout_outcome_notices",
  "claim_reservation_slot_unavailable_alerts",
]);

function harness(
  alerts: Alert[],
  stale: () => Promise<{ data: unknown; error: { message: string } | null }>,
) {
  const rpcNames: string[] = [];
  const recorded: Array<Record<string, unknown>> = [];
  const deps = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://example.test"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-secret"
        : undefined,
    createAdmin: (() => ({
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcNames.push(name);
        if (name === "claim_payout_release_alerts") {
          return Promise.resolve({ data: alerts, error: null });
        }
        if (name === "record_payout_release_alert_delivery") {
          recorded.push(args);
          return Promise.resolve({ data: args.p_outcome, error: null });
        }
        if (name === "issue_3645_raise_stale_stay_dispute_alerts") return stale();
        if (EMPTY_ROW_RPCS.has(name)) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: { dark: true, executed: 0 }, error: null });
      },
      from: () => {
        throw new Error("no table reads expected");
      },
    })) as never,
    resolveProviderFee: () => {
      throw new Error("no provider-fee candidates expected");
    },
  };
  return { deps, rpcNames, recorded };
}

async function withNotifyCapture(
  run: () => Promise<Response>,
): Promise<{ response: Response; sent: Array<Record<string, unknown>> }> {
  const sent: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  const realUrl = Deno.env.get("SUPABASE_URL");
  const realKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-secret");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/functions/v1/notify-dispatch")) {
      sent.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, providerAccepted: true }), { status: 200 }),
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const response = await run();
    return { response, sent };
  } finally {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", realUrl);
    if (realKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", realKey);
  }
}

const request = () =>
  new Request("https://example.test", {
    method: "POST",
    headers: { authorization: "Bearer service-secret" },
  });

const FLOAT_MESSAGE =
  "NGN 1,500.00 of Nigerian payouts mature by 2026-11-15; Paystack balance is NGN 0.00; top up NGN 1,500.00 before then.";

Deno.test("#3645 2c the Mingla-wide float row is delivered with no release ids and its outbox key", async () => {
  const { deps, recorded } = harness([{
    alert_id: "alert-global",
    release_id: null,
    brand_id: null,
    alert_kind: "paystack_float_shortfall",
    error_message: FLOAT_MESSAGE,
    idempotency_key: "paystack_float_shortfall:mingla:r3",
    claim_id: "claim-global",
  }], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  const { response, sent } = await withNotifyCapture(() => handlePayoutReleaseSweep(request(), deps));
  assertEquals(response.status, 200);
  assertEquals(sent.length, 1);
  const body = sent[0];
  assertEquals(body.type, "ops.paystack_payout_float_shortfall");
  assertEquals(body.body, FLOAT_MESSAGE);
  assertEquals(body.data, { alertKind: "paystack_float_shortfall" });
  assertEquals(body.relatedType, "payout_float");
  assert(!("relatedId" in body), "a release-less alert carries no relatedId");
  assertEquals(body.idempotencyKey, "paystack_float_shortfall:mingla:r3");
  assert(!String(body.body).includes("Release null"));
  assertEquals(recorded.map((r) => [r.p_alert_id, r.p_outcome]), [["alert-global", "provider_accepted"]]);
});

Deno.test("#3645 2c release-anchored alerts are delivered exactly as before", async () => {
  const { deps } = harness([
    {
      alert_id: "a1",
      release_id: "rel-1",
      brand_id: "brand-1",
      alert_kind: "paystack_balance_blocked",
      error_message: "balance below ceiling",
      idempotency_key: "paystack_balance_blocked:rel-1",
      claim_id: "c1",
    },
    {
      alert_id: "a2",
      release_id: "rel-2",
      brand_id: "brand-2",
      alert_kind: "paystack_float_shortfall",
      error_message: FLOAT_MESSAGE,
      idempotency_key: "paystack_float_shortfall:rel-2:r2",
      claim_id: "c2",
    },
  ], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  const { sent } = await withNotifyCapture(() => handlePayoutReleaseSweep(request(), deps));
  assertEquals(sent.length, 2);
  assertEquals(sent[0], {
    emailTo: "ops@mingla.app",
    emailVariant: "generic_notification",
    type: "ops.paystack_payout_release_balance_blocked",
    title: "Paystack organiser payout is blocked on the Nigerian balance",
    body:
      "Release rel-1 cannot be paid because the Nigerian Paystack balance is below its release ceiling. Last error: balance below ceiling",
    data: { releaseId: "rel-1", brandId: "brand-1", alertKind: "paystack_balance_blocked" },
    relatedId: "rel-1",
    relatedType: "payout_release",
    idempotencyKey: "ops.paystack_payout_release_balance_blocked:rel-1",
    skipPush: true,
  });
  assertEquals(sent[1].idempotencyKey, "paystack_float_shortfall:rel-2:r2");
  assertEquals(sent[1].relatedId, "rel-2");
});

Deno.test("#3645 2c a long-open stay dispute alert has its own copy and honours the outbox key", async () => {
  const { deps } = harness([{
    alert_id: "s1",
    release_id: "rel-stay",
    brand_id: "brand-stay",
    alert_kind: "stay_dispute_hold_open",
    error_message: "Stay payout held by a dispute open for over 90 days: du_1.",
    idempotency_key: "stay_dispute_hold_open:rel-stay:r2",
    claim_id: "c-stay",
  }], () => Promise.resolve({ data: { raised: 1, refreshed: 0 }, error: null }));
  const { sent } = await withNotifyCapture(() => handlePayoutReleaseSweep(request(), deps));
  assertEquals(sent.length, 1);
  assertEquals(sent[0].type, "ops.stay_payout_release_dispute_hold_open");
  assertEquals(sent[0].title, "Stay payout held by a long-open dispute");
  assertEquals(sent[0].idempotencyKey, "stay_dispute_hold_open:rel-stay:r2");
  // Never the Stripe attempt-cap fallback (whose key would collide per release).
  assert(!String(sent[0].type).includes("attempt_cap"));
});

Deno.test("#3645 2c the stale raise runs before the drain on a dark tick", async () => {
  const { deps, rpcNames } = harness([], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  const response = await handlePayoutReleaseSweep(request(), deps);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).dark, true);
  const raise = rpcNames.indexOf("issue_3645_raise_stale_stay_dispute_alerts");
  const drain = rpcNames.indexOf("claim_payout_release_alerts");
  assert(raise >= 0, "the stale raise must run with execution off");
  assert(raise < drain, "raised before the drain, so it is delivered in the same tick");
});

Deno.test("#3645 2c a failing stale raise never changes the tick", async () => {
  for (
    const stale of [
      () => Promise.resolve({ data: null, error: { message: "boom" } }),
      () => Promise.reject(new Error("network down")),
    ]
  ) {
    const ok = harness([], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
    const bad = harness([], stale);
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
    let failed: Response;
    try {
      failed = await handlePayoutReleaseSweep(request(), bad.deps);
    } finally {
      console.error = realError;
    }
    const healthy = await handlePayoutReleaseSweep(request(), ok.deps);
    assertEquals(failed.status, healthy.status);
    assertEquals(await failed.json(), await healthy.json());
    assertEquals(bad.rpcNames, ok.rpcNames);
    assert(
      logged.some((line) => line.includes("stale_stay_dispute_alerts_failed")),
      "the failure is logged as a structured event",
    );
  }
});
