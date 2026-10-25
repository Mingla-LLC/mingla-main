/**
 * #4111 — public-brand-enquiry: a signed-out visitor (brand page on
 * host.usemingla.com, or a Mingla Sites contact form) messages a brand.
 * verify_jwt = false. Anonymous callers can never attach an order or booking.
 *
 * REQUEST  POST application/json
 * {
 *   brand_id?: uuid, brand_slug?: string,         // one of the two
 *   entry?: "brand_page"|"offering"|"cancel_page"|"site",   // default brand_page ("site" when source is site)
 *   context_kind?: "offering"|"venue"|"none",     // default none
 *   context_id?: uuid,                            // required unless context_kind is none
 *   reason: string,                               // reason key, e.g. "general_question", "website_contact"
 *   body: string,                                 // 10–2000 chars
 *   name: string,                                 // 1–80 chars
 *   email: string,
 *   phone?: string (E.164), ok_to_call?: boolean,  // ok_to_call only counts with a phone
 *   hp?: string,                                  // honeypot: must be empty
 *   t0: number,                                   // ms epoch when the form opened
 *   source?: "web"|"site",                        // default web
 *   origin?: string,                              // required for site: site id or host, ≤200 chars
 *   disclosure_text?: string, disclosure_version?: string  // what the form showed
 * }
 * Mingla Sites general contact form: { entry:"site", context_kind:"none",
 * source:"site", origin:"<site id or host>", reason:"website_contact", ... }.
 *
 * RESPONSES (every one waits at least 600 ms)
 *   202 { status:"sent", thread_url }   accepted — OR silently refused (honeypot,
 *                                       too fast, blocked, rate limited). The
 *                                       shape is identical; a refused request's
 *                                       thread_url leads nowhere.
 *   400 { error:"invalid_input", field }   field = brand|reason|body|name|email|phone|context|origin|json
 *   404 { error:"enquiries_unavailable" }  unknown brand, switch off, or no team to read it
 *   403 { error:"origin_not_allowed" }     browser Origin outside the allowlist
 *   405 { error:"method_not_allowed" }
 * Receipt email (with the /m/{token} link on host.usemingla.com) is sent to a
 * created enquiry's guest. Allowed origins: see _shared/brandEnquiry.ts header.
 */
import {
  boundedText,
  corsHeadersFor,
  defaultEnquiryDisclosure,
  DEFAULT_ENQUIRY_DISCLOSURE_VERSION,
  ipHash,
  clientIp,
  isUuid,
  looksAutomated,
  normalizeEmail,
  normalizePhone,
  normalizeSiteOrigin,
  receiptEmail,
  resolveAllowedOrigin,
  sha256Hex,
  threadUrl,
} from "../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

const METHODS = "POST, OPTIONS";
const ENTRIES = new Set(["brand_page", "offering", "cancel_page", "site"]);
const ANON_CONTEXTS = new Set(["offering", "venue", "none"]);

