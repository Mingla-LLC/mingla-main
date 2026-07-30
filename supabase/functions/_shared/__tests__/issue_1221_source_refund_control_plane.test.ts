import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSourceRefundRecipientRows } from "../sourceRefundNotifications.ts";
import {
  deriveSourceRefundAttentionToken,
  hashSourceRefundAttentionToken,
  readSourceRefundAttentionKeyRing,
} from "../sourceRefundAttentionToken.ts";
import {
  canonicalPublicIpLiteral,
  sourceRefundClientIp,
} from "../sourceRefundClientIp.ts";
import {
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../sourceRefundNotificationRecipient.ts";
import {
  runSourceRefundOperation,
  type SourceRefundOperation,
} from "../sourceRefundControlPlane.ts";

const source = await Deno.readTextFile(
  new URL("../sourceRefundControlPlane.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270131001221_issue_1221_source_refund_control_plane.sql",
    import.meta.url,
  ),
);

Deno.test("#1221 uses independent exact provider legs", () => {
  assertStringIncludes(migration, "source_refund_buyer:");
  assertStringIncludes(migration, "source_refund_fee:");
  assertStringIncludes(source, "refund_application_fee: false");
  assertStringIncludes(source, "applicationFees.createRefund");
  assertStringIncludes(source, "set_source_refund_stripe_fee_identity");
  assert(!source.includes("refund_application_fee: true"));
});

Deno.test("#1221 posts no money while its kill switch is active", () => {
  assertStringIncludes(
    source,
    'const KILL_SWITCH = "SOURCE_REFUNDS_POST_DISABLED"',
  );
  assertStringIncludes(source, "if (!sourceRefundPostsEnabled()) return");
});

function testSecurityBundle(): string {
  const key = (byte: number) =>
    btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
  return JSON.stringify({
    SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID: "att1",
    SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64: key(1),
    SOURCE_REFUND_ATTENTION_IP_CURRENT_KID: "ip1",
    SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64: key(2),
    SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID: "rec1",
    SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64: key(3),
  });
}

Deno.test("#1221 deterministic attention tokens are purpose separated and stored only as hashes", async () => {
  const ring = readSourceRefundAttentionKeyRing(testSecurityBundle());
  const input = {
    refundId: "123e4567-e89b-42d3-a456-426614174000",
    generation: 4,
    key: ring.current,
  };
  const first = await deriveSourceRefundAttentionToken(input);
  const second = await deriveSourceRefundAttentionToken(input);
  assertEquals(first, second);
  assert(first.startsWith("att1."));
  const stored = await hashSourceRefundAttentionToken(first);
  assert(stored.startsWith("v1:att1:"));
  assert(!stored.includes(first));
});

Deno.test("#1221 client-IP fingerprinting accepts only the canonical first public proxy hop", () => {
  assertEquals(sourceRefundClientIp("8.8.8.8, 10.0.0.1"), "8.8.8.8");
  assertEquals(sourceRefundClientIp("10.0.0.1, 8.8.8.8"), null);
  assertEquals(canonicalPublicIpLiteral("2001:4860:4860::8888"), "2001:4860:4860::8888");
  assertEquals(canonicalPublicIpLiteral("2001:db8::1"), null);
});

Deno.test("#1221 direct notification recipients persist keyed fingerprints, never raw contact", async () => {
  const keys = readSourceRefundRecipientKeys(testSecurityBundle());
  const fingerprint = await sourceRefundRecipientFingerprint({
    key: keys.current,
    channel: "email",
    recipient: "Buyer@Example.com",
  });
  assert(fingerprint.startsWith("v1:rec1:"));
  assert(!fingerprint.includes("buyer"));
});

Deno.test("#1221 signed-in refund recipients get one contact-free row for each requested channel", () => {
  const rows = buildSourceRefundRecipientRows({
    categoryKey: "source_refund_buyer_state",
    idempotencyPrefix: "source_refund:refund-1:1:9",
    brandId: "brand-1",
    payload: { state: "processed", source_refund_id: "refund-1" },
    userId: "user-1",
    email: "buyer@example.com",
    phone: "+15555550123",
    audience: "buyer",
    generation: 1,
    eventId: 9,
    brandName: "Mingla",
  });

  assertEquals(rows.map((row) => row.channel), [
    "inapp",
    "push",
    "email",
    "sms",
  ]);
  assert(rows.every((row) => row.contact === null));
  assertEquals(rows[2].recipient, "buyer@example.com");
  assertEquals(rows[3].recipient, "+15555550123");
});

Deno.test("#1221 guest refund recipients get one idempotent row per available direct channel", () => {
  const rows = buildSourceRefundRecipientRows({
    categoryKey: "source_refund_buyer_state",
    idempotencyPrefix: "source_refund:refund-1:1:9",
    brandId: "brand-1",
    payload: { state: "processed", source_refund_id: "refund-1" },
    email: "guest@example.com",
    phone: "+15555550124",
    audience: "buyer",
    generation: 1,
    eventId: 9,
    brandName: "Mingla",
  });

  assertEquals(
    rows.map((row) => [
      row.user_id,
      row.contact,
      row.channel,
      row.recipient,
    ]),
    [
      [null, null, "email", "guest@example.com"],
      [null, null, "sms", "+15555550124"],
    ],
  );
});

Deno.test("#1221 adopted Paystack attempt reconciles its persisted identity without a second POST", async () => {
  const originalFetch = globalThis.fetch;
  const originalDisabled = Deno.env.get("SOURCE_REFUNDS_POST_DISABLED");
  const originalMode = Deno.env.get("PAYSTACK_MODE");
  const originalKey = Deno.env.get("PAYSTACK_SECRET_KEY_TEST");
  const calls: Array<{ method: string; url: string }> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const persistedMerchantNote = "mingla_venue_refund:legacy-reservation";

  class Query {
    select() {
      return this;
    }
    eq() {
      return this;
    }
    is() {
      return this;
    }
    not() {
      return this;
    }
    in() {
      return this;
    }
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    }
    upsert() {
      return Promise.resolve({ data: null, error: null });
    }
    then(
      resolve: (value: { data: unknown[]; error: null }) => unknown,
    ) {
      return Promise.resolve(resolve({ data: [], error: null }));
    }
  }
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "ensure_source_refund_attempt") {
        return Promise.resolve({
          data: {
            attempt_no: 1,
            idempotency_key: "paystack-refund:legacy-persisted",
            merchant_note: persistedMerchantNote,
            provider_operation_id: "legacy-provider-refund",
            reconcile_only: true,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
    from() {
      return new Query();
    },
  };
  globalThis.fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: true,
          data: [{
            id: "legacy-provider-refund",
            merchant_note: persistedMerchantNote,
            amount: 10000,
            status: "processed",
          }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;
  Deno.env.set("SOURCE_REFUNDS_POST_DISABLED", "false");
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue1221adoption");

  try {
    await runSourceRefundOperation(
      client,
      {
        id: "refund-adopted",
        source_type: "venue_reservation",
        source_id: "session-adopted",
        subject_id: "reservation-adopted",
        brand_id: "brand-adopted",
        provider: "paystack",
        currency: "NGN",
        original_charge_cents: 10000,
        original_application_fee_cents: 0,
        buyer_refund_requested_cents: 10000,
        fee_reversal_required_cents: 0,
        buyer_state: "needs_attention",
        fee_state: "not_required",
        active_buyer_attempt_no: 1,
        active_fee_attempt_no: 0,
        provider_payment_reference: "legacy-transaction",
        provider_account_reference: null,
        stripe_application_fee_id: null,
        provider_refund_id: "legacy-provider-refund",
      } satisfies SourceRefundOperation,
    );
    assertEquals(calls.length, 1);
    assertEquals(calls[0].method, "GET");
    assertStringIncludes(calls[0].url, "transaction=legacy-transaction");
    const committed = rpcs.find((entry) =>
      entry.fn === "record_source_refund_provider_event"
    );
    assertEquals(
      committed?.args.p_provider_operation_id,
      "legacy-provider-refund",
    );
    assertEquals(committed?.args.p_next_state, "processed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDisabled === undefined) {
      Deno.env.delete("SOURCE_REFUNDS_POST_DISABLED");
    } else Deno.env.set("SOURCE_REFUNDS_POST_DISABLED", originalDisabled);
    if (originalMode === undefined) Deno.env.delete("PAYSTACK_MODE");
    else Deno.env.set("PAYSTACK_MODE", originalMode);
    if (originalKey === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY_TEST");
    else Deno.env.set("PAYSTACK_SECRET_KEY_TEST", originalKey);
  }
});
