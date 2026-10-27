import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
export interface BuyerLinkActor {
  id: string;
  email: string;
  displayName: string;
}
export interface BuyerLinkDeps {
  actor(req: Request): Promise<BuyerLinkActor | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  randomBytes(size: number): Uint8Array;
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
const hex = (value: Uint8Array) =>
  [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export function createBuyerReferralLinkHandler(deps: BuyerLinkDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actor(req);
    if (!actor) return json({ error: "unauthorized" }, 401);
    let body: { listingKind?: unknown; listingId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (
      !["event", "venue"].includes(String(body.listingKind)) ||
      typeof body.listingId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.listingId)
    ) return json({ error: "invalid_request" }, 400);

    const result = await deps.rpc("issue_3872_buyer_referral_link", {
      p_actor: actor.id,
      p_email: actor.email,
      p_display_name: actor.displayName,
      p_listing_kind: body.listingKind,
      p_listing_id: body.listingId,
      p_link_slug: hex(deps.randomBytes(4)),
    });
    if (!result.error) {
      return result.data === null
        ? json({ available: false })
        : json({ available: true, link: result.data });
    }
    const detail = result.error.message.trim();
    if (detail === "listing_not_found") {
      return json({ error: "not_found", detail }, 404);
    }
    if (["email_mismatch", "member_identity_conflict"].includes(detail)) {
      return json({ error: "identity_conflict", detail }, 409);
    }
    if (detail === "invalid_request") {
      return json({ error: "invalid_request", detail }, 400);
    }
    return json({ error: "internal" }, 500);
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(createBuyerReferralLinkHandler({
    actor: async (req) => {
      const jwt = (req.headers.get("Authorization") ?? "").replace(
        /^Bearer\s+/i,
        "",
      );
      if (!jwt) return null;
      const { data, error } = await client.auth.getUser(jwt);
      const user = data.user;
      const email = user?.email?.trim().toLowerCase();
      if (error || !user?.id || !email) return null;
      const { data: profile } = await client.from("profiles")
        .select("first_name,display_name").eq("id", user.id).maybeSingle();
      return {
        id: user.id,
        email,
        displayName: String(
          profile?.first_name ?? profile?.display_name ?? email.split("@")[0],
        ),
      };
    },
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
  }));
}
