import { runIssue2979RecoveryWhenGoverned, sendEmail } from "../index.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2979 recovery drains only its exact ledger with governed proofs", () => {
  const start = source.indexOf('body.mode === "issue_2979_recovery"');
  const end = source.indexOf("const orderPepper", start);
  const recovery = source.slice(start, end);
  assert(start > 0 && end > start, "explicit recovery branch");
  assert(
    recovery.includes("claim_issue_2979_attendance_claim_recovery_batch"),
    "exact batch",
  );
  assert(
    recovery.includes("preview_issue_2979_attendance_claim_recovery"),
    "legacy continuity preflight",
  );
  assert(
    recovery.includes("recovery_temporarily_unavailable"),
    "missing legacy reader fails closed",
  );
  assert(
    recovery.indexOf("runIssue2979RecoveryWhenGoverned") <
      recovery.indexOf("createClient"),
    "governed gate precedes recovery client and RPC work",
  );
  assert(
    !recovery.includes("enqueue_attendance_claim_deliveries"),
    "no broad enqueue",
  );
  assert(
    recovery.includes("issue_order_attendance_claim_proof_v2"),
    "governed issuance",
  );
  assert(
    recovery.includes("pepperRing.current.generation"),
    "generation label",
  );
  assert(
    recovery.includes("complete_issue_2979_attendance_claim_delivery"),
    "monotonic completion",
  );
  assert(
    recovery.includes("mark_issue_2979_attendance_claim_provider_attempt"),
    "durable provider boundary",
  );
  assert(
    recovery.includes("beforeProviderIo"),
    "mark runs before provider I/O",
  );
  assert(
    recovery.includes("retryOnNetworkAmbiguity: false"),
    "recovery email is one-shot on network ambiguity",
  );
  assert(
    (recovery.match(/mintOrderClaimToken\(\)/g) ?? []).length === 1 &&
      (recovery.match(/issue_order_attendance_claim_proof_v2/g) ?? [])
          .length ===
        1,
    "one governed proof is preserved across recovery delivery",
  );
});

Deno.test("#2979 direct-only recovery performs zero recovery work", async () => {
  const calls = { lease: 0, issuance: 0, provider: 0 };
  const gated = await runIssue2979RecoveryWhenGoverned(
    {
      current: { generation: "legacy_v1", secret: "direct-fixture" },
      previous: null,
    },
    async () => {
      calls.lease += 1;
      calls.issuance += 1;
      calls.provider += 1;
      return "unexpected";
    },
  );
  assert(!gated.allowed, "direct-only mode is refused");
  assert(
    calls.lease === 0 && calls.issuance === 0 && calls.provider === 0,
    "no lease, issuance, or provider work ran",
  );
});

Deno.test("#2979 recovery email ambiguity is one-shot", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = Deno.env.get("RESEND_API_KEY");
  let providerCalls = 0;
  let durableBoundaries = 0;
  const idempotencyKeys: string[] = [];
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    const headers = new Headers(init?.headers);
    idempotencyKeys.push(headers.get("idempotency-key") ?? "");
    return Promise.reject(new TypeError("ambiguous network result"));
  }) as typeof fetch;
  Deno.env.set("RESEND_API_KEY", "issue-2979-test-fixture");
  try {
    const result = await sendEmail({
      to: "buyer@example.test",
      eventTitle: "Recovery fixture",
      claimUrl: "https://example.test/claim#fixture",
      deliveryKey: "issue-2979-delivery-fixture",
      retryOnNetworkAmbiguity: false,
      beforeProviderIo: async () => {
        durableBoundaries += 1;
      },
    });
    assert(result === "ambiguous", "network ambiguity is preserved");
    assert(providerCalls === 1, "recovery makes one provider call");
    assert(durableBoundaries === 1, "one durable provider boundary is marked");
    assert(
      idempotencyKeys[0] === "issue-2979-delivery-fixture",
      "the governed delivery identity is preserved",
    );

    providerCalls = 0;
    durableBoundaries = 0;
    idempotencyKeys.length = 0;
    const generalResult = await sendEmail({
      to: "buyer@example.test",
      eventTitle: "General backfill fixture",
      claimUrl: "https://example.test/claim#fixture",
      deliveryKey: "general-delivery-fixture",
      beforeProviderIo: async () => {
        durableBoundaries += 1;
      },
    });
    assert(generalResult === "ambiguous", "general ambiguity is preserved");
    assert(providerCalls === 2, "general backfill retains its bounded retry");
    assert(durableBoundaries === 2, "each general provider call is marked");
    assert(
      idempotencyKeys.every((key) => key === "general-delivery-fixture"),
      "general retry retains one delivery identity",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", previousApiKey);
  }
});

Deno.test("#2979 secondary delivery uses the approved copy and adapter", () => {
  assert(source.includes("smsAdapter.send({"), "shared SMS adapter");
  assert(
    source.includes(
      '"Your tickets are confirmed. You can open the app and sign in with your "',
    ),
    "approved sentence",
  );
  assert(
    source.includes("checkout email or phone. ${claimWebUrl}"),
    "approved ending and same link",
  );
});
