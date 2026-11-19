// #4514 brand-form-submit: the one public endpoint that saves a guest's answers to
// a brand form (buyer web, the link page, Explorer).
//
// Public (verify_jwt = false). An optional bearer token identifies a signed-in
// Explorer user; a personal link token (from the URL fragment, posted in the
// body) identifies the link's person. Rate-limited per salted IP hash (the raw IP
// is never stored); the emergency off switch is the BRAND_FORMS_KILL_SWITCH row in
// public.feature_flags (C8). Service-role DB access only, through
// brand_form_submit_core and brand_form_submit_attempts. The logic and its order
// of operations live in ./submit.ts.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (platform). No new secret.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";
import { BRAND_FORM_PER_IP_10MIN } from "../_shared/brandFormsContract.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export function restSubmitDb(supabase: Client): BrandFormSubmitDb {
  return {
    async switchedOff() {
      const { data, error } = await supabase.rpc("brand_forms_switched_off");
      if (error) throw new Error("switch_read_failed");
      return data === true;
    },
    async countAttempts(ipHash: string) {
      const since10 = new Date(Date.now() - 10 * 60_000).toISOString();
      const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const a = await supabase.from("brand_form_submit_attempts").select("id", {
        count: "exact",
        head: true,
      })
        .eq("ip_hash", ipHash).in("outcome", ["accepted", "rejected"]).gte(
          "created_at",
          since10,
        );
      const b = await supabase.from("brand_form_submit_attempts").select("id", {
        count: "exact",
        head: true,
      })
        .eq("ip_hash", ipHash).in("outcome", ["accepted", "rejected"]).gte(
          "created_at",
          since24,
        );
      // Fail closed: a counting error is treated as over the limit.
      if (a.error || b.error) {
        return { ip10m: BRAND_FORM_PER_IP_10MIN, ip24h: 0 };
      }
      return { ip10m: a.count ?? 0, ip24h: b.count ?? 0 };
    },
    async recordAttempt(ipHash, formId, outcome) {
      const { error } = await supabase.from("brand_form_submit_attempts")
        .insert({ ip_hash: ipHash, form_id: formId, outcome });
      if (error) {
        console.error(
          `[brand-form-submit] attempt_write_failed outcome=${outcome}`,
        );
      }
    },
    async userFromBearer(jwt: string) {
      const { data, error } = await supabase.auth.getUser(jwt);
      if (error || !data?.user?.id) return null;
      return data.user.id as string;
    },
    async submitCore(payload) {
      const { data, error } = await supabase.rpc("brand_form_submit_core", {
        p: payload,
      });
      return {
        data: (data ?? null) as Record<string, unknown> | null,
        error: error
          ? {
            message: String(error.message ?? ""),
            details: error.details ?? null,
          }
          : null,
      };
    },
  };
}

export async function handler(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return await handleBrandFormSubmit(req, { db: restSubmitDb(supabase) });
}

if (import.meta.main) {
  serve(handler);
}
