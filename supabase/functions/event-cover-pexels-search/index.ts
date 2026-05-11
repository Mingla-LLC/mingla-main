// @ts-ignore - Deno ESM import
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SearchBody = {
  query?: unknown;
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

export const normalizeSearchRequest = (
  body: SearchBody,
): { ok: true; query: string; page: number; perPage: number } | { ok: false } => {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 80) return { ok: false };
  return {
    ok: true,
    query,
    page: clampInt(body.page, 1, 1, 50),
    perPage: clampInt(body.perPage, 12, 6, 20),
  };
};

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

export const handleEventCoverPexelsSearch = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authError = await requireUser(req);
  if (authError !== null) return authError;

  const pexelsApiKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsApiKey) return jsonResponse({ error: "pexels_not_configured" }, 500);

  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_query", detail: "invalid_json" }, 400);
  }

  const normalized = normalizeSearchRequest(body);
  if (!normalized.ok) {
    return jsonResponse({ error: "invalid_query" }, 400);
  }
  const params = new URLSearchParams({
    query: normalized.query,
    orientation: "landscape",
    page: String(normalized.page),
    per_page: String(normalized.perPage),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
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
  serve(handleEventCoverPexelsSearch);
}
