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
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (platform; also the root the
// address-hash and code-digest salts are derived from, _shared/derivedSecret.ts).
// Wave 3's one-time code (./code.ts) reuses the existing email sender and SMS
// verify secrets that claim-contact (#4063) already uses. No new secret.
// Wave 5 review fix 1: the checkout form read hashes a private ticket link with
// the existing OFFERING_INVITE_TOKEN_PEPPER, exactly as ticket-checkout-create does.
// The link page's read ({op:"link_read"}, ./linkRead.ts) calls
// brand_form_my_response with the service role: that function is not anon-executable.
// #4541 R1.14: the RSVP page's read ({op:"page_form"}, ./pageForm.ts) calls
// public_brand_form_for_event the same way (service role only, no grant change).
// #4541 R8.4: the address is the platform-set one (_shared/platformClientIp.ts) and
// each request takes one atomic admission (brand_form_attempt_admit).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";
import type { CodeDeps } from "./code.ts";
import {
  checkVerification,
  startVerification,
} from "../_shared/twilioVerify.ts";
import { emailAdapter } from "../_shared/adapters/emailAdapter.ts";
import { renderContactCodeEmail } from "../_shared/email/contactCodeEmail.ts";
import { EMAIL_SENDERS } from "../_shared/email/senders.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { hashTicketLinkToken } from "../_shared/ticketLinkToken.ts";
import { resolveOfferingInviteTokenPepper } from "../_shared/offeringInviteToken.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export function restSubmitDb(supabase: Client): BrandFormSubmitDb {
  return {
    async switchedOff() {
      const { data, error } = await supabase.rpc("brand_forms_switched_off");
      if (error) throw new Error("switch_read_failed");
      return data === true;
    },
    async attemptAdmit(ipHash, formId, bucket) {
      // #4541 R8.4: one atomic count-and-record per request. Fail closed: an
      // admission error is treated as over the limit.
      const { data, error } = await supabase.rpc("brand_form_attempt_admit", {
        p_ip_hash: ipHash,
        p_form_id: formId,
        p_bucket: bucket,
      });
      if (error) {
        console.error(`[brand-form-submit] attempt_admit_failed bucket=${bucket}`);
        return { allowed: false };
      }
      return {
        allowed: !!data && typeof data === "object" &&
          (data as Record<string, unknown>).allowed === true,
      };
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
            code: typeof error.code === "string" ? error.code : null,
          }
          : null,
      };
    },
  };
}

/** Wave 3: the one-time code rails (the same ones claim-contact uses). */
export function restCodeDeps(supabase: Client): CodeDeps {
  return {
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name, args);
      return {
        data,
        error: error ? { message: String(error.message ?? "") } : null,
      };
    },
    async allow(scope, limit) {
      const { data, error } = await supabase.rpc(
        "pg_venue_order_rate_limit_hit",
        {
          p_scope_key: scope,
          p_limit: limit,
        },
      );
      if (error) return "unavailable";
      return data && typeof data === "object" &&
          (data as Record<string, unknown>).allowed === false
        ? "limited"
        : "allow";
    },
    async sendEmail(target, code, challengeId) {
      const rendered = renderContactCodeEmail({
        code,
        supportEmail: "support@usemingla.com",
        logoUrl: minglaLogoUrl(),
        footerAddress: "Mingla · support@usemingla.com",
        sender: EMAIL_SENDERS.noreply,
      });
      const result = await emailAdapter.send({
        to: target,
        title: rendered.subject,
        body: rendered.text,
        idempotencyKey: `brand-form-code:${challengeId}`,
        rendered,
      });
      return result.ok;
    },
    async startPhone(phone) {
      const result = await startVerification(phone);
      return result.ok ? { ok: true } : result;
    },
    async checkPhone(phone, code) {
      const result = await checkVerification(phone, code);
      return result.ok ? { ok: true, approved: result.approved } : result;
    },
  };
}

export async function handler(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return await handleBrandFormSubmit(req, {
    db: restSubmitDb(supabase),
    code: restCodeDeps(supabase),
    checkout: {
      async checkoutForm(eventId, buyerUserId, ticketLinkHash) {
        const { data, error } = await supabase.rpc("brand_form_checkout_form", {
          p_event_id: eventId,
          p_buyer_user_id: buyerUserId,
          p_ticket_link_hash: ticketLinkHash,
        });
        return {
          data,
          error: error ? { message: String(error.message ?? "") } : null,
        };
      },
      async hashTicketLink(token) {
        const pepper = await resolveOfferingInviteTokenPepper();
        return await hashTicketLinkToken(token, pepper.bytes);
      },
    },
    linkRead: {
      async myResponse(formId, token, challengeId) {
        const { data, error } = await supabase.rpc("brand_form_my_response", {
          p_form_id: formId,
          p_event_id: null,
          p_token: token,
          p_challenge_id: challengeId,
        });
        return {
          data,
          error: error ? { message: String(error.message ?? "") } : null,
        };
      },
    },
    page: {
      // #4541 R1.14: the RSVP page's form read, as the service role.
      async pageForm(eventId) {
        const { data, error } = await supabase.rpc("public_brand_form_for_event", {
          p_event_id: eventId,
        });
        return {
          data,
          error: error ? { message: String(error.message ?? "") } : null,
        };
      },
    },
    purchase: {
      async purchaseLink(checkoutSessionId, tokenHash) {
        const { data, error } = await supabase.rpc("brand_form_purchase_link", {
          p_checkout_session_id: checkoutSessionId,
          p_buyer_status_token_hash: tokenHash,
        });
        return {
          data,
          error: error ? { message: String(error.message ?? "") } : null,
        };
      },
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
