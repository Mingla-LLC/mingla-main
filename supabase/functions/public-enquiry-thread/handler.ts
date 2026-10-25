/**
 * #4111 — public-enquiry-thread: the signed-out guest's conversation page
 * (https://host.usemingla.com/m/{token}). verify_jwt = false; the capability
 * is the 32-byte token from the guest's email (only its SHA-256 is stored).
 * The first valid GET confirms the guest's email. Every valid use rolls the
 * token's 90-day expiry forward.
 *
 * GET ?token=<token>
 *   200 { status:"ok", brand:{ name, slug, logo_url, accent }, topic_label,
 *         enquiry_status:"new"|"waiting"|"replied"|"resolved", channel_label,
 *         messages:[{ who:"guest"|"brand"|"system", display, body, at }] }
 *       (brand messages show "{first name} at {Brand}" — never a team email)
 *   410 { error:"expired" }   → offer "Email me a new link"
 *   404 { error:"invalid" }
 * POST { token, body, hp? }            guest writes again (status → waiting, team pushed)
 *   202 { status:"sent" }   (also the silent answer for a filled honeypot or a blocked sender)
 *   400 { error:"invalid_input", field:"body" }   body 1–2000 chars
 *   410 { error:"expired" } | 404 { error:"invalid" } | 429 { error:"rate_limited" }
 * POST { action:"new_link", email, enquiry_id? }   "Email me a new link"
 *   202 { status:"sent" }   always, whether or not the email owns an enquiry
 * Every response waits at least 600 ms. Allowed origins: _shared/brandEnquiry.ts.
 */
import {
  boundedText,
  clientIp,
  corsHeadersFor,
  ipHash,
  isGuestToken,
  isUuid,
  newLinkEmail,
  normalizeEmail,
  resolveAllowedOrigin,
  sha256Hex,
} from "../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

const METHODS = "GET, POST, OPTIONS";

interface ThreadJson {
  status?: string;
  enquiry?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
}

export function guestThreadView(raw: ThreadJson): Record<string, unknown> {
  const enquiry = raw.enquiry ?? {};
  return {
    status: "ok",
    brand: {
      name: enquiry.brand_name ?? null,
      slug: enquiry.brand_slug ?? null,
      logo_url: enquiry.brand_logo_url ?? null,
      accent: enquiry.brand_accent ?? null,
    },
    topic_label: enquiry.topic_label ?? null,
    enquiry_status: enquiry.status ?? null,
    channel_label: enquiry.channel_label ?? null,
    messages: (raw.messages ?? []).map((message) => ({
      who: message.who === "guest" || message.who === "system" ? message.who : "brand",
      display: typeof message.display === "string" ? message.display : "",
      body: typeof message.body === "string" ? message.body : "",
      at: message.at ?? null,
    })),
  };
}

export function createPublicEnquiryThreadHandler(deps: PublicEnquiryDeps) {
  return async function handle(req: Request): Promise<Response> {
    const started = deps.now();
    const origin = await resolveAllowedOrigin(req.headers.get("origin"), deps.originDeps);
    const cors = corsHeadersFor(origin, METHODS);
    const json = async (status: number, body: Record<string, unknown>): Promise<Response> => {
      await deps.sleepFloor(started);
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    };
    if (!origin.allowed) return json(403, { error: "origin_not_allowed" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method === "GET") {
        const token = new URL(req.url).searchParams.get("token") ?? "";
        if (!isGuestToken(token)) return json(404, { error: "invalid" });
        const { data, error } = await deps.rpc("issue_4111_thread_by_token", {
          p_token_hash: await sha256Hex(token),
        });
        if (error) {
          deps.log("error", "[public-enquiry-thread] read_failed", { code: error.code ?? null });
          return json(503, { error: "unavailable" });
        }
        const result = (data ?? {}) as ThreadJson;
        if (result.status === "expired") return json(410, { error: "expired" });
        if (result.status !== "ok") return json(404, { error: "invalid" });
        return json(200, guestThreadView(result));
      }

      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      let input: Record<string, unknown>;
      try {
        const parsed = await req.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
        input = parsed as Record<string, unknown>;
      } catch {
        return json(400, { error: "invalid_input", field: "json" });
      }

      if (input.action === "new_link" || (input.token === undefined && input.email !== undefined)) {
        const email = normalizeEmail(input.email);
        const enquiryId = isUuid(input.enquiry_id) ? input.enquiry_id : null;
        if (email) {
          const token = deps.makeToken();
          const { data, error } = await deps.rpc("issue_4111_reissue_link", {
            p_email: email,
            p_enquiry_id: enquiryId,
            p_token_hash: await sha256Hex(token),
            p_ip_hash: await ipHash(clientIp(req)),
          });
          const result = (data ?? {}) as Record<string, unknown>;
          if (error) {
            deps.log("error", "[public-enquiry-thread] reissue_failed", { code: error.code ?? null });
          } else if (result.status === "issued") {
            const mail = await deps.sendEmail({
              to: String(result.guest_email ?? email),
              ...newLinkEmail({
                brandName: String(result.brand_name ?? "the brand"),
                guestName: String(result.guest_name ?? "there"),
                token,
              }),
            });
            if (!mail.ok) {
              deps.log("error", "[public-enquiry-thread] new_link_email_failed", { error: mail.error ?? "unknown" });
            }
          }
        }
        return json(202, { status: "sent" });
      }

      const token = input.token;
      if (!isGuestToken(token)) return json(404, { error: "invalid" });
      if (typeof input.hp === "string" && input.hp.trim() !== "") return json(202, { status: "sent" });
      const body = boundedText(input.body, 1, 2000);
      if (!body) return json(400, { error: "invalid_input", field: "body" });
      const { data, error } = await deps.rpc("issue_4111_guest_post_by_token", {
        p_token_hash: await sha256Hex(token),
        p_body: body,
        p_ip_hash: await ipHash(clientIp(req)),
      });
      if (error) {
        deps.log("error", "[public-enquiry-thread] post_failed", { code: error.code ?? null });
        return json(503, { error: "unavailable" });
      }
      const status = String(((data ?? {}) as Record<string, unknown>).status ?? "");
      if (status === "sent" || status === "blocked") return json(202, { status: "sent" });
      if (status === "expired") return json(410, { error: "expired" });
      if (status === "rate_limited") return json(429, { error: "rate_limited" });
      if (status === "invalid_message") return json(400, { error: "invalid_input", field: "body" });
      return json(404, { error: "invalid" });
    } catch (err) {
      deps.log("error", "[public-enquiry-thread] failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return json(503, { error: "unavailable" });
    }
  };
}
