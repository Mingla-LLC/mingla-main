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
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { isGuestToken, sha256Hex } from "../_shared/brandEnquiry.ts";
import {
  LANDING_PAGE_HEADERS,
  landingLink,
  landingPostButton,
  renderLandingPage,
} from "../_shared/email/landingPage.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

type ConfirmDeps = Pick<PublicEnquiryDeps, "rpc" | "log">;

function page(title: string, body: string, actionHtml = "", status = 200): Response {
  return new Response(renderLandingPage({ title, body, actionHtml }), {
    status,
    headers: LANDING_PAGE_HEADERS,
  });
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
        landingPostButton("Yes, keep me posted"),
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
    const link = landingLink("See what's coming up", brandLink(result.brand_slug));
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
