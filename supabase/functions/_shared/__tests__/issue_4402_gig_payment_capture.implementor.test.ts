// #4402 — the creator-hire capture core: reference parser, ledger checks,
// replay, late capture, provider probe and the mismatch alert recipients.
//
// MINGLA-INVARIANT: I-4402-D | issue #4402 | a gig capture verifies amount, currency, contract and terms version against the ledger row before marking captured
//
// fails-on-revert: deleting the amount or currency check in verifyAndMark
// lets the mismatch cases call markCaptured (the store spy then records a
// capture and the "never marks" assertions fail). Removing the module fails
// every test at import.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  captureGigPaystackCharge,
  captureGigStripeIntent,
  gigAlertRecipients,
  gigCaptureErrorReason,
  type GigCaptureStore,
  type GigLedgerRow,
  gigPaystackReference,
  notifyGigPaymentMismatch,
  parseGigReference,
  probeGigPayment,
} from "../gigPaymentCapture.ts";
import { gigPaystackInitialize, gigRefund, quoteGig } from "../gigMoney.ts";

const CONTRACT = "6de5eb40-8f30-444e-83b8-d80fa32b3798";
const REF = "ghold_6de5eb408f30444e83b8d80fa32b3798_v1";

function store(
  row: GigLedgerRow | null,
  mark: { replayed: boolean; lateCapture: boolean } | Error = {
    replayed: false,
    lateCapture: false,
  },
): GigCaptureStore & { marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    loadLedger: () => Promise.resolve(row),
    markCaptured: (kind, contractId, termsVersion, ref) => {
      marks.push(`${kind}:${contractId}:${termsVersion}:${ref}`);
      return mark instanceof Error
        ? Promise.reject(mark)
        : Promise.resolve(mark);
    },
  };
}
const hold = (over: Partial<GigLedgerRow> = {}): GigLedgerRow => ({
  amountMinor: 11500,
  currency: "NGN",
  rail: "paystack",
  status: "pending",
  providerRef: null,
  ...over,
});
const txn = (over: Record<string, unknown> = {}) => ({
  status: "success",
  amount: 11500,
  currency: "NGN",
  metadata: {
    mingla_kind: "gig_hold",
    contract_id: CONTRACT,
    terms_version: 1,
  },
  ...over,
});

Deno.test("#4402 parser accepts exactly the deterministic gig references", () => {
  assertEquals(parseGigReference(REF), {
    kind: "gig_hold",
    contractId: CONTRACT,
    termsVersion: 1,
  });
  assertEquals(
    parseGigReference("gtop_6de5eb408f30444e83b8d80fa32b3798_v12")?.kind,
    "gig_topup",
  );
  for (
    const bad of [
      "mingla_vo_6de5eb408f30444e83b8d80fa32b3798",
      "GHOLD_6de5eb408f30444e83b8d80fa32b3798_v1",
      "ghold_6DE5EB408F30444E83B8D80FA32B3798_v1",
      `ghold_${CONTRACT}_v1`,
      "ghold_6de5eb408f30444e83b8d80fa32b3798_v0",
      "ghold_6de5eb408f30444e83b8d80fa32b3798_v1x",
      "ghold_6de5eb408f30444e83b8d80fa32b3798_v1234567",
      "",
    ]
  ) assertEquals(parseGigReference(bad), null, bad);
});

Deno.test("#4402 the derived reference is the one Paystack was initialized with", () => {
  const init = gigPaystackInitialize({
    contractId: CONTRACT,
    termsVersion: 1,
    quote: quoteGig(10000, "NGN"),
    email: "host@example.com",
  });
  assertEquals(gigPaystackReference("gig_hold", CONTRACT, 1), init.reference);
  assertEquals(init.reference, REF);
});

Deno.test("#4402 a matching verified charge is captured once and replays", async () => {
  const s = store(hold());
  assertEquals(
    (await captureGigPaystackCharge(s, REF, txn())).status,
    "captured",
  );
  assertEquals(s.marks, [`gig_hold:${CONTRACT}:1:${REF}`]);
  const replay = store(hold(), { replayed: true, lateCapture: false });
  assertEquals(
    (await captureGigPaystackCharge(replay, REF, txn())).status,
    "replayed",
  );
});

