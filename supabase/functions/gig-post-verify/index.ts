// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { verifyGigPost } from "../_shared/gigPostVerify.ts";
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
  const body = await req.json().catch(() => null) as
    | (Record<string, unknown> & { post_id?: string })
    | null;
  if (!body || typeof body.post_id !== "string") {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
    });
  }
  const verdict = verifyGigPost(body as never);
  const status = verdict.result === "pass"
    ? "passed"
    : verdict.result === "fail"
    ? "failed"
    : "unverifiable";
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await db.rpc("gig_post_check_record", {
    p_post_id: body.post_id,
    p_result: status,
    p_detail: verdict.checks,
  });
  if (error) {
    return new Response(
      JSON.stringify({ error: "check_record_failed", detail: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ ...verdict, status, ledger: data }), {
    headers: { "Content-Type": "application/json" },
  });
});
