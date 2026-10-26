import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
type RpcResult = { data: unknown; error: { message: string } | null };
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function createReferralRemoveHandler(deps: {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actorId(req);
    if (!actor) return json({ error: "unauthorized" }, 401);
    let body: { memberId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (typeof body.memberId !== "string") {
      return json({ error: "invalid_request" }, 400);
    }
    const result = await deps.rpc("issue_3872_referral_member_remove", {
      p_actor: actor,
      p_member_id: body.memberId,
    });
    if (!result.error) return json({ member: result.data });
    const detail = result.error.message.trim();
    if (detail === "insufficient_permission") {
      return json({ error: "forbidden", detail }, 403);
    }
    if (detail === "member_not_found") {
      return json({ error: "not_found", detail }, 404);
    }
    return json({ error: "internal", detail: "internal" }, 500);
  };
}
if (import.meta.main) {
  const client = serviceClient();
  serve(createReferralRemoveHandler({
    actorId: userIdFromAuthHeader,
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
  }));
}
