/**
 * #4111 — public-brand-subscribe: "Stay in the loop" on a signed-out brand
 * page, or a Mingla Sites newsletter box. Double opt-in. verify_jwt = false.
 *
 * REQUEST  POST application/json
 * {
 *   brand_id?: uuid, brand_slug?: string,       // one of the two
 *   email: string,
 *   phone?: string (E.164), wants_sms?: boolean, // a text link is sent only with a phone,
 *                                                // and only while the brand's monthly
 *                                                // SMS cap has room
 *   hp?: string, t0: number,                     // honeypot + form-open ms epoch
 *   source?: "web"|"site", origin?: string,      // origin required for site (site id or host, ≤200)
 *   disclosure_text?: string, disclosure_version?: string,  // the consent words shown
 *   sms_disclosure_text?: string                 // the text-message consent words shown
 * }
 * RESPONSES (every one waits at least 600 ms)
 *   202 { status:"sent" }   identical whether the email has a Mingla account,
 *                           is new, was refused as automated / rate limited,
 *                           or names an unknown brand.
 *   400 { error:"invalid_input", field:"email"|"phone"|"brand"|"origin"|"json" }
 *   403 { error:"origin_not_allowed" } | 405 { error:"method_not_allowed" }
 * The confirm link opens public-brand-subscribe-confirm/{token} (72 h). On
 * confirm: a Mingla account email follows the brand (email channel on); any
 * other email joins the brand's contact book as a marketing-consented
 * subscriber with the exact disclosure recorded. Allowed origins:
 * _shared/brandEnquiry.ts.
 */
import {
  boundedText,
  clientIp,
  corsHeadersFor,
  DEFAULT_SMS_DISCLOSURE,
  DEFAULT_SUBSCRIBE_DISCLOSURE_VERSION,
  defaultSubscribeDisclosure,
  ipHash,
  isUuid,
  looksAutomated,
  normalizeEmail,
  normalizePhone,
  normalizeSiteOrigin,
  resolveAllowedOrigin,
  sha256Hex,
  subscribeConfirmEmail,
  subscribeConfirmSms,
} from "../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

const METHODS = "POST, OPTIONS";

export function createPublicBrandSubscribeHandler(deps: PublicEnquiryDeps) {
  return async function handle(req: Request): Promise<Response> {
    const started = deps.now();
    const origin = await resolveAllowedOrigin(req.headers.get("origin"), deps.originDeps);
    const cors = corsHeadersFor(origin, METHODS);
    const json = async (status: number, body: Record<string, unknown>): Promise<Response> => {
      await deps.sleepFloor(started);
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    };
    const sent = () => json(202, { status: "sent" });

    if (!origin.allowed) return json(403, { error: "origin_not_allowed" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    let input: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      input = parsed as Record<string, unknown>;
    } catch {
      return json(400, { error: "invalid_input", field: "json" });
    }
    if (looksAutomated(input.hp, input.t0, deps.now())) return sent();

    const email = normalizeEmail(input.email);
    if (!email) return json(400, { error: "invalid_input", field: "email" });
    const phone = normalizePhone(input.phone);
    if (phone === "invalid") return json(400, { error: "invalid_input", field: "phone" });
    const wantsSms = input.wants_sms === true && phone !== null;
    const source = input.source === "site" ? "site" : "web";
    const siteOrigin = source === "site" ? normalizeSiteOrigin(input.origin) : null;
    if (source === "site" && !siteOrigin) return json(400, { error: "invalid_input", field: "origin" });
    const brandId = isUuid(input.brand_id) ? input.brand_id : null;
    const brandSlug = typeof input.brand_slug === "string" && input.brand_slug.trim() !== ""
      ? input.brand_slug.trim().toLowerCase()
      : null;
    if (!brandId && !brandSlug) return json(400, { error: "invalid_input", field: "brand" });

    try {
      const brand = await deps.resolveBrand({ brandId, brandSlug });
      if (!brand) return sent();
      const emailToken = deps.makeToken();
      const smsToken = wantsSms ? deps.makeToken() : null;
      const { data, error } = await deps.rpc("issue_4111_create_subscribe_pending", {
        p_brand_id: brand.id,
        p_source: source,
        p_origin: siteOrigin,
        p_email: email,
        p_phone: phone,
        p_wants_sms: wantsSms,
        p_email_token_hash: await sha256Hex(emailToken),
        p_sms_token_hash: smsToken ? await sha256Hex(smsToken) : null,
        p_ip_hash: await ipHash(clientIp(req)),
        p_disclosure_text: boundedText(input.disclosure_text, 1, 2000) ?? defaultSubscribeDisclosure(brand.name),
        p_disclosure_version: boundedText(input.disclosure_version, 1, 80) ?? DEFAULT_SUBSCRIBE_DISCLOSURE_VERSION,
        p_sms_disclosure_text: wantsSms
          ? boundedText(input.sms_disclosure_text, 1, 2000) ?? DEFAULT_SMS_DISCLOSURE
          : null,
      });
      if (error) {
        deps.log("error", "[public-brand-subscribe] pending_failed", { code: error.code ?? null });
        return sent();
      }
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.status !== "created") return sent();

      const mail = await deps.sendEmail({
        to: email,
        ...subscribeConfirmEmail({ brandName: brand.name, token: emailToken }),
        idempotencyKey: `brand_subscribe_confirm:${String(result.pending_id ?? "")}`,
      });
      if (!mail.ok) {
        deps.log("error", "[public-brand-subscribe] confirm_email_failed", { error: mail.error ?? "unknown" });
      }
      if (result.send_sms === true && smsToken && phone) {
        const sms = await deps.sendSms({
          to: phone,
          brandName: brand.name,
          message: subscribeConfirmSms({ brandName: brand.name, token: smsToken }),
        });
        if (!sms.ok) {
          deps.log("error", "[public-brand-subscribe] confirm_sms_failed", { error: sms.error ?? "unknown" });
        }
      }
      return sent();
    } catch (err) {
      deps.log("error", "[public-brand-subscribe] failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return sent();
    }
  };
}
