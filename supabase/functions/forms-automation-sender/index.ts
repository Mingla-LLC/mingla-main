// #4452 forms-automation-sender — sends form automation emails (§5.6).
//
// CRON ONLY (plus forms-submit's instant confirmation kick): pg_cron job
// `issue_4452_forms_automation_sender` posts every 5 minutes with the vault
// service_role_key. verify_jwt = true at the gateway, and the bearer is
// compared to SUPABASE_SERVICE_ROLE_KEY in code; any other caller is 401.
// Env: RESEND_API_KEY, UNSUBSCRIBE_TOKEN_SECRET (both existing), optional
// FORMS_SENDER_PAUSED ("1" → claims nothing). No new secret.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signUnsubscribeToken } from "../_shared/marketingTokens.ts";
import { type GateSend, runSender, type SenderDb } from "./sender.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export function restSenderDb(supabase: Client): SenderDb {
  return {
    async claim(limit) {
      const { data, error } = await supabase.rpc("forms_claim_due_sends", { p_limit: limit });
      if (error) throw new Error("claim_failed");
      return (data ?? []) as Array<{ id: string; run_id: string }>;
    },
    async gate(sendId) {
      const { data, error } = await supabase.rpc("forms_send_gate", { p_send_id: sendId });
      if (error) throw new Error("gate_failed");
      return data as GateSend | { action: "skip" | "cancel"; reason: string };
    },
    async finish(sendId, status, err, providerId) {
      const { error } = await supabase.rpc("forms_finish_send", {
        p_send_id: sendId, p_status: status, p_skip_reason: null, p_error: err, p_provider_id: providerId,
      });
      if (error) console.error(`[forms-automation-sender] finish_failed send=${sendId}`);
    },
  };
}

/** Only the names this function reads, each read statically (the env contract). */
function staticEnv(values: Record<string, string | undefined>): (n: string) => string | undefined {
  return (n) => values[n];
}

export async function handler(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return await runSender(req, {
    db: restSenderDb(supabase),
    env: staticEnv({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      UNSUBSCRIBE_TOKEN_SECRET: Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET"),
      FORMS_SENDER_PAUSED: Deno.env.get("FORMS_SENDER_PAUSED"),
    }),
    trackBase: `${url}/functions/v1/forms-track`,
    signUnsubscribe: (email, formKey) =>
      signUnsubscribeToken({ recipient_email: email, campaign_id: `form:${formKey}`, brand_id: null as unknown as string }),
  });
}

if (import.meta.main) {
  serve(handler);
}
