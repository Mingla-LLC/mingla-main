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
  failing: string | null = null,
) {
  const rpcNames: string[] = [];
  const staleArgs: Array<Record<string, unknown>> = [];
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
        if (name === failing) {
          return Promise.resolve({ data: null, error: { message: `${name} down` } });
        }
        if (name === "claim_payout_release_alerts") {
          return Promise.resolve({ data: alerts, error: null });
        }
        if (name === "record_payout_release_alert_delivery") {
          recorded.push(args);
          return Promise.resolve({ data: args.p_outcome, error: null });
        }
        if (name === "issue_3645_raise_stale_stay_dispute_alerts") {
          staleArgs.push(args);
          return stale();
        }
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
  return { deps, rpcNames, recorded, staleArgs };
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

Deno.test("#3645 bundle 4 a Paystack plan larger than what is owed has its own copy", async () => {
  const { deps, recorded } = harness([{
    alert_id: "p1",
    release_id: "rel-plan",
    brand_id: "brand-plan",
    alert_kind: "paystack_plan_exceeds_due",
    error_message: "plan 10000 > due 9999",
    idempotency_key: "paystack_plan_exceeds_due:rel-plan",
    claim_id: "c-plan",
  }], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  const { sent } = await withNotifyCapture(() => handlePayoutReleaseSweep(request(), deps));
  assertEquals(sent.length, 1);
  assertEquals(sent[0].type, "ops.paystack_payout_release_plan_exceeds_due");
  assertEquals(sent[0].title, "Paystack organiser payout plan is larger than what is owed");
  assert(String(sent[0].body).includes("plan 10000 > due 9999"));
  assertEquals(sent[0].relatedId, "rel-plan");
  // Never the Stripe attempt-cap fallback.
  assert(!String(sent[0].type).includes("attempt_cap"));
  assertEquals(recorded.length, 1);
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
  const { deps, rpcNames, staleArgs } = harness([], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  const before = Date.now();
  const response = await handlePayoutReleaseSweep(request(), deps);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).dark, true);
  const raise = rpcNames.indexOf("issue_3645_raise_stale_stay_dispute_alerts");
  const drain = rpcNames.indexOf("claim_payout_release_alerts");
  assert(raise >= 0, "the stale raise must run with execution off");
  assert(raise < drain, "raised before the drain, so it is delivered in the same tick");
  // Exactly the RPC's argument: a renamed parameter would fail every call.
  assertEquals(staleArgs.length, 1);
  assertEquals(Object.keys(staleArgs[0]), ["p_now"]);
  const at = Date.parse(String(staleArgs[0].p_now));
  assert(at >= before - 1000 && at <= Date.now() + 1000, "p_now is the current time as ISO");
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

Deno.test("#3645 2c an early failure still raises and delivers ops alerts", async () => {
  for (
    const [failing, error] of [
      ["list_missing_payout_source_fees", "fee_candidate_read_failed"],
      ["run_payout_release_dark_sweep", "ledger_sweep_failed"],
      ["surface_payout_releases_waiting_for_bank", "waiting_for_bank_surface_failed"],
    ]
  ) {
    const { deps, rpcNames, staleArgs } = harness([{
      alert_id: "s-early",
      release_id: "rel-stay",
      brand_id: "brand-stay",
      alert_kind: "stay_dispute_hold_open",
      error_message: "Stay payout held by a dispute open for over 90 days: du_1.",
      idempotency_key: "stay_dispute_hold_open:rel-stay:r1",
      claim_id: "c-early",
    }], () => Promise.resolve({ data: { raised: 1, refreshed: 0 }, error: null }), failing);
    const realError = console.error;
    console.error = () => {};
    let result: { response: Response; sent: Array<Record<string, unknown>> };
    try {
      result = await withNotifyCapture(() => handlePayoutReleaseSweep(request(), deps));
    } finally {
      console.error = realError;
    }
    assertEquals(result.response.status, 500, failing);
    assertEquals((await result.response.json()).error, error);
    assertEquals(staleArgs.length, 1, `${failing}: the stale raise must still run`);
    const raise = rpcNames.indexOf("issue_3645_raise_stale_stay_dispute_alerts");
    const drain = rpcNames.indexOf("claim_payout_release_alerts");
    assert(raise >= 0 && drain > raise, `${failing}: raised, then drained`);
    assertEquals(rpcNames.filter((n) => n === "claim_payout_release_alerts").length, 1);
    assertEquals(result.sent.map((m) => m.idempotencyKey), ["stay_dispute_hold_open:rel-stay:r1"]);
  }
});

Deno.test("#3645 2c a normal tick raises and drains exactly once", async () => {
  const { deps, rpcNames } = harness([], () => Promise.resolve({ data: { raised: 0, refreshed: 0 }, error: null }));
  await handlePayoutReleaseSweep(request(), deps);
  assertEquals(rpcNames.filter((n) => n === "issue_3645_raise_stale_stay_dispute_alerts").length, 1);
  assertEquals(rpcNames.filter((n) => n === "claim_payout_release_alerts").length, 1);
});
