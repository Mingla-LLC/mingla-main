// Issue #4276: who may run the place judging and scoring functions (run-bouncer,
// run-pre-photo-bouncer, run-signal-scorer).
//
// Two callers, and only two:
//   * the service role: the city pipeline conductor, the 15-minute rescore cron
//     (vault service_role_key), and admin-review-venue-claim's service client;
//   * a signed-in, active admin: the admin Place pool screens.
//
// The admin rule is the one every admin function here uses: the token's user, matched
// by email to an active admin_users row. Anything else is refused before the body is
// read, so nothing is judged or scored for it.
//
// MINGLA-INVARIANT: I-4276-PLACE-JUDGING-ADMIN-OR-SERVICE | issue #4276 | run-bouncer, run-pre-photo-bouncer and run-signal-scorer answer only the service role or an active admin

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEqualSecret } from "./contentShareProxyAuth.ts";

export type PlaceJudgingCaller = { kind: "service" } | { kind: "admin"; userId: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The caller, or the refusal to send back. */
export async function authorizePlaceJudgingCaller(
  req: Request,
): Promise<PlaceJudgingCaller | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return refuse(401, "Missing authorization");

  if (await constantTimeEqualSecret(token, serviceKey)) return { kind: "service" };

  const db = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  // The anon key is a valid JWT with no user in it, so it stops here.
  if (authErr || !user?.email) return refuse(401, "Invalid token");

  const { data: admin, error: adminErr } = await db
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (adminErr) return refuse(500, "Admin check failed");
  if (!admin) return refuse(403, "Admin access required");
  return { kind: "admin", userId: user.id };
}
