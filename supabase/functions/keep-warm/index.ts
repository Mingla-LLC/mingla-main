import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ORCH-0640 ch06: warm list trimmed. discover-experiences DELETED (DEC-051 orphan).
// get-person-hero-cards REWRITTEN but still warm-eligible. discover-cards +
// generate-curated-experiences are the surviving hot paths.
//
// #1637 — THIS LIST IS THE ONLY THING THAT WARMS A FUNCTION. Nothing else does.
// `discover-merged-events` and `ticketmaster-events` — the two functions the
// consumer Discover tab actually calls on a cold open — were absent, and both
// logged ZERO invocations in a 24h window, so both were guaranteed cold on every
// real user's Discover open. Measured on this project: a cold isolate costs
// 1.5-4s (discover-cards 3942/1763/1485ms cold) against ~90-120ms warm. Adding
// a function here costs 288 invocations/day (this job is pg_cron
// `keep-functions-warm`, `*/5 * * * *`), i.e. ~8.6k/month against Pro's
// 2,000,000 included — ~0.43% each.
//
// ADDING A FUNCTION HERE REQUIRES IT TO HANDLE `warmPing` (see below). Coverage
// is enforced by .github/scripts/strict-grep/issue-1637-discover-keep-warm-coverage.mjs.
const FUNCTIONS_TO_WARM = [
  'discover-cards',
  'generate-curated-experiences',
  'get-person-hero-cards',
  // #1637 — consumer Discover cold-open path. `discover-merged-events` also
  // nested-invokes `ticketmaster-events` (_build-response.ts), so Discover pays
  // TWO cold starts serially; both endpoints need their own warm.
  'discover-merged-events',
  'ticketmaster-events',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const results: Record<string, string> = {};
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  await Promise.all(FUNCTIONS_TO_WARM.map(async (fn) => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        // #1637 — the ping body stays MINIMAL on purpose. Every warmed function
        // short-circuits on `warmPing` and returns 200 `{status:"warm"}` before
        // any business logic, so the ping boots the isolate (the entire 1.5-4s
        // win) without a Ticketmaster API call, an RPC, or a cache write. A
        // function that does NOT handle `warmPing` answers a bare body with a
        // 400, and 8.6k/month of fabricated 4xx would mask a real regression.
        body: JSON.stringify({ warmPing: true }),
      });
      results[fn] = `${resp.status}`;
    } catch (err) {
      results[fn] = `error: ${(err as Error).message}`;
    }
  }));

  return new Response(
    JSON.stringify({ warmed: results, timestamp: new Date().toISOString() }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
