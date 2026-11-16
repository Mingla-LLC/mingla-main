// #4452 forms-admin — staff test sends (§5.8). verify_jwt = true; the caller
// must pass forms_can_edit() through their own JWT. Env: RESEND_API_KEY,
// UNSUBSCRIBE_TOKEN_SECRET (existing). No new secret.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signUnsubscribeToken } from "../_shared/marketingTokens.ts";
import { handleAdmin, SAMPLE_ANSWERS } from "./admin.ts";

/** Only the names this function reads, each read statically (the env contract). */
function staticEnv(values: Record<string, string | undefined>): (n: string) => string | undefined {
  return (n) => values[n];
}

export async function handler(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });
  const user = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return await handleAdmin(req, {
    canEdit: async () => (await user.rpc("forms_can_edit")).data === true,
    callerEmail: async () => (await user.auth.getUser()).data.user?.email?.toLowerCase() ?? null,
    loadForm: async (formId) => {
      const { data: f } = await service.from("forms").select("id,key,name,audience,draft,live_version_id").eq("id", formId).maybeSingle();
      if (!f) return null;
      const { data: a } = await service.from("form_automations").select("draft,live_version").eq("form_id", formId).maybeSingle();
      return { ...f, flow: a?.draft ?? null, automation_live: a?.live_version ?? null };
    },
    sendEmail: async (email) => {
      // no-attachment: a form test email is the rendered subject, HTML and text only; forms never attach files.
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY") ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: email.from, to: email.to, reply_to: email.replyTo, subject: email.subject, html: email.html, text: email.text }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    },
    markTested: async (formId) => {
      await service.rpc("admin_form_mark_tested", { p_form_id: formId });
    },
    startTestFlow: async (formId, email) => {
      const { data } = await service.rpc("forms_start_test_run", { p_form_id: formId, p_email: email, p_answers: SAMPLE_ANSWERS });
      if (data) {
        await fetch(`${url}/functions/v1/forms-automation-sender`, {
          method: "POST", headers: { authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}` }, body: "{}",
        }).catch(() => {});
      }
      return (data as string | null) ?? null;
    },
    env: staticEnv({ UNSUBSCRIBE_TOKEN_SECRET: Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET") }),
    trackBase: `${url}/functions/v1/forms-track`,
    signUnsubscribe: (e, k) => signUnsubscribeToken({ recipient_email: e, campaign_id: `form:${k}`, brand_id: null }),
  });
}

if (import.meta.main) {
  serve(handler);
}
