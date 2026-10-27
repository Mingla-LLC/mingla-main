import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import { sha256 } from "../referral-member-invite/index.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
interface ClaimActor {
  id: string;
  email: string;
}
export function createPayeeClaimHandler(deps: {
  actor(req: Request): Promise<ClaimActor | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}) {
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...ticketCorsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actor(req);
    if (!actor) return json({ error: "unauthorized" }, 401);
    let body: { token?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (
      typeof body.token !== "string" || body.token.length < 32 ||
      body.token.length > 200
    ) return json({ error: "invalid_request" }, 400);
    const result = await deps.rpc("issue_3872_claim_guest_earnings", {
      p_actor: actor.id,
      p_email: actor.email,
      p_token_hash: await sha256(body.token),
    });
    if (!result.error) return json({ claimed: result.data });
    const detail = result.error.message.trim();
    if (detail === "claim_email_mismatch") {
      return json({ error: "email_mismatch", detail }, 403);
    }
    if (["claim_not_found", "claim_used"].includes(detail)) {
      return json({ error: "not_found", detail }, 404);
    }
    if (detail === "claim_expired") {
      return json({ error: "expired", detail }, 410);
    }
    if (detail === "claim_member_conflict") {
      return json({ error: "membership_conflict", detail }, 409);
    }
    return json({ error: "internal" }, 500);
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(createPayeeClaimHandler({
    actor: async (req) => {
      const jwt = (req.headers.get("Authorization") ?? "").replace(
        /^Bearer\s+/i,
        "",
      );
      if (!jwt) return null;
      const { data, error } = await client.auth.getUser(jwt);
      const email = data.user?.email?.trim().toLowerCase();
      return error || !data.user?.id || !email
        ? null
        : { id: data.user.id, email };
    },
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
  }));
}
