// #4452 forms-track — open pixel and click redirect for form emails (§5.6).
// Public (verify_jwt = false): the link itself is HMAC-signed; a bad signature
// redirects to https://usemingla.com and records nothing. Opens are counted as
// "approximate" (Apple Mail Privacy preloads images, D-8).
// Env: UNSUBSCRIBE_TOKEN_SECRET (existing; domain-separated key), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. No new secret.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleTrack } from "./track.ts";

export async function handler(req: Request): Promise<Response> {
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return await handleTrack(req, {
    secret: Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET") ?? "",
    record: async (sendId, kind) => {
      await supabase.rpc("forms_record_engagement", { p_send_id: sendId, p_kind: kind });
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
