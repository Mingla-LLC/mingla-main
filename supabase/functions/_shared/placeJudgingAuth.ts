// Issue #4276: who may run the place judging and scoring functions (run-bouncer,
// run-pre-photo-bouncer, run-signal-scorer).
//
// Two callers, and only two:
//   * the service role: the city pipeline conductor, the 15-minute rescore cron
//     (vault service_role_key), and admin-review-venue-claim's service client;
//   * a signed-in, active admin: the admin Place pool screens.
//
// The admin rule is the database's own is_admin_user(), the one check every admin
// surface uses (#3537): asked with a client carrying the caller's token, so auth.uid()
// is the caller. A direct admin_users query is not used: two admin functions had
// queries against it that nobody could satisfy. Anything else is refused before the
// body is read, so nothing is judged or scored for it.
//
// Invariant I-4276-PLACE-JUDGING-ADMIN-OR-SERVICE is declared in
// __tests__/issue_4276_place_judging_auth.implementor.test.ts.

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
  if (authErr || !user?.id) return refuse(401, "Invalid token");

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin_user");
  if (adminErr) return refuse(500, "Admin check failed");
  if (isAdmin !== true) return refuse(403, "Admin access required");
  return { kind: "admin", userId: user.id };
}
