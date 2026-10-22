// Issue #3872 — scheduled, idempotent discount lifecycle notifications.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  sendDiscountNotice,
  type DiscountNotice,
} from "../_shared/discountNotify.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
export interface DiscountMaintenanceDeps {
  authorize(req: Request): boolean;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  send(notice: DiscountNotice): Promise<void>;
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseNotice(value: unknown): DiscountNotice | null {
  if (
    !isObject(value) ||
    typeof value.discountId !== "string" ||
    typeof value.brandId !== "string" ||
    typeof value.name !== "string" ||
    ![
      "business.discount_limit_80",
      "business.discount_ended",
      "business.discount_needs_attention",
    ].includes(String(value.type))
  )
    return null;
  return value as unknown as DiscountNotice;
}

export function createDiscountMaintenanceHandler(
  deps: DiscountMaintenanceDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS")
      return new Response("ok", { headers: ticketCorsHeaders });
    if (req.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    if (!deps.authorize(req)) return json({ error: "forbidden" }, 403);
    const sweep = await deps.rpc("issue_3872_discount_maintenance", {});
    if (sweep.error) {
      console.error("[discount-maintenance-sweep] sweep failed", {
        length: sweep.error.message.length,
      });
      return json({ error: "maintenance_failed" }, 500);
    }
    const raw =
      isObject(sweep.data) && Array.isArray(sweep.data.notify)
        ? sweep.data.notify
        : [];
    let sent = 0;
    for (const value of raw) {
      const notice = parseNotice(value);
      if (!notice) continue;
      await deps.send(notice);
      const marked = await deps.rpc("issue_3872_mark_discount_notified", {
        p_id: notice.discountId,
        p_type: notice.type,
      });
      if (marked.error) throw new Error("discount_notification_mark_failed");
      sent += 1;
    }
    return json({ ok: true, sent });
  };
}

if (import.meta.main) {
  const client = serviceClient();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  serve(
    createDiscountMaintenanceHandler({
      authorize: (req) =>
        serviceKey.length > 0 &&
        req.headers.get("authorization") === `Bearer ${serviceKey}`,
      rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
      send: async (notice) => await sendDiscountNotice(client, notice),
    }),
  );
}
