/**
 * #4596 — the event Blasts roster service. Lives apart from the audience
 * service because only the on-intent event Blasts screen reads it; the
 * audience service sits on the boot path through the Audiences tab.
 */

import { supabase } from "../supabase";
import { maskEmail, maskPhone } from "./marketingAudienceService";
import type { BuyerRowData } from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

const toCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * #4596 fix pass 3 — the event Blasts roster from the same owner as the count:
 * one row per person the count includes (buyers, guests, both) plus going
 * guests waiting on a duplicate check. Consent is the server's decision.
 */
export async function getEventRoster(input: {
  actor_id: string;
  brand_id: string;
  event_id: string;
}): Promise<BuyerRowData[]> {
  assertUuid(input.actor_id, "getEventRoster.actor_id");
  assertUuid(input.brand_id, "getEventRoster.brand_id");
  assertUuid(input.event_id, "getEventRoster.event_id");
  const { data, error } = await supabase.rpc("biz_marketing_event_roster_v1", {
    p_actor_id: input.actor_id,
    p_brand_id: input.brand_id,
    p_event_id: input.event_id,
  });
  if (error) throw error;
  const body = data as { eventTitle?: unknown; rows?: unknown } | null;
  if (body === null || !Array.isArray(body.rows)) throw new Error("EVENT_ROSTER_INVALID_RESPONSE");
  const title = typeof body.eventTitle === "string" ? body.eventTitle : null;
  return (body.rows as Array<Record<string, unknown>>).map((row) => {
    const role = row.role === "buyer" || row.role === "both" || row.role === "pending" ? row.role : "guest";
    const email = typeof row.email === "string" ? row.email : null;
    const phone = typeof row.phone === "string" ? row.phone : null;
    return {
      contact_key: String(row.key),
      display_name: typeof row.name === "string" ? row.name : "Guest",
      masked_email: maskEmail(email),
      raw_email: email,
      masked_phone: maskPhone(phone),
      raw_phone: phone,
      order_count: toCount(row.orderCount),
      total_spend_minor: toCount(row.totalSpendMinor),
      total_spend_currency: typeof row.currency === "string" ? row.currency : "USD",
      last_event_id: input.event_id,
      last_event_name: title,
      last_purchase_at: typeof row.lastAt === "string" ? row.lastAt : null,
      consent: {
        email_marketing_ok: row.emailOk === true,
        sms_marketing_ok: row.smsOk === true,
        unsubscribed_brand_scope: row.emailRefused === true,
        unsubscribed_global_scope: false,
        pending_review: role === "pending",
      },
      audience_role: role,
    };
  });
}

