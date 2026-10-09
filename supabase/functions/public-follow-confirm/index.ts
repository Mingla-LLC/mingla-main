/**
 * #3682 Wave 2.5 — n1 confirm landing + POST mutation (n3).
 * GET never mutates (email scanners). POST writes brand_follows + sends n2 once.
 * verify_jwt: false — authenticated by HS256 web_follow:confirm token.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  hashWebFollowToken,
  verifyWebFollowEmailToken,
} from "../_shared/webFollowEmailTokens.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { resolveBrandPublicUrl } from "../_shared/brandPublicUrl.ts";
import { renderFollowConfirmedEmail } from "../_shared/email/followByEmailBodies.ts";
import { sendInviteEmail } from "../_shared/brandInviteEmail.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return htmlError("Unsupported request", "This link only accepts GET and POST.", 405);
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const token = segments[segments.length - 1] ?? "";
  if (token.length === 0 || token === "public-follow-confirm") {
    return htmlError("Missing token", "This link appears to be missing its identifier.", 400);
  }

  let payload: Awaited<ReturnType<typeof verifyWebFollowEmailToken>>;
  try {
    payload = await verifyWebFollowEmailToken(token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason.startsWith("marketing_token_secret_missing")) {
      return htmlError(
        "Follow link temporarily unavailable",
        "Please email support@usemingla.com.",
        503,
      );
    }
    if (reason.includes("expired")) {
      return htmlError(
        "This link has expired",
        "Follow again from their page on Mingla.",
        400,
      );
    }
    return htmlError(
      "This link is invalid or expired",
      "Follow again from their page on Mingla.",
      400,
    );
  }

  if (payload.kind !== "confirm") {
    return htmlError(
      "Wrong link",
      "This confirm link cannot finish an invite. Open the invite from your email.",
      400,
    );
  }

  const supabase = serviceClient();
  const { data: brandRow } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", payload.brand_id)
    .maybeSingle();
  const brandName = (brandRow?.name as string | null)?.trim() || "this brand";
  const brandSlug = (brandRow?.slug as string | null) ?? null;
  const brandUrl = resolveBrandPublicUrl({
    origin: PRODUCTION_BUSINESS_WEB_ORIGIN,
    slug: brandSlug,
  }) ?? PRODUCTION_BUSINESS_WEB_ORIGIN;

  if (req.method === "GET") {
    return htmlConfirm(brandName, token);
  }

  const tokenHash = await hashWebFollowToken(token);
  const { data: pending } = await supabase
    .from("brand_follow_email_pending")
    .select("id, consumed_at, expires_at, user_id, email_normalized")
    .eq("token_hash", tokenHash)
    .eq("kind", "confirm")
    .maybeSingle();

  if (!pending) {
    return htmlError(
      "This link is invalid or expired",
      "Follow again from their page on Mingla.",
      400,
    );
  }
  if (pending.consumed_at) {
    return htmlOk(
      `You now follow ${brandName}`,
      "We already confirmed this follow. We sent a confirmation to your inbox.",
      brandUrl,
    );
  }
  if (new Date(pending.expires_at as string).getTime() < Date.now()) {
    return htmlError(
      "This link has expired",
      `Follow ${brandName} again from their page.`,
      400,
    );
  }

  const userId = (pending.user_id as string | null) ?? payload.subject;
  const { error: followErr } = await supabase.rpc("biz_auto_follow_brand", {
    p_user_id: userId,
    p_brand_id: payload.brand_id,
    p_source: "web_email",
    p_order_id: null,
  });
  if (followErr) {
    console.error("[public-follow-confirm] follow failed", followErr.message);
    return htmlError(
      "Couldn't finish following",
      "Try again in a moment, or follow from the brand page on Mingla.",
      500,
    );
  }

  const { error: consumeErr, count: consumeCount } = await supabase
    .from("brand_follow_email_pending")
    .update({ consumed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", pending.id)
    .is("consumed_at", null);
  if (consumeErr) {
    console.error("[public-follow-confirm] consume failed", consumeErr.message);
    return htmlError(
      "Couldn't finish following",
      "Try again in a moment, or follow from the brand page on Mingla.",
      500,
    );
  }
  if ((consumeCount ?? 0) === 0) {
    return htmlOk(
      `You now follow ${brandName}`,
      "We already confirmed this follow.",
      brandUrl,
    );
  }

  // n2 — best-effort once the follow + consume landed.
  let n2Sent = false;
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const to = (pending.email_normalized as string | null) ?? "";
    if (apiKey.length > 0 && to.length > 0) {
      const rendered = renderFollowConfirmedEmail({ brandName, brandUrl });
      const safeBrand = brandName.replace(/[<>\r\n]/g, "").trim() || "Mingla";
      const from = safeBrand + " via Mingla <follow@usemingla.com>";
      const sent = await sendInviteEmail(apiKey, {
        from,
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      n2Sent = sent.ok === true;
      if (!sent.ok) {
        console.error(
          "[public-follow-confirm] n2 send failed (non-fatal)",
          sent.error ?? "unknown",
        );
      }
    }
  } catch (err) {
    console.error(
      "[public-follow-confirm] n2 send failed (non-fatal)",
      err instanceof Error ? err.message : String(err),
    );
  }

  return htmlOk(
    `You now follow ${brandName}`,
    n2Sent
      ? "We sent a confirmation to your inbox."
      : "You're following. A confirmation email may arrive shortly.",
    brandUrl,
  );
});

function htmlConfirm(brandName: string, token: string): Response {
  const safe = escapeHtml(brandName);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Follow ${safe}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F5F5F7;color:#0F1115;">
  <main style="max-width:440px;margin:48px auto;padding:24px;background:#fff;border-radius:16px;">
    <h1 style="font-size:22px;line-height:28px;margin:0 0 8px 0;">Follow ${safe}?</h1>
    <p style="margin:0 0 20px 0;color:#5B6172;font-size:15px;line-height:22px;">One tap and you're following. You'll hear about new dates first.</p>
    <form method="POST" action="">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit" style="min-height:48px;padding:0 24px;border:0;border-radius:999px;background:#C4471A;color:#fff;font-weight:700;font-size:16px;cursor:pointer;">Yes, follow ${safe}</button>
    </form>
  </main>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: { ...ticketCorsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function htmlOk(title: string, body: string, brandUrl: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F5F5F7;color:#0F1115;">
  <main style="max-width:440px;margin:48px auto;padding:24px;background:#fff;border-radius:16px;">
    <h1 style="font-size:22px;line-height:28px;margin:0 0 8px 0;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 20px 0;color:#5B6172;font-size:15px;line-height:22px;">${escapeHtml(body)}</p>
    <p><a href="${escapeHtml(brandUrl)}" style="color:#C4471A;font-weight:700;">See their next event</a></p>
  </main>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { ...ticketCorsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function htmlError(title: string, body: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family:sans-serif;padding:24px;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}
