// ORCH-0989 [Unified cover picker sheet] — Pexels CURATED browse proxy.
//
// Sibling of event-cover-pexels-search. The search fn (a) requires a query
// of length >= 2 and (b) hard-codes orientation=landscape — a param that the
// /v1/curated endpoint does NOT accept. So curated browse needs its own route.
//
// External-API contract (COMMS-0003 — docs cited inline):
//   - Endpoint:  GET https://api.pexels.com/v1/curated
//                https://www.pexels.com/api/documentation/#photos-curated
//   - Auth:      Authorization: <PEXELS_API_KEY> header; key SERVER-SIDE only.
//                https://www.pexels.com/api/documentation/#authorization
//   - Params:    page (default 1), per_page (default 15, max 80). NO query,
//                NO orientation (curated has no orientation filter).
//                https://www.pexels.com/api/documentation/#photos-curated
//   - Rate:      200 req/hour, 20,000/month. x-ratelimit-* headers surfaced.
//                https://www.pexels.com/api/documentation/#guidelines
//   - Attribution: credit photographer + link Pexels (handled client-side).
//
// Response shape is IDENTICAL to event-cover-pexels-search so the client
// PexelsCoverSearchPage type + searchPexelsEventCovers normalizer are reused.

// @ts-ignore - Deno ESM import
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type CuratedBody = {
  page?: unknown;
  perPage?: unknown;
};

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color?: string | null;
  alt?: string | null;
  src: {
    landscape?: string;
  };
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(Math.floor(numberValue), max));
};

export const normalizeCuratedRequest = (
  body: CuratedBody,
): { page: number; perPage: number } => ({
  // Mirror the search-fn clamps (page 1-50, perPage 6-20).
  page: clampInt(body.page, 1, 1, 50),
  perPage: clampInt(body.perPage, 15, 6, 20),
});

const rateLimitFromHeaders = (headers: Headers) => ({
  limit: Number.isFinite(Number(headers.get("x-ratelimit-limit")))
    ? Number(headers.get("x-ratelimit-limit"))
    : null,
  remaining: Number.isFinite(Number(headers.get("x-ratelimit-remaining")))
    ? Number(headers.get("x-ratelimit-remaining"))
    : null,
  reset: headers.get("x-ratelimit-reset"),
});

const requireUser = async (req: Request): Promise<Response | null> => {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: "auth_required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = tokenMatch[1];
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return jsonResponse({ error: "auth_required" }, 401);
  return null;
};

export const handleEventCoverPexelsCurated = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authError = await requireUser(req);
  if (authError !== null) return authError;

  const pexelsApiKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsApiKey) return jsonResponse({ error: "pexels_not_configured" }, 500);

  let body: CuratedBody;
  try {
    body = await req.json();
  } catch {
    // A browse call with no body is valid — default to page 1.
    body = {};
  }

  const normalized = normalizeCuratedRequest(body);
  // NOTE: no `query`, no `orientation` — /v1/curated accepts neither.
  const params = new URLSearchParams({
    page: String(normalized.page),
    per_page: String(normalized.perPage),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(`https://api.pexels.com/v1/curated?${params}`, {
      headers: { Authorization: pexelsApiKey },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return jsonResponse({ error: "pexels_unavailable" }, 502);
  }
  clearTimeout(timeoutId);

  const rateLimit = rateLimitFromHeaders(response.headers);
  if (response.status === 429) {
    return jsonResponse({ error: "pexels_rate_limited", rateLimit }, 429);
  }
  if (!response.ok) {
    return jsonResponse({ error: "pexels_unavailable", rateLimit }, 502);
  }

  const data = (await response.json()) as {
    photos?: PexelsPhoto[];
    next_page?: string;
  };
  const photos = Array.isArray(data.photos)
    ? data.photos
        .filter((photo) => typeof photo.src?.landscape === "string")
        .map((photo) => ({
          id: photo.id,
          provider: "pexels" as const,
          mediaUrl: photo.src.landscape as string,
          sourceUrl: photo.url,
          credit: photo.photographer,
          creditUrl: photo.photographer_url,
          alt: photo.alt ?? null,
          avgColor: photo.avg_color ?? null,
          width: photo.width,
          height: photo.height,
        }))
    : [];

  return jsonResponse({
    photos,
    page: normalized.page,
    nextPage: data.next_page ? normalized.page + 1 : null,
    rateLimit,
  });
};

if (import.meta.main) {
  serve(handleEventCoverPexelsCurated);
}
