import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql",
);
const b2MigrationPath = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql",
);
const qrPepperMigrationPath = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql",
);
const sharedTicketCheckoutPath = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/ticketCheckout.ts",
);
const ticketCheckoutCreatePath = path.resolve(
  __dirname,
  "../../../../supabase/functions/ticket-checkout-create/index.ts",
);
const stripeWebhookRouterPath = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/stripeWebhookRouter.ts",
);
const scanTicketPath = path.resolve(
  __dirname,
  "../../../../supabase/functions/scan-ticket/index.ts",
);
const scanWrongEventMigrationPath = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql",
);
const eventOrdersServicePath = path.resolve(
  __dirname,
  "../../services/eventOrdersService.ts",
);

describe("ORCH-0777 migration guards", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const b2Sql = fs.readFileSync(b2MigrationPath, "utf8");
  const qrPepperSql = fs.readFileSync(qrPepperMigrationPath, "utf8");
  const sharedTicketCheckout = fs.readFileSync(sharedTicketCheckoutPath, "utf8");
  const ticketCheckoutCreate = fs.readFileSync(ticketCheckoutCreatePath, "utf8");
  const stripeWebhookRouter = fs.readFileSync(stripeWebhookRouterPath, "utf8");
  const scanTicket = fs.readFileSync(scanTicketPath, "utf8");
  const scanWrongEventSql = fs.readFileSync(scanWrongEventMigrationPath, "utf8");

  it("allows scheduled/live events with a NOT = ANY selling predicate", () => {
    expect(sql).toContain(
      "NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text]))",
    );
    expect(sql).not.toContain(
      "v_event.status <> ANY (ARRAY['scheduled'::text, 'live'::text])",
    );
  });

  it("stores hashed QR token material and not the old plaintext bearer shape", () => {
    expect(sql).toContain("biz_ticket_checkout_token_hash");
    expect(sql).toContain("'sha256'");
    expect(sql).toContain("idx_tickets_qr_token_hash");
    expect(sql).not.toContain("'mingla:ticket:' || v_ticket_id::text || ':token:'");
    expect(sql).not.toContain("md5(v_token)");
  });

  it("aligns the checkout schema with the approved spec defaults", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS stripe_payment_intent_status text");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS failed_at timestamptz");
    expect(sql).toContain("ALTER COLUMN source SET DEFAULT 'online_checkout'");
    expect(sql).toContain("ALTER COLUMN notification_status SET DEFAULT 'pending'");
    expect(sql).toContain("ALTER COLUMN stripe_application_fee_amount_cents SET DEFAULT 0");
    expect(sql).toContain("cart_fingerprint text");
    expect(sql).toContain("stripe_payment_intent_client_secret_hash text");
  });

  it("removes brand-team-readable ticket scan credentials from direct SELECT grants", () => {
    expect(b2Sql).toContain("REVOKE SELECT ON TABLE public.tickets FROM anon");
    expect(b2Sql).toContain("REVOKE SELECT ON TABLE public.tickets FROM authenticated");
    expect(b2Sql).not.toMatch(/GRANT SELECT \([^)]*\bqr_code\b[^)]*\) ON TABLE public\.tickets TO authenticated/s);
    expect(b2Sql).not.toMatch(/GRANT SELECT \([^)]*\bqr_token_hash\b[^)]*\) ON TABLE public\.tickets TO authenticated/s);
    expect(b2Sql).not.toMatch(/GRANT SELECT \([^)]*\bqr_code\b[^)]*\) ON TABLE public\.tickets TO anon/s);
    expect(b2Sql).not.toMatch(/GRANT SELECT \([^)]*\bqr_token_hash\b[^)]*\) ON TABLE public\.tickets TO anon/s);
    expect(b2Sql).toContain("REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM authenticated");
    expect(b2Sql).toContain("REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text) FROM authenticated");
    expect(b2Sql).toContain("GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) TO service_role");
  });

  it("supersedes database-level QR pepper GUC fallback with bounded service-role RPC parameters", () => {
    expect(qrPepperSql).toContain("p_qr_token_pepper text");
    expect(qrPepperSql).toContain("RAISE EXCEPTION 'qr_token_pepper_missing'");
    expect(qrPepperSql).toContain("DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text)");
    expect(qrPepperSql).toContain("DROP FUNCTION IF EXISTS public.biz_ticket_scan(uuid, text, uuid)");
    expect(qrPepperSql).toContain("DROP FUNCTION IF EXISTS public.biz_ticket_checkout_qr_payload(uuid, text)");
    expect(qrPepperSql).toContain("DROP FUNCTION IF EXISTS public.biz_ticket_checkout_token_hash(text)");
    expect(qrPepperSql).toContain("GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) TO service_role");
    expect(qrPepperSql).toContain("GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role");
    expect(qrPepperSql).not.toContain("current_setting('app.qr_token_pepper'");
    expect(qrPepperSql).not.toMatch(/\bpg_reload_conf\s*\(/i);
    expect(qrPepperSql).not.toMatch(/\balter\s+database\b/i);
  });

  it("passes the Edge Function QR pepper secret into every QR-dependent RPC", () => {
    expect(sharedTicketCheckout).toContain('Deno.env.get("app.qr_token_pepper")');
    expect(sharedTicketCheckout).toContain('throw new Error("qr_token_pepper_missing")');
    expect(sharedTicketCheckout).toContain('pepper === "local-ticket-pepper"');
    expect(ticketCheckoutCreate).toContain("qrTokenPepper()");
    expect(ticketCheckoutCreate).toContain("p_qr_token_pepper: qrPepper");
    expect(stripeWebhookRouter).toContain("qrTokenPepper()");
    expect(stripeWebhookRouter).toContain("p_qr_token_pepper: qrTokenPepper()");
    expect(scanTicket).toContain("qrTokenPepper()");
    expect(scanTicket).toContain("p_qr_token_pepper: qrPepper");
  });

  it("keeps paid checkout and provider failures structured and non-secret", () => {
    expect(sharedTicketCheckout).toContain("classifyStripePaymentIntentCreateFailure");
    expect(sharedTicketCheckout).toContain("stripe_key_or_capability_config");
    expect(ticketCheckoutCreate).toContain("payment_intent_create_failed");
    expect(ticketCheckoutCreate).toContain("failure_reason: failure.detail");
    expect(ticketCheckoutCreate).toContain(".is(\"stripe_payment_intent_id\", null)");
    expect(ticketCheckoutCreate).not.toMatch(/await stripe\.paymentIntents\.create\([\s\S]*\);\n\n  const clientSecret/);
    expect(ticketCheckoutCreate).toContain("let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;");
    expect(ticketCheckoutCreate).toContain("stripe = stripeTicketCheckout();");
    expect(ticketCheckoutCreate).toContain("if (stripe !== null)");
    expect(ticketCheckoutCreate).toContain("cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)");
    expect(ticketCheckoutCreate).toContain("payment_session_persist_failed");

    expect(sharedTicketCheckout).toContain("classifyNotificationProviderFailure");
    expect(sharedTicketCheckout).toContain("`${provider}_send_failed`");
    expect(sharedTicketCheckout).toContain("status === 400 || status === 401 || status === 403");
    expect(sharedTicketCheckout).not.toContain("recipient@example.test");
  });

  it("keeps wrong-event scans from violating the scan_events ticket-event trigger", () => {
    expect(scanWrongEventSql).toContain("v_scan_result := 'wrong_event'");
    expect(scanWrongEventSql).toContain("v_scan_event_id := CASE");
    expect(scanWrongEventSql).toContain("WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id");
    expect(scanWrongEventSql).toContain("'requestedEventId', p_event_id");
    expect(scanWrongEventSql).toContain("GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role");
  });
});

describe("ORCH-0777 organizer order visibility repair", () => {
  const ordersService = fs.readFileSync(eventOrdersServicePath, "utf8");

  it("does not select orders.brand_id (column does not exist on production)", () => {
    expect(ordersService).not.toMatch(/event_id,\s*brand_id,\s*buyer_email/);
  });

  it("does not declare orders.brand_id on the OrderRow interface", () => {
    expect(ordersService).not.toMatch(/brand_id:\s*string\s*\|\s*null/);
  });

  it("sources brandId transitively from events embed", () => {
    expect(ordersService).toMatch(/events!?inner?\s*\(\s*brand_id/);
    expect(ordersService).toMatch(/order\.events\?\.brand_id\s*\?\?\s*""/);
  });
});
