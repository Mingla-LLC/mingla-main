import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSourceRefundRecipientRows } from "../sourceRefundNotifications.ts";
import { sourceRefundNoticeCopy } from "../sourceRefundNotifications.ts";
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
  assertEquals(
    canonicalPublicIpLiteral("2001:4860:4860::8888"),
    "2001:4860:4860::8888",
  );
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
    const url = String(input);
    calls.push({
      method: init?.method ?? "GET",
      url,
    });
    if (url.includes("/transaction/verify/legacy-transaction")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: true,
            data: {
              id: 1221001,
              reference: "legacy-transaction",
              status: "success",
              currency: "NGN",
              amount: 10000,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    assertStringIncludes(url, "/refund?transaction=1221001&perPage=100");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: true,
          data: [{
            id: "legacy-provider-refund",
            merchant_note: persistedMerchantNote,
            amount: 10000,
            status: "processed",
            transaction: 1221001,
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
    assertEquals(calls.length, 2);
    assertEquals(calls[0].method, "GET");
    assertStringIncludes(
      calls[0].url,
      "/transaction/verify/legacy-transaction",
    );
    assertEquals(calls[1].method, "GET");
    assertStringIncludes(calls[1].url, "transaction=1221001");
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

// ── Ticket checkout refund notices ──────────────────────────────────────────
// A buyer whose ticket could not be confirmed is refunded automatically. They
// must be told why, in words that match what happened, and the brand must be
// told too. The notice must also be queued for the contact the recipient
// resolver will read back at send time (a contact corrected on the refund
// first), or the keyed fingerprint cannot match and nothing is sent.
async function runTicketRefundNotices(
  overrides: Partial<SourceRefundOperation> = {},
) {
  const originalFetch = globalThis.fetch;
  const saved = new Map<string, string | undefined>();
  const env = {
    SOURCE_REFUNDS_POST_DISABLED: "false",
    PAYSTACK_MODE: "test",
    PAYSTACK_SECRET_KEY_TEST: "sk_test_ticketrefundnotice",
    AD_CONVERSION_TOKENS: testSecurityBundle(),
  };
  for (const [name, value] of Object.entries(env)) {
    saved.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  const persistedMerchantNote = "mingla_source_refund:ticket-refund:1";
  const outbox: Array<Record<string, unknown>> = [];
  const deliveries: Array<Record<string, unknown>> = [];

  class Query {
    constructor(private readonly table: string) {}
    private pending: Record<string, unknown> | null = null;
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
      if (this.table === "ticket_checkout_sessions") {
        return Promise.resolve({
          data: {
            buyer_user_id: null,
            buyer_email: "buyer@example.com",
            buyer_phone_e164: "+15555550101",
          },
          error: null,
        });
      }
      if (this.table === "brands") {
        return Promise.resolve({
          data: {
            name: "Ticket brand",
            contact_email: "brand@example.com",
            contact_phone: "+15555550100",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }
    upsert(payload: Record<string, unknown>) {
      this.pending = payload;
      if (this.table === "notification_outbox") outbox.push(payload);
      if (this.table === "source_refund_notification_deliveries") {
        deliveries.push(payload);
      }
      return this;
    }
    single() {
      return Promise.resolve({
        data: { id: `outbox-${outbox.length}` },
        error: null,
      });
    }
    then(
      resolve: (value: { data: unknown; error: null }) => unknown,
    ) {
      if (this.table === "brand_team_members") {
        return Promise.resolve(resolve({
          data: [{ user_id: "team-user-1", role: "brand_owner" }],
          error: null,
        }));
      }
      return Promise.resolve(
        resolve({ data: this.pending ? null : [], error: null }),
      );
    }
  }
  const client = {
    rpc(fn: string) {
      if (fn === "ensure_source_refund_attempt") {
        return Promise.resolve({
          data: {
            attempt_no: 1,
            idempotency_key: "source_refund_buyer:ticket-refund:1",
            merchant_note: persistedMerchantNote,
            provider_operation_id: "ticket-provider-refund",
            reconcile_only: true,
          },
          error: null,
        });
      }
      if (fn === "record_source_refund_provider_event") {
        return Promise.resolve({
          data: { source_refund_event_id: 41, attention_generation: 0 },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
    from(table: string) {
      return new Query(table);
    },
  };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.includes("/transaction/verify/ticket-transaction")) {
      return json({
        status: true,
        data: {
          id: 2079101,
          reference: "ticket-transaction",
          status: "success",
          currency: "NGN",
          amount: 10000,
        },
      });
    }
    assertStringIncludes(url, "/refund?transaction=2079101&perPage=100");
    return json({
      status: true,
      data: [{
        id: "ticket-provider-refund",
        merchant_note: persistedMerchantNote,
        amount: 10000,
        status: "processed",
        transaction: 2079101,
      }],
    });
  }) as typeof fetch;

  try {
    await runSourceRefundOperation(client, {
      id: "ticket-refund",
      source_type: "ticket_checkout_session",
      source_id: "ticket-session",
      subject_id: "ticket-session",
      brand_id: "ticket-brand",
      provider: "paystack",
      currency: "NGN",
      original_charge_cents: 10000,
      original_application_fee_cents: 0,
      buyer_refund_requested_cents: 10000,
      fee_reversal_required_cents: 0,
      buyer_state: "queued",
      fee_state: "not_required",
      active_buyer_attempt_no: 1,
      active_fee_attempt_no: 0,
      provider_payment_reference: "ticket-transaction",
      paystack_transaction_id: 2079101,
      provider_account_reference: null,
      stripe_application_fee_id: null,
      provider_refund_id: null,
      refund_kind: "late_payment_no_value",
      ...overrides,
    } satisfies SourceRefundOperation);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
  return { outbox, deliveries };
}

function outboxMessage(
  rows: Array<Record<string, unknown>>,
  category: string,
  channel: string,
): string | undefined {
  const row = rows.find((entry) =>
    entry.category_key === category && entry.channel === channel
  );
  return (row?.payload as Record<string, unknown> | undefined)?.message as
    | string
    | undefined;
}

Deno.test("ticket checkout refund tells the buyer and the brand why the payment came back", async () => {
  const { outbox } = await runTicketRefundNotices();
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "NGN",
  }).format(100);
  const buyer =
    `We couldn't confirm your ticket, so your payment of ${amount} has been refunded in full.`;
  const brand =
    `Event ticket payment: A ticket couldn't be confirmed, so the buyer's payment of ${amount} has been refunded in full.`;
  assertEquals(
    outboxMessage(outbox, "source_refund_buyer_state", "email"),
    buyer,
  );
  assertEquals(outboxMessage(outbox, "source_refund_buyer_state", "sms"), buyer);
  for (const channel of ["inapp", "push", "email", "sms"]) {
    assertEquals(
      outboxMessage(outbox, "source_refund_brand_state", channel),
      brand,
    );
  }
  assert(outbox.every((row) => row.contact === null));
});

Deno.test("ticket checkout refund notice is fingerprinted for the contact the resolver reads", async () => {
  const keys = readSourceRefundRecipientKeys(testSecurityBundle());
  const fingerprintFor = (channel: "email" | "sms", recipient: string) =>
    sourceRefundRecipientFingerprint({ key: keys.current, channel, recipient });
  const delivery = (
    rows: Array<Record<string, unknown>>,
    channel: string,
  ) =>
    rows.find((row) =>
      String(row.idempotency_key).endsWith(`:buyer:${channel}:contact`)
    );

  const session = await runTicketRefundNotices();
  assertEquals(
    delivery(session.deliveries, "email")?.recipient_fingerprint,
    await fingerprintFor("email", "buyer@example.com"),
  );
  assertEquals(
    delivery(session.deliveries, "sms")?.recipient_fingerprint,
    await fingerprintFor("sms", "+15555550101"),
  );

  const corrected = await runTicketRefundNotices({
    attention_recipient_email_override: "fixed@example.com",
    attention_recipient_phone_e164_override: "+15555550199",
  });
  assertEquals(
    delivery(corrected.deliveries, "email")?.recipient_fingerprint,
    await fingerprintFor("email", "fixed@example.com"),
  );
  assertEquals(
    delivery(corrected.deliveries, "sms")?.recipient_fingerprint,
    await fingerprintFor("sms", "+15555550199"),
  );
});

Deno.test("refund notice copy is honest per state and unchanged for other refunds", () => {
  const ticket = (state: string, fullRefund = true) =>
    sourceRefundNoticeCopy({
      state,
      amountLabel: "$3.00",
      sourceLabel: "Event ticket payment",
      sourceType: "ticket_checkout_session",
      refundKind: "late_payment_no_value",
      fullRefund,
    });
  assertEquals(
    ticket("queued").buyer,
    "We couldn't confirm your ticket, so we're refunding your payment of $3.00 in full.",
  );
  assertEquals(
    ticket("provider_pending").brand,
    "Event ticket payment: A ticket couldn't be confirmed, so the buyer's payment of $3.00 is being refunded in full.",
  );
  assertEquals(
    ticket("processed", false).buyer,
    "We couldn't confirm your ticket, so $3.00 of your payment has been refunded.",
  );
  assertEquals(
    ticket("failed_terminal").buyer,
    "We couldn't confirm your ticket. Your $3.00 refund needs support review.",
  );

  const venue = sourceRefundNoticeCopy({
    state: "processed",
    amountLabel: "$3.00",
    sourceLabel: "Venue order",
    sourceType: "venue_menu_order",
    refundKind: "venue_order_guest_cancel",
    fullRefund: true,
  });
  assertEquals(venue.buyer, "Your $3.00 refund has been processed.");
  assertEquals(venue.brand, "Venue order: Your $3.00 refund has been processed.");
  // Another ticket refund kind keeps the generic wording.
  assertEquals(
    sourceRefundNoticeCopy({
      state: "processed",
      amountLabel: "$3.00",
      sourceLabel: "Event ticket payment",
      sourceType: "ticket_checkout_session",
      refundKind: "event_cancel",
      fullRefund: true,
    }).buyer,
    "Your $3.00 refund has been processed.",
  );
});
