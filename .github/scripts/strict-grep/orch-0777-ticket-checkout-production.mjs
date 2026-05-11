#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const failures = [];
const assertIncludes = (file, needle, message) => {
  if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
};
const assertNotIncludes = (file, needle, message) => {
  if (read(file).includes(needle)) failures.push(`${file}: ${message}`);
};
const assertRegexAbsent = (file, regex, message) => {
  if (regex.test(read(file))) failures.push(`${file}: ${message}`);
};
const assertRegex = (file, regex, message) => {
  if (!regex.test(read(file))) failures.push(`${file}: ${message}`);
};

assertIncludes(
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "createTicketCheckout",
  "free checkout must call the production checkout function",
);
assertIncludes(
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "isRequiredPhoneValid",
  "buyer phone must be mandatory",
);
assertNotIncludes(
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "Phone (optional)",
  "buyer phone copy must not say optional",
);
assertNotIncludes(
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "generateOrderId",
  "free checkout must not generate local order ids",
);
assertNotIncludes(
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "PaymentElementStub",
  "paid checkout must not render the stub payment element",
);
assertNotIncludes(
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "Payment succeeded. Ticket issuance is still processing",
  "successful payments must not be rendered as payment errors while webhook finalizes",
);
assertIncludes(
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "presentPaymentSheet",
  "paid checkout must present Stripe PaymentSheet",
);
assertIncludes(
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
  "result.tickets",
  "confirmation must render server-issued tickets",
);
assertNotIncludes(
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
  "recordOrder(order)",
  "confirmation must not write fake organizer order rows to Zustand",
);
assertIncludes(
  "supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql",
  "biz_ticket_checkout_finalize",
  "migration must include checkout finalization RPC",
);
assertIncludes(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
  "payment_intent.succeeded",
  "Stripe webhook router must finalize paid checkouts",
);
assertIncludes(
  "supabase/functions/ticket-confirmation-dispatch/index.ts",
  "RESEND_API_KEY",
  "buyer email confirmation must be wired through Resend",
);
assertIncludes(
  "supabase/functions/ticket-confirmation-dispatch/index.ts",
  "TWILIO_MESSAGING_SERVICE_SID",
  "buyer SMS confirmation must be wired through Twilio messaging",
);
assertNotIncludes(
  "supabase/functions/ticket-checkout-status/index.ts",
  ".select(\"id, ticket_type_id, qr_code, status, ticket_types(name)\")",
  "status endpoint must not anonymously return qr_code without a buyer claim",
);
assertNotIncludes(
  "supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql",
  "v_event.status <> ANY (ARRAY['scheduled'::text, 'live'::text])",
  "selling-state predicate must not use <> ANY",
);
assertRegexAbsent(
  "supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql",
  /<> ANY\s*\(\s*ARRAY\[['"]scheduled['"](?:::text)?,\s*['"]live['"](?:::text)?\]/,
  "future selling-state predicates must not use <> ANY scheduled/live",
);
assertIncludes(
  "supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql",
  "REVOKE SELECT ON TABLE public.tickets FROM authenticated",
  "B2 must revoke broad authenticated ticket SELECT before granting non-credential columns",
);
assertNotIncludes(
  "supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql",
  "qr_code,\n",
  "B2 direct ticket SELECT grants must not include scanner-valid qr_code",
);
assertRegexAbsent(
  "supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql",
  /GRANT SELECT \([^)]*\bqr_token_hash\b[^)]*\) ON TABLE public\.tickets TO (anon|authenticated)/s,
  "B2 direct ticket SELECT grants must not include QR hash material",
);
assertIncludes(
  "supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql",
  "REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM authenticated",
  "B2 must prevent authenticated callers from regenerating scanner-valid QR payloads",
);
assertIncludes(
  "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
  "DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text)",
  "QR pepper rework must remove the old no-pepper finalize RPC signature",
);
assertIncludes(
  "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
  "DROP FUNCTION IF EXISTS public.biz_ticket_scan(uuid, text, uuid)",
  "QR pepper rework must remove the old no-pepper scan RPC signature",
);
assertIncludes(
  "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
  "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) TO service_role",
  "QR pepper rework must expose only the bounded service-role finalize RPC signature",
);
assertIncludes(
  "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
  "GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role",
  "QR pepper rework must expose only the bounded service-role scan RPC signature",
);
assertRegexAbsent(
  "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
  /current_setting\s*\(\s*'app\.qr_token_pepper'|\bpg_reload_conf\s*\(|\balter\s+database\b/i,
  "QR pepper rework must not rely on database-level Postgres configuration",
);
assertIncludes(
  "supabase/functions/_shared/ticketCheckout.ts",
  'Deno.env.get("app.qr_token_pepper")',
  "Edge Functions must source the QR pepper from the Supabase secret name",
);
assertRegex(
  "supabase/functions/ticket-checkout-create/index.ts",
  /p_qr_token_pepper:\s*qrPepper/,
  "free checkout finalization must pass the QR pepper into the bounded RPC",
);
assertRegex(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
  /p_qr_token_pepper:\s*qrTokenPepper\(\)/,
  "paid checkout webhook finalization must pass the QR pepper into the bounded RPC",
);
assertRegex(
  "supabase/functions/scan-ticket/index.ts",
  /p_qr_token_pepper:\s*qrPepper/,
  "scanner validation must pass the QR pepper into the bounded RPC",
);
assertIncludes(
  "Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_QR_TOKEN_PEPPER_CONFIG_GATE.md",
  "Superseded note (2026-05-10): this historical report documents the failed",
  "historical DB-level QR pepper config report must be explicitly marked superseded",
);
assertIncludes(
  "Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md",
  "Superseded note (2026-05-10): this historical deploy report documents the",
  "historical deploy report with DB-level QR pepper instructions must be explicitly marked superseded",
);
assertIncludes(
  "Mingla_Artifacts/prompts/OPERATOR_ORCH-0777_PRODUCTION_CONFIG_B2_AND_LIVE_FIRE_GATE.md",
  "Do not clear QR pepper through database-level Postgres configuration",
  "current operator live-fire prompt must not route QR pepper through database-level config",
);

assertNotIncludes(
  "mingla-business/src/services/eventOrdersService.ts",
  "brand_id: string | null",
  "eventOrdersService must not declare an orders.brand_id field on the local OrderRow type",
);
assertRegexAbsent(
  "mingla-business/src/services/eventOrdersService.ts",
  /event_id,\s*brand_id,\s*buyer_email/,
  "eventOrdersService must not select brand_id from the orders table",
);
assertRegex(
  "mingla-business/src/services/eventOrdersService.ts",
  /events!?inner?\s*\(\s*brand_id/,
  "eventOrdersService must source brand_id transitively from events embed",
);
assertNotIncludes(
  "mingla-business/src/services/eventOrdersService.ts",
  'order.brand_id ?? ""',
  "eventOrdersService must map brandId from order.events.brand_id, not order.brand_id",
);

for (const file of [
  "mingla-business/app/event/[id]/index.tsx",
  "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  "mingla-business/app/event/[id]/guests/index.tsx",
  "mingla-business/app/event/[id]/guests/[guestId].tsx",
  "mingla-business/app/event/[id]/reconciliation.tsx",
  "mingla-business/src/components/event/EventListCard.tsx",
  "mingla-business/src/components/event/EditPublishedScreen.tsx",
]) {
  assertNotIncludes(
    file,
    "useOrderStore",
    "organizer production sales surfaces must not import/read local orderStore",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0777 production checkout guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0777 production checkout guard passed.");
