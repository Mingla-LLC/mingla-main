// ORCH-1045 [Business "Get Beta Access" lead-capture] — client submit transport.
//
// Thin, anon-safe POST to the public `beta-access-lead-submit` edge function.
// The marketing app has NO Supabase client (it carries no @supabase/supabase-js
// dependency and no other process.env usage), so this uses a raw `fetch` with
// the public anon key in the Authorization + apikey headers — NOT the JS client.
// The anon key is public by design: RLS denies anon SELECT and the edge fn
// re-validates + writes via the service role (I-1045-NO-SERVICE-KEY-CLIENT).
//
// Supabase Edge Functions invoke contract (COMMS-0003, docs cited):
//   POST https://<project-ref>.functions.supabase.co/<fn>
//     headers: Authorization: Bearer <anon>, apikey: <anon>, Content-Type: json
//   With verify_jwt=false the fn receives the request without rejecting on a
//   missing user JWT. Docs:
//     https://supabase.com/docs/guides/functions/auth
//     https://supabase.com/docs/reference/javascript/functions-invoke

export interface BetaAccessLeadInput {
  brandType: string; // one of the 7 stored values
  brandName: string; // trimmed
  contactName: string; // trimmed
  city: string; // trimmed
  email: string; // trimmed + lowercased
  consent: true; // must be true; UI guarantees it
  source: "organiser_marketing_nav" | "organiser_marketing_hero";
}

export type BetaAccessSubmitResult =
  | { ok: true; status: "created" | "already_on_list" }
  | { ok: false; error: "validation" | "rate_limited" | "server" | "network" };

// META-ORCH-1187 [Growth Analytics Hub] — beta-access conversion analytics.
import { captureMarketing } from "@/components/marketing/posthog-provider";

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function submitBetaAccessLead(
  input: BetaAccessLeadInput,
  signal?: AbortSignal,
): Promise<BetaAccessSubmitResult> {
  // Guard against a misconfigured deploy — surface as a (retryable) network
  // error rather than firing a request to an empty URL.
  if (!FUNCTIONS_URL || !ANON_KEY) {
    if (typeof console !== "undefined") {
      console.error(
        "[beta-access-submit] Missing NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL or " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY — see mingla-marketing/.env.example",
      );
    }
    return { ok: false, error: "network" };
  }

  let response: Response;
  try {
    response = await fetch(
      `${FUNCTIONS_URL.replace(/\/$/, "")}/beta-access-lead-submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ANON_KEY}`,
          "apikey": ANON_KEY,
        },
        body: JSON.stringify(input),
        signal,
      },
    );
  } catch {
    // Thrown fetch (offline, DNS, abort) → network.
    return { ok: false, error: "network" };
  }

  if (response.ok) {
    try {
      const body = await response.json() as {
        ok?: boolean;
        status?: "created" | "already_on_list";
      };
      if (body?.ok && (body.status === "created" || body.status === "already_on_list")) {
        // META-ORCH-1187 — conversion event on a successful beta-access POST.
        // Consent-gated no-op (PostHog opt-in) + never throws. `surface_role`
        // is organiser (the beta form is organiser-only — I-1045-ORGANISER-ONLY-CTA).
        captureMarketing("beta_access_submitted", {
          surface_role: "organiser",
          source: input.source,
          status: body.status,
        });
        return { ok: true, status: body.status };
      }
      // 200 but unexpected shape — treat as server error (no false success).
      return { ok: false, error: "server" };
    } catch {
      return { ok: false, error: "server" };
    }
  }

  if (response.status === 400) return { ok: false, error: "validation" };
  if (response.status === 429) return { ok: false, error: "rate_limited" };
  // 405 / 5xx / anything else → server.
  return { ok: false, error: "server" };
}
