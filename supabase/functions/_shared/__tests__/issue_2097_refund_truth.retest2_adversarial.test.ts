import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  canonicalProviderInteger,
  decideFeeRefundPreflight,
} from "../issue2097TicketRefundTruth.ts";

const read = (path: string) => Deno.readTextFileSync(path);

Deno.test("#2097 retest 2: canonical decimal strings stop at Number.MAX_SAFE_INTEGER", () => {
  assertEquals(
    canonicalProviderInteger(String(Number.MAX_SAFE_INTEGER)),
    String(Number.MAX_SAFE_INTEGER),
  );
  assertEquals(canonicalProviderInteger("9007199254740992"), null);
  assertEquals(canonicalProviderInteger("9999999999999999"), null);
  assertEquals(
    decideFeeRefundPreflight("25", "9007199254740992", "9007199254740992"),
    {
      allowed: false,
      status: "rejected_preflight",
      reason: "invalid_provider_amount",
    },
  );
});

Deno.test("#2097 retest 2: explicit Admin recovery can advance an awaiting refund", () => {
  const source = read(
    "supabase/functions/admin-reconcile-ticket-refund/index.ts",
  );
  assert(
    !source.includes("allowProviderMutation: false"),
    "Admin recovery must not permanently disable the approved provider mutation after the exact Fee and durable baseline become visible",
  );
});

Deno.test("#2097 retest 2: Business preserves buyer-refund truth from non-2xx envelopes", () => {
  const source = read("mingla-business/src/services/orderRefundService.ts");
  const errorBranch = source.slice(
    source.indexOf("if (response.error)"),
    source.indexOf("const data = response.data"),
  );
  for (const token of [
    "refund_reconciliation_pending",
    "refund_evidence_conflict",
    "buyer_refund_status",
    "application_fee_refund_status",
  ]) {
    assert(
      errorBranch.includes(token),
      `Business non-2xx handling discards ${token}`,
    );
  }
  assert(
    errorBranch.includes("buyer refund was issued") &&
      errorBranch.includes("buyer money has not moved"),
    "Business must distinguish post-refund reconciliation from pre-refund waiting/rejection",
  );
});
