// #4452 forms-submit — the public endpoint every usemingla.com form posts to.
//
// Public (verify_jwt = false). Strict origin echo (usemingla.com, www and the
// mingla-marketing Vercel previews); any other origin is 403. Rate-limited per
// salted IP hash; the raw IP is never stored. Service-role DB access only,
// through forms_submit_core / forms_track_event and the M1 tables. The logic
// and its order of operations live in ./submit.ts.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (platform), optional
// FORMS_KILL_SWITCH ("1" → 503 paused). No new secret.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  handleFormsRequest,
  type LiveForm,
  PER_FORM_10MIN,
  type SubmitDb,
} from "./submit.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export function restSubmitDb(supabase: Client): SubmitDb {
  return {
    adClient: supabase,
    async loadForm(formId: string): Promise<LiveForm | null> {
      const { data, error } = await supabase.from("forms")
        .select("id,key,audience,status,template,live_version_id").eq(
          "id",
          formId,
        ).maybeSingle();
      if (error) throw new Error("form_read_failed");
      if (!data) return null;
      let version: number | null = null;
      let definition = null;
      if (data.live_version_id) {
        const { data: v, error: ve } = await supabase.from("form_versions")
          .select("version,definition").eq("id", data.live_version_id)
          .maybeSingle();
        if (ve) throw new Error("version_read_failed");
        version = v?.version ?? null;
        definition = v?.definition ?? null;
      }
      return {
        id: data.id,
        key: data.key,
        audience: data.audience,
        status: data.status,
        template: data.template,
        version,
        definition,
      };
    },
    async countAttempts(ipHash: string, formId: string) {
      const since10 = new Date(Date.now() - 10 * 60_000).toISOString();
      const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const a = await supabase.from("forms_submit_attempts").select("id", {
        count: "exact",
        head: true,
      })
        .eq("ip_hash", ipHash).eq("form_id", formId).in("outcome", [
          "accepted",
          "deduped",
        ]).gte("created_at", since10);
      const b = await supabase.from("forms_submit_attempts").select("id", {
        count: "exact",
        head: true,
      })
        .eq("ip_hash", ipHash).in("outcome", ["accepted", "deduped"]).gte(
          "created_at",
          since24,
        );
      if (a.error || b.error) return { form10m: PER_FORM_10MIN, ip24h: 0 }; // fail closed on the per-form limit
      return { form10m: a.count ?? 0, ip24h: b.count ?? 0 };
    },
    async recordAttempt(
      ipHash: string,
      formId: string | null,
      outcome: string,
    ) {
      const { error } = await supabase.from("forms_submit_attempts").insert({
        ip_hash: ipHash,
        form_id: formId,
        outcome,
      });
      if (error) {
        console.error(`[forms-submit] attempt_write_failed outcome=${outcome}`);
      }
    },
    async submitCore(payload: Record<string, unknown>) {
      const { data, error } = await supabase.rpc("forms_submit_core", {
        p: payload,
      });
      if (error) throw new Error(String(error.message ?? "core_failed"));
      return data as Record<string, unknown>;
    },
    async setLeadEvent(submissionId: string, eventId: string) {
      const { error } = await supabase.rpc("forms_set_lead_event", {
        p_submission_id: submissionId,
        p_event_id: eventId,
      });
      if (error) {
        console.error(
          `[forms-submit] lead_event_write_failed sub=${submissionId}`,
        );
      }
    },
    async trackEvent(payload: Record<string, unknown>) {
      const { error } = await supabase.rpc("forms_track_event", { p: payload });
      if (error) throw new Error("track_failed");
    },
    async mintHandoff(
      submissionId: string,
      schedulerKey: string,
      payload: Record<string, unknown>,
    ) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-")
        .replace(/\//g, "_").replace(/=+$/g, "");
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const hash = Array.from(new Uint8Array(digest)).map((b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      const { error } = await supabase.from("booking_form_handoffs").insert({
        token_sha256: hash,
        form_submission_id: submissionId,
        scheduler_key: schedulerKey,
        payload,
        expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
      });
      if (error) {
        console.error(
          `[forms-submit] handoff_write_failed sub=${submissionId}`,
        );
        return null;
      }
      return token;
    },
  };
}

/** Only the names this function reads, each read statically (the env contract). */
function staticEnv(
  values: Record<string, string | undefined>,
): (n: string) => string | undefined {
  return (n) => values[n];
}

export async function handler(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  return await handleFormsRequest(req, {
    db: restSubmitDb(supabase),
    env: staticEnv({ FORMS_KILL_SWITCH: Deno.env.get("FORMS_KILL_SWITCH") }),
    waitUntil: typeof runtime?.waitUntil === "function"
      ? runtime.waitUntil.bind(runtime)
      : undefined,
    kickSender: async (runId: string) => {
      await fetch(`${url}/functions/v1/forms-automation-sender`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ run_id: runId }),
        signal: AbortSignal.timeout(15_000),
      });
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
