/**
 * #4111 — public-brand-subscribe. Request / response contract: see handler.ts.
 * verify_jwt: false (signed-out brand page + Mingla Sites newsletter boxes).
 *
 * The confirm text goes through notify-dispatch over HTTP (service role), not
 * a direct SMS adapter import: the dispatcher owns can_send, STOP
 * suppressions, the footer and the delivery ledger, and this function stays
 * out of the delivery-bundle runtime closure (#1437).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { NOT_WIRED, productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { ISSUE_4111_SUBSCRIBE_SMS_CATEGORY } from "../_shared/issue4111EnquiryNotifications.ts";
import { createPublicBrandSubscribeHandler } from "./handler.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(createPublicBrandSubscribeHandler({
  ...productionCoreDeps(),
  moderate: NOT_WIRED.moderate,
  async sendSms(input) {
    if (!input.idempotencyKey || !input.confirmUrl) {
      return { ok: false, error: "sms_request_incomplete" };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        category_key: ISSUE_4111_SUBSCRIBE_SMS_CATEGORY,
        user_id: null,
        contact: input.to,
        payload: { brand_name: input.brandName, confirm_url: input.confirmUrl },
        idempotency_key: input.idempotencyKey,
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    const deliveries = Array.isArray(body.deliveries) ? body.deliveries as Array<Record<string, unknown>> : [];
    const sent = deliveries.some((d) => d.channel === "sms" && (d.status === "sent" || d.status === "delivered"));
    return sent ? { ok: true } : { ok: false, error: String(body.reason ?? deliveries[0]?.status ?? res.status) };
  },
}));
