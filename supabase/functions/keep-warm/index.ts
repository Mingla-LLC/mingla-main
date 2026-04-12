import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTIONS_TO_WARM = [
  'discover-cards',
  'generate-curated-experiences',
  'discover-experiences',
  'get-person-hero-cards',
  'generate-session-deck',
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