Deno.test("#4402 metadata given as a JSON string is still checked", async () => {
  const s = store(hold());
  const outcome = await captureGigPaystackCharge(
    s,
    REF,
    txn({
      metadata: JSON.stringify({
        mingla_kind: "gig_hold",
        contract_id: CONTRACT,
        terms_version: 1,
      }),
    }),
  );
  assertEquals(outcome.status, "captured");
});

Deno.test("#4402 amount, currency, metadata and rail mismatches never mark captured", async () => {
  const cases: Array<[string, GigLedgerRow | null, Record<string, unknown>]> = [
    ["amount_mismatch", hold(), txn({ amount: 11400 })],
    ["currency_mismatch", hold(), txn({ currency: "USD" })],
    ["currency_mismatch", hold({ currency: "USD" }), txn({ currency: "USD" })],
    [
      "metadata_mismatch",
      hold(),
      txn({
        metadata: {
          mingla_kind: "gig_topup",
          contract_id: CONTRACT,
          terms_version: 1,
        },
      }),
    ],
    [
      "metadata_mismatch",
      hold(),
      txn({
        metadata: {
          mingla_kind: "gig_hold",
          contract_id: CONTRACT,
          terms_version: 2,
        },
      }),
    ],
    ["metadata_mismatch", hold(), txn({ metadata: {} })],
    ["rail_mismatch", hold({ rail: "stripe" }), txn()],
    ["ledger_row_missing", null, txn()],
  ];
  for (const [reason, row, verified] of cases) {
    const s = store(row);
    const outcome = await captureGigPaystackCharge(s, REF, verified);
    assertEquals(outcome.status, "mismatch", reason);
    assertEquals(outcome.status === "mismatch" ? outcome.reason : null, reason);
    assertEquals(s.marks.length, 0, `${reason} must never mark captured`);
  }
});

Deno.test("#4402 recorder refusals become mismatches; transient errors throw", async () => {
  const refused = store(hold(), new Error("hold_provider_mismatch"));
  const outcome = await captureGigPaystackCharge(refused, REF, txn());
  assertEquals(
    outcome.status === "mismatch" ? outcome.reason : outcome.status,
    "provider_ref_mismatch",
  );
  assertEquals(gigCaptureErrorReason("hold_not_pending"), "hold_not_pending");
  assertEquals(gigCaptureErrorReason("connection reset"), null);
  await assertRejects(() =>
    captureGigPaystackCharge(
      store(hold(), new Error("connection reset")),
      REF,
      txn(),
    )
  );
});

Deno.test("#4402 a late payment on a retired offer is flagged for a full refund", async () => {
  const late = store(hold({ status: "failed" }), {
    replayed: false,
    lateCapture: true,
  });
  assertEquals(
    (await captureGigPaystackCharge(late, REF, txn())).status,
    "late_capture_refund_due",
  );
  assertEquals(
    gigRefund({
      branch: "payment_late",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
    }),
    { hostRefundMinor: 11500, creatorFeeMinor: 0 },
  );
});

Deno.test("#4402 an unsuccessful Paystack status is reported, never captured", async () => {
  const s = store(hold());
  assertEquals(
    (await captureGigPaystackCharge(s, REF, txn({ status: "abandoned" })))
      .status,
    "not_paid",
  );
  assertEquals(
    (await captureGigPaystackCharge(s, REF, txn({ status: "ongoing" }))).status,
    "pending",
  );
  assertEquals(s.marks.length, 0);
});