export function createPublicBrandEnquiryHandler(deps: PublicEnquiryDeps) {
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

    const token = deps.makeToken();
    const sent = () => json(202, { status: "sent", thread_url: threadUrl(token) });

    if (looksAutomated(input.hp, input.t0, deps.now())) return sent();

    const source = input.source === "site" ? "site" : "web";
    const siteOrigin = source === "site" ? normalizeSiteOrigin(input.origin) : null;
    if (source === "site" && !siteOrigin) return json(400, { error: "invalid_input", field: "origin" });
    const entry = typeof input.entry === "string" && ENTRIES.has(input.entry)
      ? input.entry
      : source === "site" ? "site" : "brand_page";
    if (entry === "site" && source !== "site") return json(400, { error: "invalid_input", field: "context" });
    const contextKind = typeof input.context_kind === "string" ? input.context_kind : "none";
    if (!ANON_CONTEXTS.has(contextKind)) return json(400, { error: "invalid_input", field: "context" });
    const contextId = contextKind === "none" ? null : input.context_id;
    if (contextKind !== "none" && !isUuid(contextId)) return json(400, { error: "invalid_input", field: "context" });
    const reason = typeof input.reason === "string" && /^[a-z_]{2,40}$/.test(input.reason) ? input.reason : null;
    if (!reason) return json(400, { error: "invalid_input", field: "reason" });
    const body = boundedText(input.body, 10, 2000);
    if (!body) return json(400, { error: "invalid_input", field: "body" });
    const name = boundedText(input.name, 1, 80);
    if (!name) return json(400, { error: "invalid_input", field: "name" });
    const email = normalizeEmail(input.email);
    if (!email) return json(400, { error: "invalid_input", field: "email" });
    const phone = normalizePhone(input.phone);
    if (phone === "invalid") return json(400, { error: "invalid_input", field: "phone" });
    const okToCall = input.ok_to_call === true && phone !== null;

    const brandId = isUuid(input.brand_id) ? input.brand_id : null;
    const brandSlug = typeof input.brand_slug === "string" && input.brand_slug.trim() !== ""
      ? input.brand_slug.trim().toLowerCase()
      : null;
    if (!brandId && !brandSlug) return json(400, { error: "invalid_input", field: "brand" });

    try {
      const brand = await deps.resolveBrand({ brandId, brandSlug });
      if (!brand) return json(404, { error: "enquiries_unavailable" });

      const moderation = await deps.moderate(`${name}\n${body}`);
      if (!moderation.checked) {
        deps.log("warn", "[public-brand-enquiry] moderation_unavailable", {
          failure: moderation.failure ?? "unknown",
        });
      }

      const disclosureText = boundedText(input.disclosure_text, 1, 2000) ??
        (source === "web" ? defaultEnquiryDisclosure(brand.name) : null);
      const disclosureVersion = boundedText(input.disclosure_version, 1, 80) ??
        (source === "web" ? DEFAULT_ENQUIRY_DISCLOSURE_VERSION : null);

      const { data, error } = await deps.rpc("issue_4111_create_web_enquiry", {
        p_brand_id: brand.id,
        p_source: source,
        p_origin: siteOrigin,
        p_entry: entry,
        p_context_kind: contextKind,
        p_context_id: contextId,
        p_reason: reason,
        p_body: body,
        p_name: name,
        p_email: email,
        p_phone: phone,
        p_ok_to_call: okToCall,
        p_ip_hash: await ipHash(clientIp(req)),
        p_spam_flag: moderation.flagged,
        p_moderation_categories: moderation.categories,
        p_token_hash: await sha256Hex(token),
        p_disclosure_text: disclosureText,
        p_disclosure_version: disclosureVersion,
      });
      if (error) {
        deps.log("error", "[public-brand-enquiry] create_failed", { code: error.code ?? null });
        return sent();
      }
      const result = (data ?? {}) as Record<string, unknown>;
      const status = String(result.status ?? "");
      if (status === "unavailable") return json(404, { error: "enquiries_unavailable" });
      if (status === "invalid_context") return json(400, { error: "invalid_input", field: "context" });
      if (status === "invalid") return json(400, { error: "invalid_input", field: "reason" });
      if (status !== "created") return sent(); // blocked | rate_limited → silent

      const receipt = receiptEmail({
        brandName: brand.name,
        guestName: name,
        topicLabel: String(result.topic_label ?? "your question"),
        message: body,
        token,
      });
      const mail = await deps.sendEmail({
        to: email,
        ...receipt,
        idempotencyKey: `brand_enquiry_receipt:${String(result.enquiry_id ?? "")}`,
      });
      if (!mail.ok) {
        deps.log("error", "[public-brand-enquiry] receipt_email_failed", { error: mail.error ?? "unknown" });
      }
      return sent();
    } catch (err) {
      deps.log("error", "[public-brand-enquiry] failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return sent();
    }
  };
}
