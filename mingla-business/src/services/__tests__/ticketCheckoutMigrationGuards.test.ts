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

describe("ORCH-0777 migration guards", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const b2Sql = fs.readFileSync(b2MigrationPath, "utf8");
  const qrPepperSql = fs.readFileSync(qrPepperMigrationPath, "utf8");
  const sharedTicketCheckout = fs.readFileSync(sharedTicketCheckoutPath, "utf8");
  const ticketCheckoutCreate = fs.readFileSync(ticketCheckoutCreatePath, "utf8");
  const stripeWebhookRouter = fs.readFileSync(stripeWebhookRouterPath, "utf8");
  const scanTicket = fs.readFileSync(scanTicketPath, "utf8");

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
});
