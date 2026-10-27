// #3872 R3 C1 — recompute the five-part creator verification contract.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export type CreatorVerifyDeps = {
  actorId(req: Request): Promise<string | null>;
  recompute(actorId: string): Promise<unknown>;
};

export function createCreatorVerifyHandler(deps: CreatorVerifyDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actorId = await deps.actorId(req);
    if (!actorId) return json({ error: "unauthorized" }, 401);
    return json(await deps.recompute(actorId));
  };
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createCreatorVerifyHandler({
    actorId: userIdFromAuthHeader,
    recompute: async (actorId) => {
      const { data, error } = await supabase.rpc(
        "issue_3872_recompute_creator_verification",
        {
          p_creator_account_id: actorId,
          p_signal_conflict: false,
        },
      );
      if (error) throw error;
      return data;
    },
  }));
}
