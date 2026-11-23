// Issue #3645 (18 Nov payments audit, item 10) — a Stripe `payout.canceled`
// for a Mingla release used to be written `failed` with a direct UPDATE, which
// skipped the alert outbox: nobody was told the host's money was back in
// their Stripe balance. It now goes through the same terminal reconcile as a
// non-retryable `payout.failed` (`record_stripe_payout_webhook_failure` with
// p_retryable_kyc=false), which writes `failed` AND queues the ops alert in
// one transaction (migration 20270110000002). That RPC files it under the
// `stripe_attempt_cap` outbox kind, so the sweep renders it with its own
// words instead of "exhausted 10 definitive payout attempts".
//
// Fails on revert: restoring the direct UPDATE records an update on
// brand_payout_releases and no reconcile RPC, so both assertions fail.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeStripeEvent } from "../stripeWebhookRouter.ts";
import {
  PAYOUT_REFUND_DEBT_OPENED_ERROR,
  PAYOUT_REFUND_SYNC_FAILED_ERROR,
  PAYOUT_REFUND_UNRECONCILED_ERROR,
  payoutReleaseAlertCopyFor,
  STRIPE_PAYOUT_CANCELED_ERROR,
} from "../../payout-release-sweep/index.ts";

type Rpc = { fn: string; args: Record<string, unknown> };

class FakeDb {
  rpcs: Rpc[] = [];
  updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  releaseIdForPayout: string | null = "release_1";
  rpcError: { message: string } | null = null;

