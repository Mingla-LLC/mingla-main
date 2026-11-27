// MINGLA-INVARIANT: I-4624-17 | issue #4624 | ticket-checkout-create extends a capped discount's hold before any provider object exists (web Stripe, native Stripe, Paystack), closes the web Checkout page with it, and fails closed when the extend fails.
// #4624 item 5a (D-5a). Unit tests for discountHold.ts plus a structural pin on
// index.ts: the extend runs before every provider call, a failure returns
// before them, and the web page's expires_at follows the extended hold.
// FAILS ON REVERT: drop the extend block or the expires_at branch from index.ts
// and the structural tests go red; change the page end or margin and the unit
// tests go red.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cappedDiscountPageEndsMs,
  DISCOUNT_HOLD_GRACE_MS,
  discountPageExpiresAtSec,
  extendCappedDiscountHold,
} from "../discountHold.ts";

const NOW = Date.UTC(2026, 10, 26, 18, 0, 0);
const SRC = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));

function fakeRpc(result: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve(result);
      },
    },
  };
}

Deno.test("#4624 page end: now + Stripe's floor, or the door code's own end", () => {
  assertEquals(cappedDiscountPageEndsMs(null, NOW), NOW + 31 * 60_000);
  const doorSec = Math.ceil((NOW + 45 * 60_000) / 1000);
  assertEquals(cappedDiscountPageEndsMs(doorSec, NOW), doorSec * 1000);
  assertEquals(discountPageExpiresAtSec(NOW + 31 * 60_000), Math.ceil((NOW + 31 * 60_000) / 1000));
});

Deno.test("#4624 the hold is extended to the page end plus 2 minutes", async () => {
  const { calls, client } = fakeRpc({ data: 1, error: null });
  const pageEnds = cappedDiscountPageEndsMs(null, NOW);
  const result = await extendCappedDiscountHold(client, "session-1", pageEnds);
  assertEquals(result, { ok: true, extended: true, pageEndsMs: pageEnds });
  assertEquals(calls, [{
    name: "issue_4624_extend_discount_hold",
    args: {
      p_checkout_session_id: "session-1",
      p_until: new Date(pageEnds + DISCOUNT_HOLD_GRACE_MS).toISOString(),
    },
  }]);
  assertEquals(DISCOUNT_HOLD_GRACE_MS, 2 * 60_000);
});

Deno.test("#4624 no capped discount: nothing extended, the page keeps 24 hours", async () => {
  const { client } = fakeRpc({ data: 0, error: null });
  const result = await extendCappedDiscountHold(client, "session-2", NOW);
  assertEquals(result, { ok: true, extended: false, pageEndsMs: NOW });
});

Deno.test("#4624 a failed or malformed extend fails closed", async () => {
  const failed = await extendCappedDiscountHold(
    fakeRpc({ data: null, error: { message: "boom" } }).client,
    "session-3",
    NOW,
  );
  assertEquals(failed, { ok: false, detail: "discount_hold_extend_failed:boom" });
  const bad = await extendCappedDiscountHold(
    fakeRpc({ data: "x", error: null }).client,
    "session-3",
    NOW,
  );
  assertEquals(bad.ok, false);
  const noSession = await extendCappedDiscountHold(
    fakeRpc({ data: 1, error: null }).client,
    "",
    NOW,
  );
  assertEquals(noSession.ok, false);
});

Deno.test("#4624 index.ts: the extend runs before every provider call and fails closed", () => {
  const extendAt = SRC.indexOf("await extendCappedDiscountHold(");
  const failAt = SRC.indexOf('detail: "discount_hold_extend_failed"');
  assert(extendAt > 0, "extend call missing");
  assert(failAt > extendAt, "fail-closed return missing after the extend");
  for (const provider of [
    "deps.paystackInitializeTransaction({",
    "stripeWeb.checkout.sessions.create(",
    "stripe.paymentIntents.create(",
  ]) {
    const at = SRC.indexOf(provider);
    assert(at > 0, `${provider} not found`);
    assert(failAt < at, `${provider} runs before the hold is extended`);
  }
  // The extend sits after the free path returns (free orders have no page).
  assert(SRC.indexOf("if (totalCents === 0) {") < extendAt);
});

Deno.test("#4624 index.ts: the web page closes with an extended hold, door pay unchanged", () => {
  assert(SRC.includes("? { expires_at: doorStripeExpiresAt(doorPay) }"));
  assert(/: discountHold\.extended\s*\?\s*\{\s*expires_at: discountPageExpiresAtSec\(\s*discountHold\.pageEndsMs,\s*\),\s*\}\s*: \{\}\),/.test(SRC));
  assert(SRC.includes("doorPay !== null ? doorStripeExpiresAt(doorPay) : null"));
});
