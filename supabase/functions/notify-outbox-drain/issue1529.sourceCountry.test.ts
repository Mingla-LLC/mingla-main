// Issue #1529 — T-2b: the TypeScript producer guard for the source-refund pool,
// and T-4's drain half (a policy skip must not become a delivery failure).
//
// WHY THE SOURCE-REFUND POOL IS DIFFERENT. Every other producer can write the
// recipient's country onto the outbox row at enqueue time. This one cannot:
// #1221 deliberately writes `contact: null` for source-refund notifications and
// keeps the plaintext recipient out of `notification_outbox` entirely — only an
// HMAC fingerprint is persisted, and the real recipient is recovered at DRAIN
// time by `resolve_source_refund_notification_recipient`. So `row.country_code`
// is structurally NULL for this pool forever, and the country has to be derived
// here, after resolution. Writing it at enqueue would mean putting recipient
// PII into a table built to hold none.
//
// WHAT THESE TESTS PIN.
//   A. The body POSTed to notify-dispatch carries the DERIVED country ("NG")
//      even though the outbox row's own country_code is NULL. Asserted on the
//      actual serialized request body, not on source text — a grep-style check
//      would pass vacuously here.
//   B. A 200 {success:true, outcome:"skipped"} response completes the delivery
//      as `skipped`, NOT as `terminal_unsent`. This is the money-path
//      correctness requirement: `terminal_unsent` flows through
//      `complete_source_refund_notification_delivery` to
//      `UPDATE public.source_refunds SET ops_status='needs_review'`, so without
//      this branch every Nigerian refund text raises a false ops alarm the day
//      Nigeria's rows genuinely start saying NG.
//
// fails-on-revert:
//   A fails if `country_code` in processSource reverts to `row.country_code ??
//     null` — the body then carries null instead of "NG".
//   B fails if the `policySkipped` branch is deleted — the 200/skipped envelope
//     falls through to the `!accepted && !ambiguous` protocol-error path and
//     completeSource is never called with "skipped".

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { processSource } from "./index.ts";
import { sourceRefundPayloadFingerprint } from "../_shared/sourceRefundNotifications.ts";
import {
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../_shared/sourceRefundNotificationRecipient.ts";

const NG_RECIPIENT = "+2348012345678";
const DISPATCH_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = "issue-1529-service-role";
const DELIVERY_ID = "00000000-1529-4000-8000-000000000001";
const REFUND_ID = "00000000-1529-4000-8000-000000000002";

/** 32 distinct bytes → the exact base64 shape decodeKey() demands. */
function key32(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  return btoa(String.fromCharCode(...bytes));
}

/** A valid AD_CONVERSION_TOKENS bundle: 3 required slots, all distinct. */
const TOKEN_BUNDLE = JSON.stringify({
  SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID: "at1",
  SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64: key32(1),
  SOURCE_REFUND_ATTENTION_IP_CURRENT_KID: "ip1",
  SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64: key32(2),
  SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID: "rk1",
  SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64: key32(3),
});

const OUTBOX_ROW = {
  id: "00000000-1529-4000-8000-000000000003",
  category_key: "source_refund_buyer_state",
  user_id: null,
  // The whole point: the row's OWN country is NULL and always will be.
  country_code: null,
  payload: { state: "refunded" },
  idempotency_key: "issue-1529-source-refund",
  brand_name_snapshot: "Test Brand",
};

interface Harness {
  dispatchBodies: Record<string, unknown>[];
  completeCalls: Record<string, unknown>[];
}

/**
 * Build a fake admin client + fetch stub that walk processSource all the way to
 * the notify-dispatch POST, with REAL fingerprints so none of the integrity
 * guards short-circuit the path we are trying to observe.
 */
async function runProcessSource(
  dispatchResponse: Response,
): Promise<{ harness: Harness; result: boolean }> {
  const previousTokens = Deno.env.get("AD_CONVERSION_TOKENS");
  Deno.env.set("AD_CONVERSION_TOKENS", TOKEN_BUNDLE);

  const harness: Harness = { dispatchBodies: [], completeCalls: [] };

  const payloadFingerprint = await sourceRefundPayloadFingerprint({
    payload: OUTBOX_ROW.payload,
    category: OUTBOX_ROW.category_key,
    audience: "buyer",
    channel: "sms",
    serializerVersion: 1,
  });
  const recipientKeys = readSourceRefundRecipientKeys();
  const recipientFingerprint = await sourceRefundRecipientFingerprint({
    key: recipientKeys.current,
    channel: "sms",
    recipient: NG_RECIPIENT,
  });

  const admin = {
    // deno-lint-ignore no-explicit-any
    rpc(name: string, args: Record<string, unknown>): Promise<any> {
      if (name === "claim_source_refund_notification_delivery") {
        return Promise.resolve({
          data: {
            outcome: "claimed",
            deliveryId: DELIVERY_ID,
            audience: "buyer",
            channel: "sms",
            serializerVersion: 1,
            payloadFingerprint,
            recipientFingerprint,
            recipientKeyId: "rk1",
            refundId: REFUND_ID,
            generation: 1,
          },
          error: null,
        });
      }
      if (name === "resolve_source_refund_notification_recipient") {
        return Promise.resolve({
          data: { recipient: NG_RECIPIENT, keyId: "rk1" },
          error: null,
        });
      }
      if (name === "complete_source_refund_notification_delivery") {
        harness.completeCalls.push(args);
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "classify_source_refund_notification_failure") {
        harness.completeCalls.push({ ...args, __classify: true });
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
    from() {
      return {
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    harness.dispatchBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    return Promise.resolve(dispatchResponse.clone());
  }) as typeof fetch;

  try {
    const result = await processSource(
      admin,
      OUTBOX_ROW as unknown as Record<string, unknown>,
      DISPATCH_URL,
      SERVICE_KEY,
    );
    return { harness, result: result as boolean };
  } finally {
    globalThis.fetch = realFetch;
    if (previousTokens === undefined) Deno.env.delete("AD_CONVERSION_TOKENS");
    else Deno.env.set("AD_CONVERSION_TOKENS", previousTokens);
  }
}

// ---------------------------------------------------------------------------
// T-2b — the derived country reaches the wire.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-2b: a source-refund SMS dispatch carries the DERIVED country, not the NULL column", async () => {
  const { harness } = await runProcessSource(
    new Response(
      JSON.stringify({ success: true, outcome: "accepted", providerMessageId: "pm-1" }),
      { status: 200 },
    ),
  );

  assertEquals(
    harness.dispatchBodies.length,
    1,
    "expected exactly one notify-dispatch POST",
  );
  const body = harness.dispatchBodies[0];
  // The outbox row said NULL...
  assertEquals(OUTBOX_ROW.country_code, null);
  // ...and the dispatch still went out as NG, derived from the resolved handset.
  assertEquals(
    body.country_code,
    "NG",
    "the drain must derive NG from the resolved recipient; forwarding the NULL column is the #1529 defect",
  );
  assertEquals(body.contact, NG_RECIPIENT);
  assertEquals(body.requested_channel, "sms");
});

// ---------------------------------------------------------------------------
// T-2b negative control — proves the assertion above is measuring derivation
// and not just echoing a hardcoded value. A US handset must produce "US".
// ---------------------------------------------------------------------------
Deno.test("#1529 T-2b control: the derived country tracks the handset, it is not hardcoded", async () => {
  // Same harness, but the resolved recipient is American. If the country were
  // hardcoded or echoed from a constant, this would still say NG.
  const previousTokens = Deno.env.get("AD_CONVERSION_TOKENS");
  Deno.env.set("AD_CONVERSION_TOKENS", TOKEN_BUNDLE);
  const US_RECIPIENT = "+14155550123";
  const bodies: Record<string, unknown>[] = [];

  const payloadFingerprint = await sourceRefundPayloadFingerprint({
    payload: OUTBOX_ROW.payload,
    category: OUTBOX_ROW.category_key,
    audience: "buyer",
    channel: "sms",
    serializerVersion: 1,
  });
  const recipientKeys = readSourceRefundRecipientKeys();
  const recipientFingerprint = await sourceRefundRecipientFingerprint({
    key: recipientKeys.current,
    channel: "sms",
    recipient: US_RECIPIENT,
  });

  const admin = {
    // deno-lint-ignore no-explicit-any
    rpc(name: string): Promise<any> {
      if (name === "claim_source_refund_notification_delivery") {
        return Promise.resolve({
          data: {
            outcome: "claimed",
            deliveryId: DELIVERY_ID,
            audience: "buyer",
            channel: "sms",
            serializerVersion: 1,
            payloadFingerprint,
            recipientFingerprint,
            recipientKeyId: "rk1",
            refundId: REFUND_ID,
            generation: 1,
          },
          error: null,
        });
      }
      if (name === "resolve_source_refund_notification_recipient") {
        return Promise.resolve({
          data: { recipient: US_RECIPIENT, keyId: "rk1" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      return {
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return Promise.resolve(
      new Response(
        JSON.stringify({ success: true, outcome: "accepted", providerMessageId: "pm-2" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    await processSource(
      admin,
      OUTBOX_ROW as unknown as Record<string, unknown>,
      DISPATCH_URL,
      SERVICE_KEY,
    );
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].country_code, "US");
  } finally {
    globalThis.fetch = realFetch;
    if (previousTokens === undefined) Deno.env.delete("AD_CONVERSION_TOKENS");
    else Deno.env.set("AD_CONVERSION_TOKENS", previousTokens);
  }
});

// ---------------------------------------------------------------------------
// T-4 (drain half) — a policy skip completes as `skipped`, never as a failure.
//
// This is the assertion that protects a LIVE MONEY PATH. `terminal_unsent`
// reaches `complete_source_refund_notification_delivery`, which sets the
// delivery to `failed_terminal` and then runs
// `UPDATE public.source_refunds SET ops_status='needs_review',
//  last_error_code='attention_delivery_unavailable'`.
// 'skipped' is deliberately NOT in that escalation set, so recording the honest
// outcome is what keeps the refund queue clean.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-4(drain): a kill-switched send completes as 'skipped' and never as 'terminal_unsent'", async () => {
  const { harness, result } = await runProcessSource(
    new Response(
      JSON.stringify({
        success: true,
        outcome: "skipped",
        reason: "provider_kill_switch_off",
      }),
      { status: 200 },
    ),
  );

  const completes = harness.completeCalls.filter((c) => !c.__classify);
  assertEquals(
    completes.length,
    1,
    "expected exactly one complete_source_refund_notification_delivery call",
  );
  assertEquals(
    completes[0].p_outcome,
    "skipped",
    "a deliberate policy skip must be recorded as skipped",
  );
  assertEquals(completes[0].p_safe_code, "provider_kill_switch_off");
  assertEquals(completes[0].p_provider_message_id, null);
  // The row is finished, not retried.
  assertEquals(result, true);

  // The specific regression: it must NOT have been escalated as a failure,
  // because that is what flips source_refunds.ops_status to needs_review.
  for (const call of harness.completeCalls) {
    assert(
      call.p_outcome !== "terminal_unsent",
      "a policy skip was recorded as terminal_unsent — this raises a FALSE refund-ops alarm on a live money path",
    );
    assert(
      call.__classify !== true,
      "a policy skip was routed through classify_source_refund_notification_failure",
    );
  }
});

// ---------------------------------------------------------------------------
// T-4 negative control — a genuine protocol error is STILL treated as a
// failure. Without this, the test above could pass by making everything
// "skipped", which would hide real delivery breakage.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-4(drain) control: a malformed envelope is still classified as a failure", async () => {
  const { harness, result } = await runProcessSource(
    new Response(JSON.stringify({ success: true, outcome: "nonsense" }), {
      status: 200,
    }),
  );
  assertEquals(result, false);
  assert(
    harness.completeCalls.some((c) => c.__classify === true),
    "a protocol error must still reach classify_source_refund_notification_failure",
  );
});
