// Issue #3872 — authenticated Host discount writer. SQL owns validation,
// permission checks, optimistic concurrency and every persisted choice.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type RpcError = { message: string; code?: string };
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

// #4304 — a CHECK constraint the SQL writer hits is a known Host mistake, not
// an internal fault. Production 2026-11-06: Ari's WYTHE20 target carried both
// target_id and listing_kind, violated bdt_shape and came back as a bare 500.
// Each constraint maps to a stable detail the Host UI and Ari can word.
const CONSTRAINT_DETAILS: Readonly<Record<string, string>> = Object.freeze({
  bd_code_shape: "code_shape_invalid",
  bd_value_shape: "value_shape_invalid",
  bdt_shape: "target_shape_invalid",
  brand_discounts_name_check: "name_invalid",
  bd_window: "window_invalid",
  bd_set_price_items: "scope_target_mismatch",
  bd_sale_price_items: "scope_target_mismatch",
  bd_count_end: "schedule_invalid",
  bd_schedule_kind: "schedule_invalid",
  bd_schedule_shape: "schedule_invalid",
});
const SHAPE_DETAILS = new Set([
  "code_shape_invalid",
  "value_shape_invalid",
  "currency_missing",
  "target_shape_invalid",
  "name_invalid",
  "schedule_invalid",
  "invalid_input",
]);
const CHECK_CONSTRAINT_RE = /violates check constraint "([a-z0-9_]+)"/;

/** The stable detail for a refused SQL write, else null (truly internal). */
export function discountWriteDetail(
  error: RpcError,
  payload: Record<string, unknown>,
): string | null {
  const message = error.message.trim();
  if (message === "insufficient_permission" || DETAILS.has(message)) {
    return message;
  }
  if (message === "brand_required" || message === "discount_action_invalid") {
    return "invalid_request";
  }
  const constraint = CHECK_CONSTRAINT_RE.exec(message)?.[1];
  if (constraint && Object.hasOwn(CONSTRAINT_DETAILS, constraint)) {
    const detail = CONSTRAINT_DETAILS[constraint];
    // bd_value_shape also fires when an amount has no brand currency: the
    // writer stamps the brand's currency, so a well-formed amount payload
    // that still fails means the brand has none.
    if (
      detail === "value_shape_invalid" &&
      (payload.valueType === "amount" || payload.valueType === "set_price") &&
      payload.valueMinor !== undefined && payload.valueMinor !== null &&
      (payload.valueBps === undefined || payload.valueBps === null)
    ) {
      return "currency_missing";
    }
    return detail;
  }
  // Malformed uuid / timestamp / integer text in the payload.
  if (
    error.code === "22P02" || error.code === "22007" ||
    error.code === "22008" || /^invalid input syntax for type /.test(message)
  ) {
    return "invalid_input";
  }
  return null;
}

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
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json(
        { error: "method_not_allowed", detail: "method_not_allowed" },
        405,
      );
    }
    const actor = await deps.actorId(req);
    if (!actor) {
      return json({ error: "unauthorized", detail: "unauthorized" }, 401);
    }

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

    const detail = discountWriteDetail(
      result.error,
      body.payload as Record<string, unknown>,
    );
    if (detail === "insufficient_permission") {
      return json({ error: "forbidden", detail }, 403);
    }
    if (detail === "invalid_request") {
      return json({ error: "invalid_request", detail }, 400);
    }
    if (detail !== null) {
      const status = detail === "discount_not_found"
        ? 404
        : SHAPE_DETAILS.has(detail)
        ? 422
        : 409;
      return json({ error: "discount_write_failed", detail }, status);
    }
    console.error("[brand-discount-upsert] unmapped rpc error", {
      length: result.error.message.length,
      code: result.error.code ?? null,
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
