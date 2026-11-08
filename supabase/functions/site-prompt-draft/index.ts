// #4339 §5 — "Prompt your website into existence" → Ari: the public draft store.
//
// PUBLIC edge function (verify_jwt=false, function-policy.json). The marketing
// page on usemingla.com/host posts the visitor's description here when they tap
// Generate. The description is stored server-side for 24 hours and the answer
// is ONLY its opaque id; the id (never the description) travels to host web as
// /ari?draft=<id>, where the signed-in host claims it once
// (public.claim_site_prompt_draft) and Ari builds from it.
//
//   POST {description} → 201 {draft_id}
//   → 400 {error:"validation"} | 403 {error:"origin"} | 405 | 413 {error:"too_large"}
//   → 429 {error:"rate_limited"} | 503 {error:"busy"|"unavailable"}
//   OPTIONS → 204 + CORS for an allowed origin
//
// Abuse protection, reusing the growth-tools pattern (growth-tools-run):
//   - the browser Origin must be usemingla.com, a subdomain, a *.vercel.app
//     preview, or localhost (local development); anything else is 403;
//   - the description is 12..1,000 characters and the request body is capped;
//   - a salted SHA-256 of the first X-Forwarded-For hop (raw IP never stored)
//     limits a visitor to 20 drafts per 24 hours, and a global ceiling of 2,000
//     drafts an hour guards against floods — both enforced in SQL
//     (public.site_prompt_draft_create);
//   - the database is reached as service_role only; the table has no anon or
//     authenticated access at all.
// No Turnstile: it would need a new secret, and this endpoint stores at most
// 1 KB per draft for 24 hours behind the ceilings above.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const MIN_DESCRIPTION = 12;
export const MAX_DESCRIPTION = 1000;
/** Request bodies above this are refused before parsing. */
export const MAX_BODY_BYTES = 8 * 1024;
const IP_SALT = "mingla-site-prompt";

const BASE_CORS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

/**
 * The allowed browser origin, or null. https usemingla.com (or a subdomain) or
 * a *.vercel.app preview; http(s) localhost / 127.0.0.1 for local development.
 */
export function allowedOrigin(raw: string | null): string | null {
  if (!raw || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== raw) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  }
  if (url.protocol !== "https:") return null;
  const ok = host === "usemingla.com" || host.endsWith(".usemingla.com") ||
    host.endsWith(".vercel.app");
  return ok ? url.origin : null;
}

export function firstForwardedHop(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** sha256(ip + salt) hex. The raw IP is never stored. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}${IP_SALT}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The description as stored: trimmed, 12..1,000 characters, else null. */
export function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  const length = [...value].length;
  if (length < MIN_DESCRIPTION || length > MAX_DESCRIPTION) return null;
  return value;
}

export type CreateDraft = (
  body: string,
  ipHash: string | null,
) => Promise<{ status: string; id?: string } | null>;

/** The real store: one service-role RPC. Null when the call itself failed. */
export function serviceCreateDraft(): CreateDraft {
  return async (body, ipHash) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) {
      console.error("[site-prompt-draft] service credentials missing");
      return null;
    }
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("site_prompt_draft_create", {
      p_body: body,
      p_ip_hash: ipHash,
    });
    if (error) {
      console.error("[site-prompt-draft] create failed", error.message);
      return null;
    }
    return data as { status: string; id?: string } | null;
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
  req: Request,
  createDraft: CreateDraft = serviceCreateDraft(),
): Promise<Response> {
  const origin = allowedOrigin(req.headers.get("origin"));
  const cors: Record<string, string> = origin
    ? { ...BASE_CORS, "Access-Control-Allow-Origin": origin }
    : { ...BASE_CORS };
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: origin ? 204 : 403, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!origin) return json({ error: "origin" }, 403);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ error: "validation" }, 400);
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "validation" }, 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json({ error: "validation" }, 400);
  }
  const description = normalizeDescription(
    (parsed as Record<string, unknown>).description,
  );
  if (description === null) return json({ error: "validation" }, 400);

  const ip = firstForwardedHop(req.headers.get("x-forwarded-for"));
  const ipHash = ip ? await hashIp(ip) : null;

  const result = await createDraft(description, ipHash);
  if (result === null) return json({ error: "unavailable" }, 503);
  switch (result.status) {
    case "created":
      if (typeof result.id !== "string" || !UUID_RE.test(result.id)) {
        console.error("[site-prompt-draft] create returned no id");
        return json({ error: "unavailable" }, 503);
      }
      return json({ draft_id: result.id }, 201);
    case "invalid":
      return json({ error: "validation" }, 400);
    case "rate_limited":
      return json({ error: "rate_limited" }, 429);
    case "busy":
      return json({ error: "busy" }, 503);
    default:
      console.error("[site-prompt-draft] unknown create status", result.status);
      return json({ error: "unavailable" }, 503);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
