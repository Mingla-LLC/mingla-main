// #4402 — Paystack charge.success for a creator hire is captured by the
// webhook, never filed as an orphan reference (the live TEST hire on 12 Nov
// was charged ₦115 and dropped as `paystack.charge_orphan_reference`).
//
// MINGLA-INVARIANT: I-4402-A | issue #4402 | every Paystack charge.success whose reference starts with ghold_ or gtop_ is captured or flagged mismatched and never reaches charge_orphan_reference
//
// fails-on-revert: deleting the gig arm in handlePaystackChargeSuccess sends a
// `ghold_` reference down the contribution / session lookups to the orphan
// path: the status becomes "orphan", the audit is charge_orphan_reference and
// the store spy is never called.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePaystackChargeSuccess } from "../../_shared/paystackWebhookRouter.ts";
import type {
  GigCaptureStore,
  GigMismatchAlertInput,
} from "../../_shared/gigPaymentCapture.ts";

const CONTRACT = "6de5eb40-8f30-444e-83b8-d80fa32b3798";
const REF = "ghold_6de5eb408f30444e83b8d80fa32b3798_v1";
const TOPUP_REF = "gtop_6de5eb408f30444e83b8d80fa32b3798_v2";

/** Every query resolves empty; audit inserts are recorded. */
function fakeDb(audits: string[]) {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, prop) {
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve({ data: null, error: null });
      }
      if (prop === "then") {
        return (resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null });
      }
      return () => chain;
    },
  });
  return {
    from(table: string) {
      if (table === "audit_log") {
        return {
          insert(row: Record<string, unknown>) {
            audits.push(String(row.action));
            return Promise.resolve({ error: null });
          },
        };
      }
      return chain;
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function gigStore(amount = 11500): GigCaptureStore & { marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    loadLedger: () =>
      Promise.resolve({
        amountMinor: amount,
        currency: "NGN",
        rail: "paystack",
        status: "pending",
        providerRef: null,
      }),
    markCaptured: (kind, contractId, termsVersion, ref) => {
      marks.push(`${kind}:${contractId}:${termsVersion}:${ref}`);
      return Promise.resolve({ replayed: false, lateCapture: false });
    },
  };
}

const verified =
  (reference: string, over: Record<string, unknown> = {}) => () =>
    Promise.resolve({
      status: "success",
      reference,
      amount: 11500,
      currency: "NGN",
      metadata: {
        mingla_kind: reference.startsWith("gtop_") ? "gig_topup" : "gig_hold",
        contract_id: CONTRACT,
        terms_version: reference.startsWith("gtop_") ? 2 : 1,
      },
      ...over,
    });

Deno.test("#4402 a ghold_ charge is captured by the webhook, never an orphan", async () => {
  const audits: string[] = [];
  const store = gigStore();
  const result = await handlePaystackChargeSuccess(
    fakeDb(audits) as never,
    { reference: REF },
    verified(REF),
    {},
    { store },
  );
  assertEquals(result.status, "gig_captured");
  assertEquals(store.marks, [`gig_hold:${CONTRACT}:1:${REF}`]);
  assertEquals(audits.includes("paystack.charge_orphan_reference"), false);
  assertEquals(audits, ["gig.payment_captured"]);
});

Deno.test("#4402 a gtop_ top-up charge is captured through the top-up recorder", async () => {
  const store = gigStore();
  const result = await handlePaystackChargeSuccess(
    fakeDb([]) as never,
    { reference: TOPUP_REF },
    verified(TOPUP_REF),
    {},
    { store },
  );
  assertEquals(result.status, "gig_captured");
  assertEquals(store.marks, [`gig_topup:${CONTRACT}:2:${TOPUP_REF}`]);
});

Deno.test("#4402 a gig charge that does not match the ledger is flagged and alerted", async () => {
  const audits: string[] = [];
  const alerts: GigMismatchAlertInput[] = [];
  const store = gigStore(99999);
  const result = await handlePaystackChargeSuccess(
    fakeDb(audits) as never,
    { reference: REF },
    verified(REF),
    {},
    {
      store,
      notifyMismatch: (input) => (alerts.push(input), Promise.resolve(1)),
    },
  );
  assertEquals(result.status, "gig_mismatch");
  assertEquals(result.gigMismatchReason, "amount_mismatch");
  assertEquals(store.marks.length, 0);
  assertEquals(audits, ["gig.payment_capture_mismatch"]);
  assertEquals(alerts.map((a) => [a.rail, a.reason, a.reference]), [[
    "paystack",
    "amount_mismatch",
    REF,
  ]]);
});

Deno.test("#4402 a malformed gig-prefixed reference is flagged, not an orphan", async () => {
  const audits: string[] = [];
  const alerts: GigMismatchAlertInput[] = [];
  const bad = "ghold_not-a-contract_v1";
  const result = await handlePaystackChargeSuccess(
    fakeDb(audits) as never,
    { reference: bad },
    verified(bad),
    {},
    {
      store: gigStore(),
      notifyMismatch: (input) => (alerts.push(input), Promise.resolve(1)),
    },
  );
  assertEquals(result.status, "gig_mismatch");
  assertEquals(result.gigMismatchReason, "reference_invalid");
  assertEquals(audits.includes("paystack.charge_orphan_reference"), false);
  assertEquals(alerts.length, 1);
});

Deno.test("#4402 a late payment asks gig-refund for the payment_late refund", async () => {
  const refunds: string[] = [];
  const store: GigCaptureStore = {
    loadLedger: () =>
      Promise.resolve({
        amountMinor: 11500,
        currency: "NGN",
        rail: "paystack",
        status: "failed",
        providerRef: null,
      }),
    markCaptured: () => Promise.resolve({ replayed: false, lateCapture: true }),
  };
  const audits: string[] = [];
  const result = await handlePaystackChargeSuccess(
    fakeDb(audits) as never,
    { reference: REF },
    verified(REF),
    {},
    {
      store,
      requestLateRefund: (
        id,
      ) => (refunds.push(id), Promise.resolve({ ok: true })),
    },
  );
  assertEquals(result.status, "gig_late_refund_due");
  assertEquals(refunds, [CONTRACT]);
  assertEquals(audits, ["gig.payment_late_refund_due"]);
});

Deno.test("#4402 a non-gig unknown reference still reaches the orphan path, store untouched", async () => {
  const audits: string[] = [];
  const store = gigStore();
  const result = await handlePaystackChargeSuccess(
    fakeDb(audits) as never,
    { reference: "T-not-a-gig-123" },
    () => Promise.resolve({ status: "success", amount: 100, currency: "NGN" }),
    {},
    { store },
  );
  assertEquals(result.status, "orphan");
  assertEquals(store.marks.length, 0);
  assertEquals(audits.includes("paystack.charge_orphan_reference"), true);
});
