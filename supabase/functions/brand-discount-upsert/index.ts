// Issue #3872 — authenticated Host discount writer. SQL owns validation,
// permission checks, optimistic concurrency and every persisted choice.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type RpcError = { message: string };
type RpcResult = { data: unknown; error: RpcError | null };
type Action = "create" | "update" | "pause" | "resume" | "end" | "delete_draft";

export interface DiscountUpsertDeps {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

const ACTIONS = new Set<Action>([
  "create",
  "update",
  "pause",
  "resume",
  "end",
  "delete_draft",
]);
const DETAILS = new Set([
  "code_taken",
  "version_conflict",
  "set_price_needs_one_item",
  "set_price_not_lower",
  "too_many_automatics",
  "currency_mismatch",
  "window_invalid",
  "sale_price_overlap",
  "scope_target_mismatch",
  "target_not_in_brand",
  "target_not_discountable",
  "kind_not_available",
  "delete_not_allowed",
  "discount_not_found",
]);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function createDiscountUpsertHandler(deps: DiscountUpsertDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS")
      return new Response("ok", { headers: ticketCorsHeaders });
    if (req.method !== "POST")
      return json(
        { error: "method_not_allowed", detail: "method_not_allowed" },
        405,
      );
    const actor = await deps.actorId(req);
    if (!actor)
      return json({ error: "unauthorized", detail: "unauthorized" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_request", detail: "invalid_json" }, 400);
    }
    if (
      !isObject(body) ||
      typeof body.action !== "string" ||
      !ACTIONS.has(body.action as Action) ||
      !isObject(body.payload)
    ) {
      return json({ error: "invalid_request", detail: "invalid_request" }, 400);
    }

    const result = await deps.rpc("issue_3872_upsert_discount", {
      p_actor: actor,
      p_action: body.action,
      p_payload: body.payload,
    });
    if (!result.error) return json({ discount: result.data });

    const detail = result.error.message.trim();
    if (detail === "insufficient_permission") {
      return json({ error: "forbidden", detail }, 403);
    }
    if (DETAILS.has(detail)) {
      const status = detail === "discount_not_found" ? 404 : 409;
      return json({ error: "discount_write_failed", detail }, status);
    }
    console.error("[brand-discount-upsert] unmapped rpc error", {
      length: detail.length,
    });
    return json({ error: "internal", detail: "internal" }, 500);
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(
    createDiscountUpsertHandler({
      actorId: userIdFromAuthHeader,
      rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
    }),
  );
}
