// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function isAuthorizedOperator(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  if (await isAuthorizedCronCaller(authorization)) return true;
  if (!authorization.match(/^Bearer\s+\S+$/i)) return false;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return false;
  const { data: isAdmin, error: adminError } = await userClient.rpc(
    "is_admin_user",
  );
  return !adminError && isAdmin === true;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorizedOperator(req))) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as
    | { local_month_id?: string }
    | null;
  const localMonthId = String(body?.local_month_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(localMonthId)) {
    return json({ error: "validation_error" }, 400);
  }
  const db = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data: quote, error: quoteError } = await db.rpc(
    "local_payout_prepare",
    { p_local_month_id: localMonthId },
  );
  if (quoteError) {
    return json({ error: "quote_failed", detail: quoteError.message }, 409);
  }
  if (quote?.replayed) return json({ ok: true, replayed: true, quote });
  const { data: ledger, error: ledgerError } = await db.rpc(
    "local_payout_record",
    {
      p_local_month_id: localMonthId,
      p_rail: quote.rail,
      p_currency: quote.currency,
      p_amount_minor: quote.amount_minor,
      p_fx_snapshot_id: quote.fx_snapshot_id,
    },
  );
  if (ledgerError) {
    return json({ error: "ledger_failed", detail: ledgerError.message }, 500);
  }
  return json({ ok: true, quote, ledger });
});
