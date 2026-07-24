import {
  createPaystackRefund,
  paystackRefundOutcomeStatus,
  persistPaystackRefundOutcome,
} from "../../_shared/paystackRefunds.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

async function proveFullRefundPersistenceRecovery(
  surface: "buyer" | "admin",
): Promise<void> {
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set(
    "PAYSTACK_SECRET_KEY_TEST",
    ["sk", "test", "issue1175manifest"].join("_"),
  );

  const refundId = surface === "buyer"
    ? "71111111-1111-4111-8111-111111111111"
    : "72222222-2222-4222-8222-222222222222";
  const merchantNote = surface === "buyer"
    ? `mingla_refund:${refundId}`
    : `mingla_admin_refund:${refundId}`;
  const transaction = `txn-1175-manifest-${surface}`;
  const postBodies: Array<Record<string, unknown>> = [];
  let outcomeWrites = 0;
  const localState = { terminalCommits: 0 };
  let providerVisible = false;
  const firstManifest = { is_full_refund: true, amount_cents: 50_000 };
  const replayManifest = { is_full_refund: true, amount_cents: 50_000 };

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve(response({
        status: true,
        data: providerVisible
          ? [{
            id: `${surface}-refund-provider-id`,
            amount: 0,
            status: "processed",
            merchant_note: merchantNote,
          }]
          : [],
      }));
    }

    postBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    providerVisible = true;
    return Promise.resolve(
      response({ status: false, message: "transaction_reversed" }, 400),
    );
  }) as typeof fetch;

  const run = async (
    replayManifest: { is_full_refund: boolean; amount_cents: number },
  ): Promise<void> => {
    // This is the production adapter call used by both order handlers. The
    // replay manifest supplies the same stored full-refund truth each time.
    const providerResult = await createPaystackRefund({
      transaction,
      merchantNote,
      amountSubunits: replayManifest.is_full_refund
        ? undefined
        : replayManifest.amount_cents,
      currency: "NGN",
    });
    await persistPaystackRefundOutcome(
      () => {
        outcomeWrites += 1;
        return Promise.resolve({
          error: outcomeWrites === 1
            ? { message: "injected database outage" }
            : null,
        });
      },
      `${surface}-immutable-manifest`,
    );
    assert(
      paystackRefundOutcomeStatus(providerResult.status) === "processed",
      `${surface} retry did not preserve the processed provider outcome`,
    );
    localState.terminalCommits += 1;
  };

  try {
    let firstFailed = false;
    try {
      await run(firstManifest);
    } catch (error) {
      firstFailed = error instanceof Error &&
        error.message.includes("paystack_refund_outcome_persist_failed");
    }
    assert(firstFailed, `${surface} swallowed the injected persistence error`);
    assert(
      localState.terminalCommits === 0,
      `${surface} committed local success before outcome persistence`,
    );

    await run(replayManifest);
    assert(
      Number(localState.terminalCommits) === 1,
      `${surface} did not commit exactly once after persistence recovered`,
    );
    assert(
      postBodies.length === 1,
      `${surface} issued a second provider POST on exact replay`,
    );
    assert(
      !Object.hasOwn(postBodies[0], "amount"),
      `${surface} full-refund POST unexpectedly included amount`,
    );
    assert(
      postBodies[0].merchant_note === merchantNote,
      `${surface} changed its immutable merchant note`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("issue #1175 immutable manifest runtime: buyer full replay persists locally without a second POST", async () => {
  await proveFullRefundPersistenceRecovery("buyer");
});

Deno.test("issue #1175 immutable manifest runtime: admin full replay persists locally without a second POST", async () => {
  await proveFullRefundPersistenceRecovery("admin");
});

Deno.test("issue #1175 immutable manifest contract: exact replay, auth-first disclosure, and 409 mismatch are wired", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270110000006_issue_1175_paystack_refunds.sql",
      import.meta.url,
    ),
  );
  const buyerStart = migration.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.biz_refund_order(",
  );
  const adminStart = migration.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.admin_refund_order(",
  );
  const buyer = migration.slice(buyerStart, adminStart);
  const admin = migration.slice(adminStart);
  const refundHandler = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const adminHandler = await Deno.readTextFile(
    new URL("../../admin-refund-order/index.ts", import.meta.url),
  );

  for (const [name, definition] of [["buyer", buyer], ["admin", admin]]) {
    assert(
      definition.includes("'refund_request_manifest'"),
      `${name} does not persist the first request manifest`,
    );
    assert(
      definition.includes(
        "v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines",
      ) &&
        definition.includes(
          "v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason)",
        ),
      `${name} does not reject line/reason mismatch`,
    );
    assert(
      definition.includes("RAISE EXCEPTION 'idempotency_request_mismatch'"),
      `${name} lacks the deterministic mismatch error`,
    );
    assert(
      definition.includes(
        "(v_stored_manifest->>'is_full_refund')::boolean",
      ) &&
        !definition.includes("'is_full_refund', false"),
      `${name} fabricates full-refund replay truth`,
    );
  }

  assert(
    buyer.indexOf("public.biz_can_manage_payments_for_brand") <
      buyer.indexOf("WHERE metadata->>'idempotency_key'"),
    "buyer replay lookup occurs before brand authorization",
  );
  assert(
    admin.indexOf("IF auth.uid() IS NOT NULL AND NOT public.is_admin_user()") <
      admin.indexOf("SELECT * INTO v_order"),
    "admin guard is not the first executable statement",
  );
  for (
    const [name, handler] of [
      ["buyer", refundHandler],
      ["admin", adminHandler],
    ]
  ) {
    assert(
      handler.includes('msg.includes("idempotency_request_mismatch")') &&
        handler.includes('code: "idempotency_request_mismatch"') &&
        handler.includes("status: 409"),
      `${name} handler does not map request mismatch to HTTP 409`,
    );
  }
});
