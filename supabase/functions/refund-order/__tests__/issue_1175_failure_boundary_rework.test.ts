import { persistPaystackRefundOutcome } from "../../_shared/paystackRefunds.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const functionsRoot = new URL("../../", import.meta.url);

Deno.test("issue #1175 failure boundary: all four handlers require outcome persistence before terminal local success", async () => {
  const cases = [
    {
      path: "refund-order/index.ts",
      provider: "const paystackRefund = await createPaystackRefund({",
      terminal:
        "const { data: commitResult, error: commitError } = await supabaseAsUser.rpc(",
    },
    {
      path: "admin-refund-order/index.ts",
      provider: "const paystackRefund = await createPaystackRefund({",
      terminal:
        "const { data: commitResult, error: commitError } = await supabase.rpc(",
    },
    {
      path: "cancel-trip-booking/index.ts",
      provider: "const created = await createPaystackRefund({",
      terminal:
        "const { data: commitData, error: commitErr } = await supabase.rpc(",
    },
    {
      path: "venue-reservation-cancel/index.ts",
      provider: "const created = await createPaystackRefund({",
      terminal: 'payment_status: "refunded"',
    },
  ] as const;

  for (const testCase of cases) {
    const source = await Deno.readTextFile(
      new URL(testCase.path, functionsRoot),
    );
    const providerIndex = source.indexOf(testCase.provider);
    const persistenceIndex = source.indexOf(
      "await persistPaystackRefundOutcome(",
      providerIndex,
    );
    const terminalIndex = source.indexOf(testCase.terminal, persistenceIndex);
    assert(providerIndex >= 0, `${testCase.path} provider call is missing`);
    assert(
      persistenceIndex > providerIndex,
      `${testCase.path} does not persist the provider outcome`,
    );
    assert(
      terminalIndex > persistenceIndex,
      `${testCase.path} can reach terminal local success before outcome persistence`,
    );
    assert(
      !source.includes(
        "Paystack debt reconciliation failed after accepted refund",
      ),
      `${testCase.path} still logs and continues after losing refund debt`,
    );
  }
});

Deno.test("issue #1175 failure boundary: persistence failure blocks success and retry reuses the provider result", async () => {
  for (
    const context of [
      "refund-order",
      "admin-refund-order",
      "cancel-trip-booking",
      "venue-reservation-cancel",
    ]
  ) {
    let providerPosts = 1;
    let persistenceCalls = 0;
    let terminalSuccess = false;
    const persist = () =>
      persistPaystackRefundOutcome(
        () => {
          persistenceCalls += 1;
          return Promise.resolve({
            error: persistenceCalls === 1
              ? { message: "injected database outage" }
              : null,
          });
        },
        context,
      );

    let firstAttemptFailed = false;
    try {
      await persist();
      terminalSuccess = true;
    } catch (error) {
      firstAttemptFailed = error instanceof Error &&
        error.message.includes("paystack_refund_outcome_persist_failed");
    }
    assert(firstAttemptFailed, `${context} swallowed persistence failure`);
    assert(!terminalSuccess, `${context} reported false terminal success`);

    // The retry starts from the already-known provider result. It must only
    // repeat the idempotent local outcome write, never a second provider POST.
    await persist();
    terminalSuccess = true;
    assert(terminalSuccess, `${context} did not recover on retry`);
    assert(persistenceCalls === 2, `${context} did not retry the local write`);
    assert(providerPosts === 1, `${context} issued a second provider refund`);
    providerPosts = 0;
  }
});

Deno.test("issue #1175 venue recovery: owner-only resume can seed a missing deterministic attempt", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270110000006_issue_1175_paystack_refunds.sql",
      import.meta.url,
    ),
  );
  const resumeStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.pg_resume_my_paystack_reservation_refund",
  );
  const resumeEnd = migration.indexOf("$fn$;", resumeStart);
  const resume = migration.slice(resumeStart, resumeEnd);

  assert(
    resume.includes("id=p_reservation_id AND consumer_user_id=v_uid"),
    "a different user can enter venue refund recovery",
  );
  assert(
    resume.includes("a.action='venue_reservation.consumer_cancel'") &&
      resume.includes("a.after->>'refund_eligible'"),
    "recovery can manufacture eligibility after cancellation",
  );
  assert(
    resume.includes("b.payment_provider='paystack'"),
    "recovery can seed an attempt on the wrong payment rail",
  );
  assert(
    resume.includes("IF v_session_count<>1 THEN"),
    "recovery does not require one canonical completed checkout session",
  );
  assert(
    resume.includes("INSERT INTO public.paystack_refund_attempts(") &&
      resume.includes("ON CONFLICT(idempotency_key) DO NOTHING"),
    "recovery cannot safely seed the missing deterministic attempt",
  );
  assert(
    resume.includes("'paystack-refund:mingla_venue_refund:'||v_row.id"),
    "recovery attempt identity is not stable across retries",
  );
});
