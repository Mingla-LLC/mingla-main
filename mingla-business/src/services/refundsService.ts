/**
 * Refund rows for payments dashboard (B2 / issue #47).
 */

import { supabase } from "./supabase";
import type { BrandRefund } from "../store/currentBrandStore";

export async function listRefundsForBrand(
  brandId: string,
  defaultCurrency: string,
): Promise<BrandRefund[]> {
  const { data: events, error: eErr } = await supabase
    .from("events")
    .select("id")
    .eq("brand_id", brandId)
    .is("deleted_at", null);

  if (eErr) throw eErr;
  const eventIds = (events ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) return [];

  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select("id, event_id")
    .in("event_id", eventIds);

  if (oErr) throw oErr;
  const orderRows = orders ?? [];
  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((o) => o.id as string);
  const orderEvent = new Map<string, string>();
  for (const o of orderRows) {
    orderEvent.set(o.id as string, o.event_id as string);
  }

  const { data: evTitles, error: tErr } = await supabase
    .from("events")
    .select("id, title")
    .in("id", eventIds);

  if (tErr) throw tErr;
  const titleByEvent = new Map<string, string>();
  for (const ev of evTitles ?? []) {
    titleByEvent.set(ev.id as string, String(ev.title ?? "Event"));
  }

  const { data: refunds, error: rErr } = await supabase
    .from("refunds")
    .select("id, order_id, amount_cents, reason, created_at")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false })
    .limit(25);

  if (rErr) throw rErr;

  const currency = defaultCurrency.trim().toUpperCase().slice(0, 3) || "GBP";

  return (refunds ?? []).map((r) => {
    const oid = r.order_id as string;
    const eid = orderEvent.get(oid) ?? "";
    const eventTitle = titleByEvent.get(eid) ?? "Event";
    return {
      id: r.id as string,
      amountGbp: (r.amount_cents as number) / 100,
      currency,
      eventTitle,
      refundedAt: r.created_at as string,
      reason: typeof r.reason === "string" ? r.reason : undefined,
    };
  });
}
