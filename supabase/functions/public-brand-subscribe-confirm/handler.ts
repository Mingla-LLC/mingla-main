/**
 * #4111 — public-brand-subscribe-confirm: the link in the subscribe email or
 * text. Mirrors public-follow-confirm: GET never mutates (mail scanners open
 * links); the person's tap POSTs. verify_jwt = false; the token is the
 * capability (its SHA-256 is stored, valid 72 h).
 *
 * GET  /public-brand-subscribe-confirm/{token}
 *   200 text/html  "Get news from {Brand}?" with a confirm button (form POST)
 * POST /public-brand-subscribe-confirm/{token}   (form post from that page), or
 * POST /public-brand-subscribe-confirm  { token }  with Content-Type application/json
 *   JSON callers: 200 { status:"confirmed"|"already", channel:"email"|"sms",
 *                       outcome:"followed"|"subscribed", brand_name, brand_slug }
 *                 410 { status:"expired", brand_name, brand_slug }
 *                 404 { status:"invalid" }
 *   HTML callers: the same outcomes as a small brand-neutral page.
 */
import { escapeHtml } from "../_shared/email/escape.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { isGuestToken, sha256Hex } from "../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

type ConfirmDeps = Pick<PublicEnquiryDeps, "rpc" | "log">;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

function page(title: string, body: string, extra = "", status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F5F5F7;color:#0F1115;">
  <main style="max-width:440px;margin:48px auto;padding:24px;background:#fff;border-radius:16px;">
    <h1 style="font-size:22px;line-height:28px;margin:0 0 8px 0;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 20px 0;color:#5B6172;font-size:15px;line-height:22px;">${escapeHtml(body)}</p>
    ${extra}
  </main>
</body></html>`;
  return new Response(html, { status, headers: HTML_HEADERS });
}

function brandLink(slug: unknown): string {
  return typeof slug === "string" && slug
    ? `${PRODUCTION_BUSINESS_WEB_ORIGIN}/b/${encodeURIComponent(slug)}`
    : PRODUCTION_BUSINESS_WEB_ORIGIN;
}

export function createSubscribeConfirmHandler(deps: ConfirmDeps) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    let token = segments[segments.length - 1] ?? "";
    if (token === "public-brand-subscribe-confirm") token = "";
    const wantsJson = (req.headers.get("content-type") ?? "").includes("application/json") ||
      (req.headers.get("accept") ?? "").includes("application/json");

    if (req.method === "GET") {
      if (!isGuestToken(token)) return page("This link is not valid", "Subscribe again from the brand's page.", "", 404);
      return page(
        "Get news from this brand?",
        "One tap and you'll hear about new dates and offers. Unsubscribe any time.",
        `<form method="POST" action=""><button type="submit" style="min-height:48px;padding:0 24px;border:0;border-radius:999px;background:#C4471A;color:#fff;font-weight:700;font-size:16px;cursor:pointer;">Yes, keep me posted</button></form>`,
      );
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (wantsJson && !isGuestToken(token)) {
      try {
        const parsed = await req.json() as { token?: unknown };
        if (typeof parsed?.token === "string") token = parsed.token.trim();
      } catch {
        token = "";
      }
    }
    if (!isGuestToken(token)) {
      return wantsJson
        ? new Response(JSON.stringify({ status: "invalid" }), { status: 404, headers: { "Content-Type": "application/json" } })
        : page("This link is not valid", "Subscribe again from the brand's page.", "", 404);
    }

    const { data, error } = await deps.rpc("issue_4111_confirm_subscribe", {
      p_token_hash: await sha256Hex(token),
    });
    if (error) {
      deps.log("error", "[public-brand-subscribe-confirm] confirm_failed", { code: error.code ?? null });
      return wantsJson
        ? new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } })
        : page("Couldn't confirm just now", "Try the link again in a moment.", "", 503);
    }
    const result = (data ?? {}) as Record<string, unknown>;
    const status = String(result.status ?? "invalid");
    const httpStatus = status === "confirmed" || status === "already" ? 200 : status === "expired" ? 410 : 404;
    if (wantsJson) {
      return new Response(JSON.stringify({
        status,
        channel: result.channel ?? null,
        outcome: result.outcome ?? null,
        brand_name: result.brand_name ?? null,
        brand_slug: result.brand_slug ?? null,
      }), { status: httpStatus, headers: { "Content-Type": "application/json" } });
    }
    const brandName = typeof result.brand_name === "string" ? result.brand_name : "this brand";
    const link = `<p><a href="${escapeHtml(brandLink(result.brand_slug))}" style="color:#C4471A;font-weight:700;">See what's coming up</a></p>`;
    if (status === "confirmed" || status === "already") {
      return page(
        result.outcome === "followed" ? `You now follow ${brandName}` : `You're on ${brandName}'s list`,
        result.channel === "sms"
          ? `${brandName} can now text you news. Reply STOP to stop.`
          : `You'll get new dates and offers from ${brandName}. Unsubscribe any time.`,
        link,
      );
    }
    if (status === "expired") {
      return page("This link has expired", `Subscribe again from ${brandName}'s page.`, link, 410);
    }
    return page("This link is not valid", "Subscribe again from the brand's page.", "", 404);
  };
}
