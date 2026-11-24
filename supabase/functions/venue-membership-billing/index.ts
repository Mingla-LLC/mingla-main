// #4490 P6 venue-membership-billing — the membership clock, hourly from
// pg_cron (issue_4490_membership_billing_run): the next month and its
// renewal email N days before, payment due on renewal day, a second reminder
// 3 days after (grace), lapsed when the grace ends, members who left ended,
// pauses from the end of the paid month, joins never paid closed after 2 days,
// unused credits expired. Idempotent: one month per (member, start) and one
// email per month and step, so a repeat run sends nothing twice. Emails go out
// through the notification outbox; the member link is built when each email
// is sent. Nothing is ever charged here: the member pays from the email.
//
// Only the platform's own scheduler calls this: the bearer must be the
// project's service key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type BillingClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<
    { data: unknown; error: { code?: string; message?: string } | null }
  >;
};

export type VenueMembershipBillingDeps = {
  env?: (name: string) => string | undefined;
  client?: () => BillingClient;
};

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueMembershipBillingHandler(
  deps: VenueMembershipBillingDeps = {},
) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const url = env("SUPABASE_URL") ?? "";
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (
      !url || !serviceKey ||
      req.headers.get("authorization") !== `Bearer ${serviceKey}`
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const client = deps.client ? deps.client() : createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as BillingClient;
    const { data, error } = await client.rpc(
      "issue_4490_membership_billing_run",
      { p_now: null, p_limit: 500 },
    );
    if (error) {
      console.error("venue_membership_billing_failed", {
        code: error.code,
        message: error.message,
      });
      return Response.json({ error: "billing_failed" }, { status: 500 });
    }
    return Response.json({ ok: true, result: data });
  };
}

if (import.meta.main) {
  Deno.serve(createVenueMembershipBillingHandler());
}
