// #4111 — shared pieces of the public enquiry and subscribe edge functions:
// the allowed-origin decision (CORS), input validation, guest tokens, the
// response-time floor, and the plain-language emails.
//
// ALLOWED ORIGINS (one helper decides; resolveAllowedOrigin):
//   - no Origin header (server-to-server, e.g. a Sites server action): allowed,
//     no CORS headers are needed.
//   - https://host.usemingla.com and the mingla-business Vercel previews.
//   - https://<hostname> for an ACTIVE row in public.brand_site_hosts (the real
//     Mingla Sites brand domains, as the Sites control plane records them).
//   - http(s)://*.sites.localhost ONLY when brand_site_service_config has
//     environment = 'local'. That column lands later from the Sites branch;
//     until it exists the lookup errors and *.sites.localhost is DENIED.
//   - http://localhost:<port> / 127.0.0.1 only when this function runs on a
//     local Supabase stack (SUPABASE_URL is localhost / kong).
//   Anything else with an Origin header gets 403 and no CORS headers.

import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";

export const RESPONSE_FLOOR_MS = 600;
export const MIN_FILL_MS = 3_000;
export const TOKEN_BYTES = 32;

const VERCEL_PREVIEW_ORIGIN = /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9][0-9]{6,14}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OriginKind = "none" | "mingla" | "site" | "local_site" | "local_dev";

export interface OriginDecision {
  allowed: boolean;
  origin: string | null;
  kind: OriginKind | "denied";
}

export interface OriginDeps {
  /** true when brand_site_hosts has an active row for this exact hostname. */
  isActiveSiteHost(hostname: string): Promise<boolean>;
  /**
   * brand_site_service_config.environment, or null when the column (or the
   * row) does not exist yet. Only the exact value 'local' unlocks
   * *.sites.localhost.
   */
  sitesEnvironment(): Promise<string | null>;
  /** The function runs on a local Supabase stack. */
  localStack: boolean;
}

function parseOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.origin !== raw) return null; // no path, query, credentials
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

export async function resolveAllowedOrigin(
  rawOrigin: string | null,
  deps: OriginDeps,
): Promise<OriginDecision> {
  const raw = (rawOrigin ?? "").trim();
  if (raw === "" ) return { allowed: true, origin: null, kind: "none" };
  const url = parseOrigin(raw);
  if (!url) return { allowed: false, origin: null, kind: "denied" };
  const host = url.hostname.toLowerCase();

  if (raw === PRODUCTION_BUSINESS_WEB_ORIGIN || VERCEL_PREVIEW_ORIGIN.test(raw)) {
    return { allowed: true, origin: raw, kind: "mingla" };
  }
  if (host === "sites.localhost" || host.endsWith(".sites.localhost")) {
    let environment: string | null = null;
    try {
      environment = await deps.sitesEnvironment();
    } catch {
      environment = null;
    }
    return environment === "local"
      ? { allowed: true, origin: raw, kind: "local_site" }
      : { allowed: false, origin: null, kind: "denied" };
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return deps.localStack && url.protocol === "http:"
      ? { allowed: true, origin: raw, kind: "local_dev" }
      : { allowed: false, origin: null, kind: "denied" };
  }
  if (url.protocol === "https:" && url.port === "") {
    let active = false;
    try {
      active = await deps.isActiveSiteHost(host);
    } catch {
      active = false;
    }
    if (active) return { allowed: true, origin: raw, kind: "site" };
  }
  return { allowed: false, origin: null, kind: "denied" };
}

// deno-lint-ignore no-explicit-any
type ServiceLike = any;

/** Production origin lookups against the service-role client, cached 60 s. */
export function serviceOriginDeps(service: ServiceLike): OriginDeps {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let localStack = false;
  try {
    const h = new URL(supabaseUrl).hostname;
    localStack = h === "localhost" || h === "127.0.0.1" || h === "kong" ||
      h === "host.docker.internal";
  } catch {
    localStack = false;
  }
  return {
    localStack,
    async isActiveSiteHost(hostname: string): Promise<boolean> {
      const cached = hostCache.get(hostname);
      if (cached && cached.until > Date.now()) return cached.value;
      const { data, error } = await service
        .from("brand_site_hosts")
        .select("id")
        .eq("hostname", hostname)
        .eq("status", "active")
        .maybeSingle();
      const value = !error && !!data?.id;
      hostCache.set(hostname, { value, until: Date.now() + 60_000 });
      return value;
    },
    async sitesEnvironment(): Promise<string | null> {
      // Reads the column only if it exists: a missing column is an error
      // from PostgREST, which denies.
      const { data, error } = await service
        .from("brand_site_service_config")
        .select("environment")
        .eq("config_key", "sites_v1")
        .maybeSingle();
      if (error || !data) return null;
      return typeof data.environment === "string" ? data.environment : null;
    },
  };
}
const hostCache = new Map<string, { value: boolean; until: number }>();

export function corsHeadersFor(
  decision: OriginDecision,
  methods: string,
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (decision.allowed && decision.origin) {
    headers["Access-Control-Allow-Origin"] = decision.origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// ── validation ──────────────────────────────────────────────────────────
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizePhone(raw: unknown): string | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const phone = raw.replace(/[\s().-]/g, "");
  if (phone === "") return null;
  return E164_RE.test(phone) ? phone : "invalid";
}

export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw);
}