Deno.test("#4402 Stripe intents are checked against the hold the same way", async () => {
  const pi = {
    id: "pi_4402",
    status: "succeeded",
    amount: 11500,
    currency: "usd",
    metadata: {
      mingla_kind: "gig_hold",
      contract_id: CONTRACT,
      terms_version: "1",
    },
  };
  const row = hold({ rail: "stripe", currency: "USD" });
  const s = store(row);
  assertEquals((await captureGigStripeIntent(s, pi)).status, "captured");
  assertEquals(s.marks, [`gig_hold:${CONTRACT}:1:pi_4402`]);
  const short = store(row);
  assertEquals(
    (await captureGigStripeIntent(short, { ...pi, amount: 100 })).status,
    "mismatch",
  );
  assertEquals(short.marks.length, 0);
  assertEquals(
    (await captureGigStripeIntent(store(row), { ...pi, status: "processing" }))
      .status,
    "pending",
  );
  assertEquals(
    (await captureGigStripeIntent(store(row), {
      ...pi,
      status: "requires_payment_method",
    })).status,
    "not_paid",
  );
  assertEquals(
    (await captureGigStripeIntent(store(row), pi, {
      contractId: CONTRACT,
      termsVersion: 2,
    })).status,
    "mismatch",
  );
});

Deno.test("#4402 probe: a never-created Paystack charge proves unpaid; errors throw", async () => {
  const target = {
    kind: "gig_hold" as const,
    contractId: CONTRACT,
    termsVersion: 1,
    rail: "paystack" as const,
    reference: null,
  };
  const seen: string[] = [];
  const deps = (state: "not_found" | "pending" | "success" | "throw") => ({
    store: store(hold()),
    paystackVerifyOutcome: (reference: string) => {
      seen.push(reference);
      if (state === "throw") return Promise.reject(new Error("paystack down"));
      if (state === "success") return Promise.resolve({ state, txn: txn() });
      if (state === "pending") {
        return Promise.resolve({ state, txn: { status: "ongoing" } });
      }
      return Promise.resolve({ state });
    },
    stripeRetrieve: () => Promise.reject(new Error("unused")),
  });
  assertEquals(
    (await probeGigPayment(deps("not_found"), target)).status,
    "not_paid",
  );
  assertEquals(seen[0], REF);
  assertEquals(
    (await probeGigPayment(deps("pending"), target)).status,
    "pending",
  );
  assertEquals(
    (await probeGigPayment(deps("success"), target)).status,
    "captured",
  );
  await assertRejects(() => probeGigPayment(deps("throw"), target));
  const stripeNoIntent = await probeGigPayment(deps("not_found"), {
    ...target,
    rail: "stripe",
  });
  assertEquals(stripeNoIntent.status, "not_paid");
});

Deno.test("#4402 mismatch alerts go to the existing Stripe webhook failure list", async () => {
  const previousBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
  const previousLegacy = Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS");
  try {
    Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    Deno.env.set(
      "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS",
      "ops@example.com, seth@example.com",
    );
    assertEquals(gigAlertRecipients(), ["ops@example.com", "seth@example.com"]);
    const sent: Array<{ recipients: string[]; idempotencyKey?: string }> = [];
    const succeeded = await notifyGigPaymentMismatch(
      {
        rail: "paystack",
        source: "test",
        reference: REF,
        reason: "amount_mismatch",
        contractId: CONTRACT,
      },
      (input) => {
        sent.push({
          recipients: input.recipients,
          idempotencyKey: input.idempotencyKey,
        });
        return Promise.resolve({ attempted: 2, succeeded: 2, failed: 0 });
      },
    );
    assertEquals(succeeded, 2);
    assertEquals(sent[0].recipients, ["ops@example.com", "seth@example.com"]);
    assertEquals(sent[0].idempotencyKey, `gig_mismatch:${REF}:amount_mismatch`);
    // A failing sender never throws into the money path.
    assertEquals(
      await notifyGigPaymentMismatch(
        {
          rail: "stripe",
          source: "test",
          reference: "pi_x",
          reason: "amount_mismatch",
        },
        () => Promise.reject(new Error("resend down")),
      ),
      0,
    );
  } finally {
    if (previousBundle === undefined) {
      Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    } else Deno.env.set("MINGLA_ALERT_RECIPIENTS_JSON", previousBundle);
    if (previousLegacy === undefined) {
      Deno.env.delete("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS");
    } else Deno.env.set("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS", previousLegacy);
  }
});
