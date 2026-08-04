#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// Pure verdict (behavior-preserving refactor). All disk I/O is injected via
// `read` (a repo-relative reader), so the --self-test path drives the exact same
// assertions against in-memory fixtures. Every assertion pushes the SAME
// `${file}: ${message}` string into `failures`, in the SAME order, as before.
function check(read, failures) {
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
  // ORCH-0847 Phase B replaced isRequiredPhoneValid with isValidE164 (still
  // enforces mandatory phone — both server + client validate against the same
  // E.164 regex). The contract is unchanged; only the validator name moved.
  assertIncludes(
    "mingla-business/app/checkout/[eventId]/buyer.tsx",
    "isValidE164",
    "buyer phone must be mandatory (validated via E.164 regex)",
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
  // [RETIRED 2026-05-14 by ORCH-0839-B] paid-checkout presentPaymentSheet
  // assertion. mingla-business pivoted from native Stripe PaymentSheet to
  // hosted Stripe Checkout via expo-web-browser.openAuthSessionAsync.
  // Replacement contract: the new gate
  // .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
  // (T-G5 + T-G6) enforces payment.tsx invokes openAuthSessionAsync with the
  // "mobile-web" surface discriminator. The remaining ORCH-0777 contracts
  // (free-checkout flow, anon RLS, QR pepper, organizer order visibility,
  // scanner) stay green a-fortiori.
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
  // ===========================================================================
  // #1541 — RECONCILED. Read this before changing it back.
  // ===========================================================================
  // THIS USED TO ASSERT `TWILIO_MESSAGING_SERVICE_SID` APPEARED IN THE
  // DISPATCHER — i.e. it required the money-path function to own a PRIVATE
  // TWILIO CLIENT, which is precisely the defect #1541 removes. The credential
  // literal was only ever a PROXY for the real property ("the buyer SMS
  // confirmation is wired to an approved sender"), and a proxy assertion pins
  // the implementation it was written against: when the architecture changed
  // correctly, the gate broke. That is the same shape as #1518's `dnd` check
  // and #1529's producer audit.
  //
  // So the property is asserted directly instead, as a PAIR. The positive alone
  // would be another token; the negative is what makes the pair a property:
  //   (a) the dispatcher demonstrably sends a buyer SMS through smsAdapter, AND
  //   (b) it has NO other egress available to it — no provider endpoint, no
  //       provider credential of its own.
  // Together those mean the send can only be going through the sanctioned path.
  //
  // NO COVERAGE IS LOST. The approved-toll-free discipline this assertion cared
  // about did not move — only the send did. It is enforced at the adapter by
  // i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs
  // (I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY), and the no-direct-egress
  // rule repo-wide by issue-1541-sms-provider-sole-send-path.mjs.
  assertIncludes(
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "smsAdapter.send(",
    "buyer SMS confirmation must be sent through the sanctioned send path (smsAdapter)",
  );
  assertNotIncludes(
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "api.twilio.com",
    "buyer SMS confirmation must not reach a provider directly — that bypasses the market kill switches",
  );
  assertRegexAbsent(
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    /Deno\.env\.get\(\s*["']TWILIO_/,
    "buyer SMS confirmation must not read provider credentials — they belong to smsAdapter alone",
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
  // [RETIRED 2026-07-19 by issue #974] Three assertions verified that the
  // historical ORCH-0777 reports under Mingla_Artifacts/reports/ carried
  // "superseded" labels warning against DB-level QR pepper config. Those reports
  // were deleted with the artifact system (preserved at tag pre-avengers-archive),
  // so the labeling contract has nothing left to guard. The LIVE contract —
  // no database-level pepper config in migrations or edge functions — is still
  // enforced by the assertRegexAbsent/assertIncludes checks above.

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
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  // A GOOD fixture map: every asserted file carries exactly the tokens its
  // assertions require and none of the forbidden ones. Files scanned only by
  // absence checks (the 7 sales surfaces) are empty strings.
  const GOOD = {
    "mingla-business/app/checkout/[eventId]/buyer.tsx":
      "createTicketCheckout(); isValidE164(phone);",
    "mingla-business/app/checkout/[eventId]/payment.tsx":
      "// hosted checkout via openAuthSessionAsync",
    "mingla-business/app/checkout/[eventId]/confirm.tsx":
      "render(result.tickets);",
    "supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql":
      "CREATE FUNCTION public.biz_ticket_checkout_finalize() RETURNS void AS $$ BEGIN END; $$;",
    "supabase/functions/_shared/stripeWebhookRouter.ts":
      "case 'payment_intent.succeeded': finalize({ p_qr_token_pepper: qrTokenPepper() });",
    // #1541 — email still goes through Resend from here; the SMS goes through
    // smsAdapter, and this file carries no provider endpoint or credential.
    "supabase/functions/ticket-confirmation-dispatch/index.ts":
      "const r = RESEND_API_KEY; await smsAdapter.send({ to, brandName, message });",
    "supabase/functions/ticket-checkout-status/index.ts":
      "return { status };",
    "supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql":
      "REVOKE SELECT ON TABLE public.tickets FROM authenticated;\n" +
      "REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM authenticated;",
    "supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql":
      "DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text);\n" +
      "DROP FUNCTION IF EXISTS public.biz_ticket_scan(uuid, text, uuid);\n" +
      "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) TO service_role;\n" +
      "GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;",
    "supabase/functions/_shared/ticketCheckout.ts":
      'const pepper = Deno.env.get("app.qr_token_pepper");',
    "supabase/functions/ticket-checkout-create/index.ts":
      "finalize({ p_qr_token_pepper: qrPepper });",
    "supabase/functions/scan-ticket/index.ts":
      "scan({ p_qr_token_pepper: qrPepper });",
    "mingla-business/src/services/eventOrdersService.ts":
      "supabase.from('orders').select('id, events!inner(brand_id), buyer_email');",
    "mingla-business/app/event/[id]/index.tsx": "",
    "mingla-business/app/event/[id]/orders/[oid]/index.tsx": "",
    "mingla-business/app/event/[id]/guests/index.tsx": "",
    "mingla-business/app/event/[id]/guests/[guestId].tsx": "",
    "mingla-business/app/event/[id]/reconciliation.tsx": "",
    "mingla-business/src/components/event/EventListCard.tsx": "",
    "mingla-business/src/components/event/EditPublishedScreen.tsx": "",
  };
  const run = (map) => {
    const f = [];
    check((rel) => map[rel] ?? "", f);
    return f;
  };

  // GOOD: all contract points satisfied → silent.
  if (run(GOOD).length) self.push("GOOD (all ORCH-0777 production-checkout contract points) wrongly flagged");

  // BAD1 (revert-style): useOrderStore re-added to reconciliation.tsx → fires.
  const bad1 = {
    ...GOOD,
    "mingla-business/app/event/[id]/reconciliation.tsx":
      "import { useOrderStore } from '../../../src/store/orderStore';",
  };
  if (run(bad1).length === 0) self.push("BAD1 (useOrderStore re-added to reconciliation.tsx) not flagged");

  // BAD2 (regression, different angle): brand_id selected directly from the
  // orders table in eventOrdersService → fires.
  const bad2 = {
    ...GOOD,
    "mingla-business/src/services/eventOrdersService.ts":
      "supabase.from('orders').select('id, event_id, brand_id, buyer_email');",
  };
  if (run(bad2).length === 0) self.push("BAD2 (brand_id selected directly from orders table) not flagged");

  // #1541 — BAD3: the dispatcher reacquires a PRIVATE TWILIO CLIENT (the exact
  // bypass this issue removed) → must fire. This is what makes the reconciled
  // assertion a property rather than a token: a file could satisfy
  // `smsAdapter.send(` and STILL smuggle a direct provider call beside it, and
  // the negative half is the only thing that catches that.
  const bad3 = {
    ...GOOD,
    "supabase/functions/ticket-confirmation-dispatch/index.ts":
      "const r = RESEND_API_KEY; await smsAdapter.send({ to });\n" +
      'const sid = Deno.env.get("TWILIO_ACCOUNT_SID");\n' +
      "await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);",
  };
  if (run(bad3).length === 0) {
    self.push("BAD3 (dispatcher reacquired a private Twilio client alongside the adapter call) not flagged");
  }

  // #1541 — BAD4: the SMS send is removed entirely. The buyer confirmation must
  // still HAPPEN, not merely avoid the provider — an absence check alone would
  // bless a dispatcher that texts nobody.
  const bad4 = {
    ...GOOD,
    "supabase/functions/ticket-confirmation-dispatch/index.ts":
      "const r = RESEND_API_KEY; // sms removed",
  };
  if (run(bad4).length === 0) {
    self.push("BAD4 (buyer SMS confirmation removed entirely) not flagged");
  }

  if (self.length) {
    console.error("ORCH-0777-TICKET-CHECKOUT-PRODUCTION self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0777-TICKET-CHECKOUT-PRODUCTION self-test PASS (5/5 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];
check(read, failures);

if (failures.length > 0) {
  console.error("ORCH-0777 production checkout guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0777 production checkout guard passed.");
