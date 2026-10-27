// Issue #3872 — caller-bound referral offer writer.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
type Action = "create" | "update" | "pause" | "resume" | "end" | "delete_draft";
const ACTIONS = new Set<Action>([
  "create",
  "update",
  "pause",
  "resume",
  "end",
  "delete_draft",
]);
const EXPECTED = new Set([
  "invalid_request",
  "invalid_action",
  "offer_not_found",
  "offer_brand_immutable",
  "version_conflict",
  "insufficient_permission",
  "referrals_disabled",
  "offer_not_paused",
  "delete_not_allowed",
  "tiers_invalid",
  "scope_target_mismatch",
  "referral_offer_overlap",
  "referral_listing_not_in_brand",
  "referral_buyer_discount_invalid",
  "code_taken",
]);

export interface ReferralOfferDeps {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export function createReferralOfferHandler(deps: ReferralOfferDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actorId(req);
    if (!actor) {
      return response({ error: "unauthorized", detail: "unauthorized" }, 401);
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return response(
        { error: "invalid_request", detail: "invalid_json" },
        400,
      );
    }
    if (
      !isObject(body) || typeof body.action !== "string" ||
      !ACTIONS.has(body.action as Action) || !isObject(body.payload)
    ) {
      return response(
        { error: "invalid_request", detail: "invalid_request" },
        400,
      );
    }
    const result = await deps.rpc("issue_3872_referral_offer_write", {
      p_actor: actor,
      p_action: body.action,
      p_payload: body.payload,
    });
    if (!result.error) return response({ offer: result.data });
    const detail = result.error.message.trim();
    if (detail === "insufficient_permission") {
      return response({ error: "forbidden", detail }, 403);
    }
    if (detail === "offer_not_found") {
      return response({ error: "not_found", detail }, 404);
    }
    if (EXPECTED.has(detail)) {
      return response({ error: "offer_write_failed", detail }, 409);
    }
    console.error("[referral-offer-upsert] unmapped rpc error", {
      length: detail.length,
    });
    return response({ error: "internal", detail: "internal" }, 500);
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(createReferralOfferHandler({
    actorId: userIdFromAuthHeader,
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
  }));
}