  from(table: string) {
    const db = this;
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      is() {
        return builder;
      },
      in() {
        return builder;
      },
      upsert() {
        return Promise.resolve({ error: null });
      },
      insert() {
        return Promise.resolve({ error: null });
      },
      update(payload: Record<string, unknown>) {
        db.updates.push({ table, payload });
        return builder;
      },
      maybeSingle() {
        if (table === "stripe_connect_accounts") {
          return Promise.resolve({ data: { brand_id: "brand_1" }, error: null });
        }
        if (table === "brand_payout_releases") {
          return Promise.resolve({
            data: db.releaseIdForPayout === null
              ? null
              : { id: db.releaseIdForPayout },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (value: { data: unknown[]; error: null }) => void) {
        resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcs.push({ fn, args });
    if (fn === "record_stripe_payout_webhook_failure") {
      return Promise.resolve({
        data: this.rpcError
          ? null
          : { release_id: "release_1", status: "failed", mutated: true },
        error: this.rpcError,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }
}

function canceled(payoutId = "po_canceled") {
  return {
    id: "evt_canceled",
    type: "payout.canceled",
    account: "acct_1",
    data: {
      object: {
        id: payoutId,
        amount: 4_200,
        currency: "usd",
        status: "canceled",
      },
    },
  };
}

Deno.test("#3645 payout.canceled reconciles through the alerting RPC, not a direct update", async () => {
  const db = new FakeDb();
  await routeStripeEvent(db as never, {} as never, canceled() as never);
  const reconciles = db.rpcs.filter((call) =>
    call.fn === "record_stripe_payout_webhook_failure"
  );
  assertEquals(reconciles.length, 1);
  assertEquals(reconciles[0].args.p_payout_id, "po_canceled");
  assertEquals(reconciles[0].args.p_retryable_kyc, false);
  assertEquals(reconciles[0].args.p_error_message, "stripe_payout_canceled");
  assertEquals(typeof reconciles[0].args.p_now, "string");
  assertEquals(
    db.updates.filter((row) => row.table === "brand_payout_releases"),
    [],
  );
});

Deno.test("#3645 payout.canceled for a payout Mingla did not release changes no release", async () => {
  const db = new FakeDb();
  db.releaseIdForPayout = null;
  await routeStripeEvent(db as never, {} as never, canceled("po_auto") as never);
  assertEquals(
    db.rpcs.some((call) => call.fn === "record_stripe_payout_webhook_failure"),
    false,
  );
  assertEquals(
    db.updates.filter((row) => row.table === "brand_payout_releases"),
    [],
  );
});

Deno.test("#3645 payout.canceled reconcile failure throws so Stripe redelivers", async () => {
  const db = new FakeDb();
  db.rpcError = { message: "deadlock detected" };
  await assertRejects(
    () => routeStripeEvent(db as never, {} as never, canceled() as never),
    Error,
    "payout release canceled reconcile failed: deadlock detected",
  );
});


Deno.test("#3645 the webhook records exactly the error the sweep renders as a cancel", async () => {
  const db = new FakeDb();
  await routeStripeEvent(db as never, {} as never, canceled() as never);
  const reconcile = db.rpcs.find((call) =>
    call.fn === "record_stripe_payout_webhook_failure"
  );
  assertEquals(reconcile?.args.p_error_message, STRIPE_PAYOUT_CANCELED_ERROR);
});

Deno.test("#3645 a canceled payout alert says it was canceled, not that attempts ran out", () => {
  const copy = payoutReleaseAlertCopyFor(
    "stripe_attempt_cap",
    STRIPE_PAYOUT_CANCELED_ERROR,
  );
  assertEquals(copy.type, "ops.stripe_payout_release_canceled");
  assertEquals(copy.title, "Stripe organiser payout was canceled");
  assertEquals(copy.bodyLead.includes("exhausted"), false);
  assertEquals(copy.bodyLead.includes("canceled"), true);
});

Deno.test("#3645 a real attempt-cap alert keeps its copy and dedupe type", () => {
  const copy = payoutReleaseAlertCopyFor(
    "stripe_attempt_cap",
    "Amount must be at least 1.00 usd",
  );
  assertEquals(copy.type, "ops.stripe_payout_release_attempt_cap");
  assertEquals(copy.bodyLead, "exhausted 10 definitive payout attempts");
});

Deno.test("#3645 the cancel wording only applies to the Stripe cap kind", () => {
  const copy = payoutReleaseAlertCopyFor(
    "waiting_for_bank",
    STRIPE_PAYOUT_CANCELED_ERROR,
  );
  assertEquals(copy.type, "ops.payout_release_waiting_for_bank");
});

Deno.test("#3645 the sweep's alert sender words every outbox row through the cancel-aware copy", async () => {
  const sweep = await Deno.readTextFile(
    new URL("../../payout-release-sweep/index.ts", import.meta.url),
  );
  const start = sweep.indexOf("async function notifyAttemptCap(");
  const end = sweep.indexOf("\n}\n", start);
  assertEquals(start > 0 && end > start, true, "notifyAttemptCap found");
  const sender = sweep.slice(start, end);
  // Reverting to payoutReleaseAlertCopy(alertKind) would silently bring back
  // "exhausted 10 definitive payout attempts" for a canceled payout.
  assertEquals(
    sender.split("const copy = payoutReleaseAlertCopyFor(alertKind, message);")
      .length,
    2,
  );
  assertEquals(sender.includes("payoutReleaseAlertCopy(alertKind)"), false);
  // The dedupe key is per copy type, so a cancel and a real cap alert for the
  // same release are separate notifications.
  assertEquals(sender.includes("`${copy.type}:${release.release_id}`"), true);
});

// Issue #4522 — the refund alerts the database files under existing outbox
// kinds (20281202064522 section 8) are worded by their message prefix, on
// any kind, and never read as an attempt cap or a Paystack plan.
Deno.test("#4522 refund payout alerts get their own words on any kind", () => {
  const cases: Array<[string, string, string]> = [
    ["paystack_plan_exceeds_due", `${PAYOUT_REFUND_UNRECONCILED_ERROR}: stripe due 143250 > owed 95500`, "ops.payout_release_refund_unreconciled"],
    ["stripe_attempt_cap", `${PAYOUT_REFUND_DEBT_OPENED_ERROR}: 9550 USD owed back from the next payouts`, "ops.payout_release_refund_debt_opened"],
    ["paystack_attempt_cap", `${PAYOUT_REFUND_DEBT_OPENED_ERROR}: 30000000 NGN owed back from the next payouts`, "ops.payout_release_refund_debt_opened"],
    ["paystack_attempt_cap", `${PAYOUT_REFUND_SYNC_FAILED_ERROR}: 40P01 deadlock detected`, "ops.payout_release_refund_sync_failed"],
  ];
  for (const [kind, message, type] of cases) {
    const copy = payoutReleaseAlertCopyFor(kind, message);
    assertEquals(copy.type, type);
    assertEquals(copy.bodyLead.includes("exhausted"), false);
    assertEquals(copy.title.includes("Paystack"), false);
  }
  // Main's own plan alert keeps its words.
  assertEquals(
    payoutReleaseAlertCopyFor("paystack_plan_exceeds_due", "plan 28650000 > due 0").type,
    "ops.paystack_payout_release_plan_exceeds_due",
  );
});
