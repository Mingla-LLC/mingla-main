// #4490 venue-offer-sweep — the venue offer clock, every 15 minutes from
// pg_cron (issue_4490_offer_sweep): lapsed holds (belt and braces; the Stays
// sweep already expires them), balance reminders before the due date, and
// overdue notices on the due date and 3 days after (no auto-cancel). Every
// message is one booking event keyed by booking and day, so a repeat run sends
// nothing twice. Messages go out through the notification outbox.
//
// Only the platform's own scheduler calls this: the bearer must be the
// project's service key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SweepClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<
    { data: unknown; error: { code?: string; message?: string } | null }
  >;
};

export type VenueOfferSweepDeps = {
  env?: (name: string) => string | undefined;
  client?: () => SweepClient;
};

export function createVenueOfferSweepHandler(deps: VenueOfferSweepDeps = {}) {
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
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
    }) as unknown as SweepClient;
    const { data, error } = await client.rpc("issue_4490_offer_sweep", {
      p_limit: 200,
    });
    if (error) {
      console.error("venue_offer_sweep_failed", {
        code: error.code,
        message: error.message,
      });
      return Response.json({ error: "sweep_failed" }, { status: 500 });
    }
    return Response.json({ ok: true, result: data });
  };
}

if (import.meta.main) {
  Deno.serve(createVenueOfferSweepHandler());
}
