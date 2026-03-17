import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── DEPRECATED: Automatic refresh is disabled to eliminate $75/month in Google API costs.
  // Place refreshes are now admin-managed via the admin-refresh-places edge function.
  // This function returns a no-op success response for backward compatibility.
  console.log('[refresh] DEPRECATED — automatic refresh disabled. Use admin-refresh-places instead.');
  return new Response(JSON.stringify({
    success: true,
    message: 'Automatic refresh is disabled. Use admin-refresh-places for manual refreshes.',
    refreshed: 0,
    deactivated: 0,
    errors: 0,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
