// Issue #3872 — non-paying Host tracking-link writer.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
const response = (body: Record<string, unknown>, status = 200) =>
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

export function createTrackingLinkHandler(deps: {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actorId(req);
    if (!actor) return response({ error: "unauthorized" }, 401);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return response({ error: "invalid_json" }, 400);
    }
    if (
      !isObject(body) || !["create", "archive"].includes(String(body.action)) ||
      !isObject(body.payload)
    ) {
      return response({ error: "invalid_request" }, 400);
    }
    const result = await deps.rpc("issue_3872_tracking_link_write", {
      p_actor: actor,
      p_action: body.action,
      p_payload: body.payload,
    });
    if (!result.error) return response({ link: result.data });
    const detail = result.error.message.trim();
    if (detail === "insufficient_permission") {
      return response({ error: "forbidden", detail }, 403);
    }
    if (detail === "tracking_link_not_found") {
      return response({ error: "not_found", detail }, 404);
    }
    if (
      ["invalid_action", "referrals_disabled", "referral_tracking_link_invalid"]
        .includes(detail)
    ) {
      return response({ error: "tracking_link_write_failed", detail }, 409);
    }
    return response({ error: "internal", detail: "internal" }, 500);
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(createTrackingLinkHandler({
    actorId: userIdFromAuthHeader,
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
  }));
}
