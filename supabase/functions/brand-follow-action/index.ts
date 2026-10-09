// #3682 Wave 2.4 — one-tap follow / unfollow from order confirmation emails.
//
// Mounted at `/functions/v1/brand-follow-action/{signed_token}`.
// verify_jwt: false — authenticated by HS256 token (BRAND_FOLLOW_TOKEN_SECRET
// or UNSUBSCRIBE_TOKEN_SECRET fallback).
//
// GET never mutates: scanners and link-preview fetchers open email links.
// Mutation runs only on an explicit POST from the confirmation form.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  verifyBrandFollowToken,
  type BrandFollowTokenPayload,
} from "../_shared/brandFollowTokens.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  PRODUCTION_BUSINESS_WEB_ORIGIN,
} from "../_shared/businessWebOrigin.ts";
import { resolveBrandPublicUrl } from "../_shared/brandPublicUrl.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return htmlError(
      "Unsupported request",
      "This follow link only accepts GET and POST requests.",
      405,
    );
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const token = segments[segments.length - 1] ?? "";
  if (token.length === 0 || token === "brand-follow-action") {
    return htmlError(
      "Missing follow token",
      "This link appears to be missing its identifier.",
      400,
    );
  }

  let payload: BrandFollowTokenPayload;
  try {
    payload = await verifyBrandFollowToken(token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason.startsWith("marketing_token_secret_missing")) {
      console.error("[brand-follow-action]", reason);
      return htmlError(
        "Follow link temporarily unavailable",
        "Please email support@usemingla.com and we'll honour it within one business day.",
        503,
      );
    }
    if (reason.includes("expired")) {
      return htmlError(
        "This link has expired",
        "Open the brand on Mingla to change what you get.",
        400,
      );
    }
    return htmlError(
      "This follow link is invalid or expired",
      "Please email support@usemingla.com from the address on your tickets.",
      400,
    );
  }

  const supabase = serviceClient();
  const { data: brandRow } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", payload.brand_id)
    .maybeSingle();
  const brandName = (brandRow?.name as string | null | undefined)?.trim() ||
    "this brand";
  const brandSlug = (brandRow?.slug as string | null | undefined) ?? null;
  const brandUrl = resolveBrandPublicUrl({
    origin: PRODUCTION_BUSINESS_WEB_ORIGIN,
    slug: brandSlug,
  }) ?? PRODUCTION_BUSINESS_WEB_ORIGIN;

  // GET: confirm only — no brand_follows write/delete (email scanners).
  if (req.method === "GET") {
    return htmlConfirm(payload.action, brandName, token);
  }

  if (payload.action === "unfollow") {
    const { error } = await supabase
      .from("brand_follows")
      .delete()
      .eq("user_id", payload.user_id)
      .eq("brand_id", payload.brand_id);
    if (error) {
      console.error("[brand-follow-action] unfollow failed", error.message);
      return htmlError(
        "Couldn't unfollow right now",
        "Try again in a moment, or unfollow from the brand page on Mingla.",
        500,
      );
    }
    return htmlOk(
      `You've unfollowed ${brandName}`,
      "Your tickets and reminders still arrive.",
      brandUrl,
      "Follow again",
    );
  }

  // follow
  const { error: followErr } = await supabase.from("brand_follows").upsert(
    {
      user_id: payload.user_id,
      brand_id: payload.brand_id,
      source: "web_email",
    },
    { onConflict: "user_id,brand_id", ignoreDuplicates: true },
  );
  if (followErr) {
    console.error("[brand-follow-action] follow failed", followErr.message);
    return htmlError(
      "Couldn't follow right now",
      "Try again from the brand page on Mingla.",
      500,
    );
  }
  return htmlOk(
    `You're following ${brandName}`,
    "New dates and offers first.",
    brandUrl,
    `Open ${brandName}`,
  );
});

function htmlConfirm(
  action: BrandFollowTokenPayload["action"],
  brandName: string,
  token: string,
): Response {
  const safeBrand = escapeHtml(brandName);
  const safeToken = encodeURIComponent(token);
  const isUnfollow = action === "unfollow";
  const title = isUnfollow
    ? `Unfollow ${safeBrand}?`
    : `Follow ${safeBrand}?`;
  const body = isUnfollow
    ? "Confirm to stop getting new dates and offers from this brand. Your tickets and reminders still arrive."
    : "Confirm to hear about new dates and offers first.";
  const button = isUnfollow ? "Yes, unfollow" : "Yes, follow";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title} — Mingla</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F1115;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:16px;padding:28px;">
            <tr>
              <td>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;">${title}</h1>
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#5B6172;">${escapeHtml(body)}</p>
                <form method="POST" action="/functions/v1/brand-follow-action/${safeToken}">
                  <button type="submit" style="display:inline-block;background:#c2560f;color:#FFFFFF;border:0;font-weight:700;font-size:14px;padding:12px 18px;border-radius:12px;cursor:pointer;">${escapeHtml(button)}</button>
                </form>
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

function htmlOk(
  title: string,
  body: string,
  ctaUrl: string,
  ctaLabel: string,
): Response {
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
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#5B6172;">${escapeHtml(body)}</p>
                <p style="margin:0;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#c2560f;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
                </p>
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
