// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { verifyGigPost } from "../_shared/gigPostVerify.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorizedCronCaller(req.headers.get("authorization")))) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as {
    local_month_id?: string;
    platform?: string;
    url?: string;
    expected_handle?: string;
    observed_handle?: string | null;
    caption?: string | null;
    posted_at?: string | null;
    visited_at?: string;
  } | null;
  if (
    !body?.local_month_id || !body.platform || !body.url ||
    !body.expected_handle || !body.visited_at
  ) {
    return json({ error: "validation_error" }, 400);
  }
  const verdict = verifyGigPost({
    platform: body.platform,
    url: body.url,
    expectedHandle: body.expected_handle,
    observedHandle: body.observed_handle,
    caption: body.caption,
    mustTags: ["#minglalocal"],
    postedAt: body.posted_at,
    shootAt: body.visited_at,
  });
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
  const { data, error } = await db.rpc("local_social_check_record", {
    p_local_month_id: body.local_month_id,
    p_status: status,
    p_detail: verdict.checks,
  });
  return error
    ? json({ error: "check_record_failed", detail: error.message }, 500)
    : json({ ...verdict, status, ledger: data });
});
