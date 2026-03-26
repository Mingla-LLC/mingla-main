import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lat, lng } = await req.json();
    if (lat == null || lng == null) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deterministic 500m offset: same position for same user within the same hour
    const hourSeed = Math.floor(Date.now() / 3_600_000);
    const hash = simpleHash(`${user.id}-${hourSeed}`);
    const angle = (hash % 360) * (Math.PI / 180);
    const distance = 300 + (hash % 200); // 300-500 meters
    const dLat = (distance / 111_320) * Math.cos(angle);
    const dLng = (distance / (111_320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if time delay is enabled
    const { data: settings } = await adminClient
      .from("user_map_settings")
      .select("time_delay_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    const updates: Record<string, any> = {
      user_id: user.id,
      real_lat: lat,
      real_lng: lng,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!settings?.time_delay_enabled) {
      updates.approximate_lat = lat + dLat;
      updates.approximate_lng = lng + dLng;
      updates.approximate_location_updated_at = new Date().toISOString();
    }

    await adminClient
      .from("user_map_settings")
      .upsert(updates, { onConflict: "user_id" });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