export function boundedText(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text.length >= min && text.length <= max ? text : null;
}

/** Origin string supplied by Mingla Sites (site id or host), ≤ 200 chars. */
export function normalizeSiteOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length >= 1 && value.length <= 200 && !/[\s<>]/.test(value)
    ? value
    : null;
}

/** Honeypot filled or form submitted faster than a person can. */
export function looksAutomated(hp: unknown, t0: unknown, nowMs: number): boolean {
  if (typeof hp === "string" && hp.trim() !== "") return true;
  if (hp !== undefined && hp !== null && typeof hp !== "string") return true;
  const opened = typeof t0 === "number" ? t0 : Number(t0);
  if (!Number.isFinite(opened) || opened <= 0) return true;
  return nowMs - opened < MIN_FILL_MS;
}

// ── tokens / hashing ────────────────────────────────────────────────────
export function makeGuestToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isGuestToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(raw);
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("cf-connecting-ip")?.trim() || null;
}

export async function ipHash(ip: string | null): Promise<string | null> {
  return ip ? await sha256Hex(`mingla-enquiry-ip:${ip}`) : null;
}

export async function sleepFloor(startedMs: number, floorMs = RESPONSE_FLOOR_MS): Promise<void> {
  const elapsed = Date.now() - startedMs;
  if (elapsed < floorMs) await new Promise((r) => setTimeout(r, floorMs - elapsed));
}

export function threadUrl(token: string): string {
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/m/${token}`;
}

export function subscribeConfirmUrl(token: string): string {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return supabaseUrl
    ? `${supabaseUrl}/functions/v1/public-brand-subscribe-confirm/${token}`
    : `${PRODUCTION_BUSINESS_WEB_ORIGIN}/subscribe/confirm/${token}`;
}

// ── emails (plain paragraphs; the email adapter wraps them in the shell) ─
export interface GuestEmail {
  title: string;
  body: string;
  cta: { label: string; url: string };
}

export function receiptEmail(input: {
  brandName: string;
  guestName: string;
  topicLabel: string;
  message: string;
  token: string;
}): GuestEmail {
  return {
    title: `Your message to ${input.brandName}`,
    body: [
      `Hi ${input.guestName},`,
      `${input.brandName} has your message about "${input.topicLabel}". When they reply, we will email you here and the reply will be waiting in your conversation.`,
      `You wrote: ${input.message.slice(0, 600)}`,
      `Mingla delivers your messages and only reads one if it is reported.`,
    ].join("\n\n"),
    cta: { label: "View conversation", url: threadUrl(input.token) },
  };
}

export function replyDigestEmail(input: {
  brandName: string;
  guestName: string;
  replies: Array<{ display: string; body: string }>;
  token: string;
}): GuestEmail {
  const lines = input.replies.slice(-5).map((reply) =>
    `${reply.display || input.brandName}: ${reply.body.slice(0, 800)}`
  );
  return {
    title: `${input.brandName} replied`,
    body: [
      `Hi ${input.guestName},`,
      ...lines,
      `Reply from your conversation page. Get replies instantly in the Mingla app.`,
    ].join("\n\n"),
    cta: { label: "Open conversation", url: threadUrl(input.token) },
  };
}

export function newLinkEmail(input: {
  brandName: string;
  guestName: string;
  token: string;
}): GuestEmail {
  return {
    title: `Your conversation with ${input.brandName}`,
    body: [
      `Hi ${input.guestName},`,
      `Here is a fresh link to your conversation with ${input.brandName}.`,
      `If you did not ask for this, you can ignore this email.`,
    ].join("\n\n"),
    cta: { label: "Open conversation", url: threadUrl(input.token) },
  };
}

export function subscribeConfirmEmail(input: { brandName: string; token: string }): GuestEmail {
  return {
    title: `Confirm: news from ${input.brandName}`,
    body: [
      `Tap the button to get new dates and offers from ${input.brandName} by email.`,
      `If you did not ask for this, ignore this email and nothing will happen.`,
    ].join("\n\n"),
    cta: { label: "Yes, keep me posted", url: subscribeConfirmUrl(input.token) },
  };
}

export function subscribeConfirmSms(input: { brandName: string; token: string }): string {
  return `Confirm texts from ${input.brandName} via Mingla: ${subscribeConfirmUrl(input.token)}`;
}

export const DEFAULT_ENQUIRY_DISCLOSURE_VERSION = "brand-page-enquiry-v1";
export function defaultEnquiryDisclosure(brandName: string): string {
  return `${brandName} will see your name and email. Mingla delivers your messages and only reads one if it's reported.`;
}

export const DEFAULT_SUBSCRIBE_DISCLOSURE_VERSION = "brand-page-subscribe-v1";
export function defaultSubscribeDisclosure(brandName: string): string {
  return `By subscribing you agree to get marketing from ${brandName} via Mingla. Unsubscribe any time.`;
}
export const DEFAULT_SMS_DISCLOSURE = "Also text me. Msg & data rates may apply. Reply STOP to stop.";
