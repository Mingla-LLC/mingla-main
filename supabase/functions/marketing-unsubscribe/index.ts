// ORCH-0815-B — Public one-click unsubscribe redirect for marketing emails.
//
// Mounted at `/unsubscribe/{signed_token}`. Verifies the HS256 signature
// on the token, decodes the payload, INSERTs a marketing_unsubscribes
// row (brand-scope by default, global on `?scope=global`), updates the
// related marketing_messages rows to status='unsubscribed', and renders
// a confirmation HTML page with an "Unsubscribe from all Mingla brands"
// escalation link.
//
// verify_jwt: false — public, anonymous, authenticated by the HS256
// signature on the token payload (server-side secret).
//
// Cross-references:
//   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §7.3
//   - Token signing: supabase/functions/_shared/marketingTokens.ts
//   - Phase A schema: supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import { verifyUnsubscribeToken } from "../_shared/marketingTokens.ts";
import { escapeHtml } from "../_shared/email/escape.ts";

// In-process 5-min brand-name cache (SPEC §7.3). Module-scope so it survives
// across requests within the same edge-function isolate. Cold-start clears it.
const BRAND_NAME_CACHE = new Map<string, { name: string; expiresAt: number }>();
const BRAND_NAME_TTL_MS = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return htmlError(
      "Unsupported request",
      "This unsubscribe link only accepts GET requests.",
      405,
    );
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const token = segments[segments.length - 1] ?? "";
  if (token.length === 0) {
    return htmlError(
      "Missing unsubscribe token",
      "This link appears to be missing its identifier.",
      400,
    );
  }

  // Verify HS256 signature + expiration via shared helper.
  let payload: Awaited<ReturnType<typeof verifyUnsubscribeToken>>;
  try {
    payload = await verifyUnsubscribeToken(token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason.startsWith("unsubscribe_token_secret_missing")) {
      // Operator misconfiguration — log loudly so it surfaces in
      // function logs, return a friendly 503.
      console.error("[marketing-unsubscribe]", reason);
      return htmlError(
        "Unsubscribe temporarily unavailable",
        "We couldn't process this unsubscribe right now. Please email " +
          "support@usemingla.com — we'll honour it within one business day.",
        503,
      );
    }
    return htmlError(
      "This unsubscribe link is invalid or expired",
      "Please email support@usemingla.com from the address you want " +
        "unsubscribed and we'll honour it manually.",
      400,
    );
  }

  // ?scope=global escalates from brand-scope to global suppression.
  const scopeParam = url.searchParams.get("scope");
  const scope: "brand" | "global" = scopeParam === "global" ? "global" : "brand";

  const supabase = serviceClient();

  // Insert suppression row. `ON CONFLICT DO NOTHING` is expressed as
  // `upsert({}, { onConflict: ... , ignoreDuplicates: true })` in
  // supabase-js. We use upsert with ignoreDuplicates so re-visiting the
  // link is idempotent.
  const insertRow: Record<string, unknown> = {
    contact_email: payload.recipient_email,
    channel: "email",
    scope,
    reason: "one_click_unsubscribe_link",
  };
  if (scope === "brand") insertRow.brand_id = payload.brand_id;

  // Upsert against the partial unique index uq_unsub_email_channel_scope
  // (contact_email, channel, scope, COALESCE(brand_id,...), COALESCE(account_id,...)).
  // supabase-js cannot target a partial index by name in upsert(), so we
  // do an INSERT and tolerate the conflict error code (Postgres 23505).
  const { error: insertErr } = await supabase
    .from("marketing_unsubscribes")
    .insert(insertRow);
  if (insertErr && !isUniqueViolation(insertErr)) {
    console.error(
      "[marketing-unsubscribe] insert failed",
      insertErr.message,
    );
    return htmlError(
      "Unsubscribe failed",
      "Something went wrong on our side. Email support@usemingla.com " +
        "and we'll honour your unsubscribe manually.",
      500,
    );
  }

  // Mark related message rows as unsubscribed (only the campaign+recipient
  // pair from the signed payload — we never widen).
  await supabase
    .from("marketing_messages")
    .update({ status: "unsubscribed" })
    .eq("campaign_id", payload.campaign_id)
    .eq("recipient_email", payload.recipient_email);

  // Look up brand name for the confirmation copy (5-min in-process cache).
  let brandName = "this brand";
  if (scope === "brand") {
    const cached = BRAND_NAME_CACHE.get(payload.brand_id);
    const now = Date.now();
    if (cached !== undefined && cached.expiresAt > now) {
      brandName = cached.name;
    } else {
      const { data: brandRow } = await supabase
        .from("brands")
        .select("name")
        .eq("id", payload.brand_id)
        .maybeSingle();
      if (brandRow !== null) {
        // brands.name is the canonical column; Brand.displayName is the
        // camelCased mobile-side mapping.
        brandName = (brandRow as { name?: string }).name ?? brandName;
      }
      BRAND_NAME_CACHE.set(payload.brand_id, {
        name: brandName,
        expiresAt: now + BRAND_NAME_TTL_MS,
      });
    }
  }

  return htmlConfirmation(scope, brandName, token);
});

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = err.message ?? "";
  return m.includes("duplicate key") || m.includes("unique constraint");
}

function htmlConfirmation(
  scope: "brand" | "global",
  brandName: string,
  token: string,
): Response {
  const safeBrand = escapeHtml(brandName);
  const safeToken = encodeURIComponent(token);
  const heading = scope === "global"
    ? "You've been removed from all Mingla brand emails."
    : `You won't receive marketing emails from ${safeBrand} anymore.`;
  const escalation = scope === "brand"
    ? `<p style="margin:16px 0 0 0;font-size:14px;">
        Want to opt out of every Mingla brand?
        <a href="/functions/v1/marketing-unsubscribe/${safeToken}?scope=global" style="color:#FF6B2C;">
          Unsubscribe from all Mingla brands
        </a>
      </p>`
    : "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Unsubscribed — Mingla</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F1115;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:16px;padding:28px;">
            <tr>
              <td>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1>
                <p style="margin:0;font-size:14px;line-height:1.55;color:#5B6172;">
                  Mingla honours unsubscribes across all your purchases from ${safeBrand}.
                  If this was a mistake, reply to your last ticket confirmation email and we'll restore your preferences.
                </p>
                ${escalation}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function htmlError(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} — Mingla</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F1115;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:16px;padding:28px;">
            <tr>
              <td>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;">${escapeHtml(title)}</h1>
                <p style="margin:0;font-size:14px;line-height:1.55;color:#5B6172;">${escapeHtml(body)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
