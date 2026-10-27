// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
    });
  }
  if (!(await isAuthorizedCronCaller(req.headers.get("authorization")))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await db.rpc("local_timer_tick", {
    p_now: new Date().toISOString(),
  });
  return new Response(
    JSON.stringify(
      error ? { error: "timer_failed", detail: error.message } : data,
    ),
    {
      status: error ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
