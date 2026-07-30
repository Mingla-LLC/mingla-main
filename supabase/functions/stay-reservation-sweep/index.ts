import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export async function handleStayReservationSweep(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (
    !url ||
    !serviceKey ||
    req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const client = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.rpc("issue_1389_run_stay_sweep", {
    p_limit: 100,
    p_request_id: crypto.randomUUID(),
  });
  if (error) {
    console.error("stay_reservation_sweep_failed", {
      code: error.code,
      message: error.message,
    });
    return Response.json({ error: "sweep_failed" }, { status: 500 });
  }
  const { data: payout, error: payoutError } = await client.rpc(
    "run_stay_payout_release_dark_sweep",
    { p_now: new Date().toISOString() },
  );
  if (payoutError) {
    console.error("stay_payout_dark_sweep_failed", {
      code: payoutError.code,
      message: payoutError.message,
    });
    return Response.json({ error: "payout_sweep_failed" }, { status: 500 });
  }
  return Response.json({ ok: true, result: data, payout });
}

if (import.meta.main) {
  Deno.serve(handleStayReservationSweep);
}
