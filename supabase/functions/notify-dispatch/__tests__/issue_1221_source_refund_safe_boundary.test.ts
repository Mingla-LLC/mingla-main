import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dispatchSourceRefundChannel,
  sourceRefundResendIdempotencyKey,
} from "../../_shared/notifyV2.ts";

function client(events: string[]) {
  return {
    from(table: string) {
      if (table !== "notification_categories") {
        throw new Error(`unexpected_table:${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    key: "source_refund_buyer_state",
                    active: true,
                    default_channels: ["email"],
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
    async rpc(name: string) {
      events.push(name);
      if (name === "can_send") return { data: true, error: null };
      if (name === "mark_source_refund_notification_provider_io") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected_rpc:${name}`);
    },
  };
}

function input() {
  return {
    category_key: "source_refund_buyer_state",
    user_id: null,
    contact: "guest@example.com",
    payload: {
      state: "needs_attention",
      amount: "NGN 100.00",
      source_refund_id: "12210000-0000-4000-8000-000000000027",
    },
    idempotency_key: "source_refund:refund:event:3:buyer:email",
    requested_channel: "email" as const,
    delivery_id: "12210000-0000-4000-8000-000000000028",
    delivery_claim_id: "12210000-0000-4000-8000-000000000029",
    attention_url:
      "https://business.usemingla.com/refund/id/attention#attentionToken=secret",
  };
}

Deno.test("Source email marks provider I/O immediately before one Resend call and hashes its key", async () => {
  Deno.env.set("RESEND_API_KEY", "re_test_fixture");
  Deno.env.set("DENO_TESTING", "1");
  const events: string[] = [];
  const originalFetch = globalThis.fetch;
  let capturedKey = "";
  globalThis.fetch = ((_request, init) => {
    events.push("provider_fetch");
    capturedKey = new Headers(
      (init as globalThis.RequestInit | undefined)?.headers,
    ).get("idempotency-key") ?? "";
    return Promise.resolve(Response.json({ id: "email_1221" }));
  }) as typeof fetch;
  try {
    const result = await dispatchSourceRefundChannel(
      client(events) as never,
      input(),
    );
    assertEquals(result.outcome, "accepted");
    assertEquals(events, [
      "can_send",
      "mark_source_refund_notification_provider_io",
      "provider_fetch",
    ]);
    assertMatch(
      capturedKey,
      /^source-refund-email\/[A-Za-z0-9_-]{43}$/,
    );
    assertEquals(
      capturedKey,
      await sourceRefundResendIdempotencyKey(input().idempotency_key),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Source provider config failure is retryable and occurs before I/O marking", async () => {
  Deno.env.set("DENO_TESTING", "1");
  Deno.env.delete("RESEND_API_KEY");
  const events: string[] = [];
  const result = await dispatchSourceRefundChannel(
    client(events) as never,
    input(),
  );
  assertEquals(result, {
    success: false,
    outcome: "definitive_unsent_retryable",
    providerMessageId: null,
    safeCode: "provider_config_missing",
  });
  assertEquals(events, ["can_send"]);
});

Deno.test("Source Resend retry preserves exact provider bytes and identity headers", async () => {
  Deno.env.set("RESEND_API_KEY", "re_test_fixture");
  Deno.env.set("DENO_TESTING", "1");
  const captures: Array<{ body: string; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_request, init) => {
    const headers = new Headers(
      (init as globalThis.RequestInit | undefined)?.headers,
    );
    captures.push({
      body: String((init as globalThis.RequestInit | undefined)?.body ?? ""),
      headers: {
        contentType: headers.get("content-type") ?? "",
        idempotencyKey: headers.get("idempotency-key") ?? "",
      },
    });
    return Promise.resolve(Response.json({ id: `email_${captures.length}` }));
  }) as typeof fetch;
  try {
    const oldWorkerInput = input();
    const newWorkerInput = JSON.parse(
      JSON.stringify(oldWorkerInput),
    ) as ReturnType<typeof input>;
    await dispatchSourceRefundChannel(client([]) as never, oldWorkerInput);
    await dispatchSourceRefundChannel(client([]) as never, newWorkerInput);
    assertEquals(captures.length, 2);
    assertEquals(captures[0], captures[1]);
    assertEquals(
      captures[0].headers.idempotencyKey,
      await sourceRefundResendIdempotencyKey(oldWorkerInput.idempotency_key),
    );
    assertEquals(
      captures[0].body.includes("guest@example.com"),
      true,
    );
    assertEquals(
      captures[0].body.includes("attentionToken=secret"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
