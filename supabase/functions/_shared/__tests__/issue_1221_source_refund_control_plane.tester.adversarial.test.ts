import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const control = await Deno.readTextFile(
  new URL("../sourceRefundControlPlane.ts", import.meta.url),
);
const paystack = await Deno.readTextFile(
  new URL("../paystackRefundRouter.ts", import.meta.url),
);
const stripe = await Deno.readTextFile(
  new URL("../stripeWebhookRouter.ts", import.meta.url),
);
const notifications = await Deno.readTextFile(
  new URL("../sourceRefundNotifications.ts", import.meta.url),
);
const sourceAction = await Deno.readTextFile(
  new URL("../../source-refund-action/index.ts", import.meta.url),
);
const adminAction = await Deno.readTextFile(
  new URL("../../admin-source-refund-action/index.ts", import.meta.url),
);

Deno.test("#1221 typed webhook ownership precedes legacy routing", () => {
  assert(
    paystack.indexOf("mingla_source_refund") < paystack.indexOf("orderMatch"),
  );
  assertStringIncludes(paystack, '"refund.needs-attention"');
  assertStringIncludes(stripe, "source_refund_id");
  assertStringIncludes(stripe, "source_refund_provider_evidence_mismatch");
});

Deno.test("#1221 cannot collapse Stripe fee reversal into buyer refund", () => {
  assert(!control.includes("refund_application_fee: true"));
  assertStringIncludes(control, "stripe.applicationFees.createRefund");
  assertStringIncludes(control, "original_application_fee_cents");
});

Deno.test("#1221 does not enqueue an undeliverable brand-only placeholder", () => {
  assertStringIncludes(notifications, '"brand_owner"');
  assertStringIncludes(notifications, '"brand_admin"');
  assertStringIncludes(notifications, '"finance_manager"');
  assertStringIncludes(
    notifications,
    '.select("name,contact_email,contact_phone")',
  );
  assertStringIncludes(notifications, "contact: null as null");
  assertStringIncludes(
    notifications,
    '"source_refund_notification_deliveries"',
  );
  assert(
    !notifications.includes(
      "idempotency_key: `source_refund:${input.refundId}:${input.state}:brand`,",
    ),
  );
});

Deno.test("#1221 action edges reject malformed operation IDs before RPC casts", () => {
  assertStringIncludes(sourceAction, "if (!UUID_RE.test(refundId))");
  assert(
    sourceAction.indexOf("if (!UUID_RE.test(refundId))") <
      sourceAction.indexOf(".rpc("),
  );
  const adminHandler = adminAction.slice(
    adminAction.indexOf(
      "export function createAdminSourceRefundActionHandler",
    ),
  );
  assert(
    adminHandler.indexOf("const recovery = parseRecoveryRequest(raw, body)") <
      adminHandler.indexOf(
        '"admin_request_source_refund_attention_recovery"',
      ),
  );
  assert(
    adminHandler.indexOf("if (!UUID_RE.test(refundId))") <
      adminHandler.indexOf('"admin_request_source_refund_action"'),
  );
});
