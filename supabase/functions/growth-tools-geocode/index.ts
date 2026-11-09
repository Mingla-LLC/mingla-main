// ISSUE-1096 [Event Turnout Predictor] — city autocomplete proxy.
//
// PUBLIC edge function (verify_jwt=false). The marketing growth tools' city
// field is a validated typeahead: this proxies Google Places Autocomplete (New)
// server-side (GOOGLE_MAPS_API_KEY never ships to the browser) and returns real
// city candidates. Cities/towns only. No DB access. Provider since #4334.
//
//   POST {q} → 200 {cities:[{label, city, region, country}]}
//   → 400 {error:"validation"} | 429 {error:"rate_limited"}
//   | 502 {error:"geocode_unavailable"}
//   OPTIONS → 200 "ok" + CORS
//
// Public and billed per request, so it is rate-limited per client IP
// (30 requests / 60 s, first `x-forwarded-for` hop). Every upstream failure is
// loud: Sentry + the api-health recorder (#4334, history trap #338).
// https://developers.google.com/maps/documentation/places/web-service/place-autocomplete

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { recordApiCall } from "../_shared/apiHealthLog.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";

export const GOOGLE_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
export const CITY_PRIMARY_TYPES = ["locality", "administrative_area_level_3"];
export const IP_RATE_LIMIT_MAX = 30;
const IP_RATE_LIMIT_WINDOW_MS = 60_000;
const TIMEOUT_MS = 6000;

const ipWindows = new Map<string, number[]>();

export function checkIpRateLimit(ip: string, now = Date.now()): boolean {
  const recent = (ipWindows.get(ip) ?? []).filter(
    (t) => now - t < IP_RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= IP_RATE_LIMIT_MAX) {
    ipWindows.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipWindows.set(ip, recent);
  return true;
}

/** Test-only. */
export function __resetIpRateLimitForTests(): void {
  ipWindows.clear();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(status === 200 ? { "Cache-Control": "public, max-age=300" } : {}),
    },
  });
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface CityHit {
  label: string;
  city: string;
  region: string;
  country: string;
}

interface Prediction {
  placePrediction?: {
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

/** `mainText` is the city; `secondaryText` is "<region>, <country>". */
export function toCity(p: Prediction): CityHit | null {
  const fmt = p.placePrediction?.structuredFormat;
  const city = asStr(fmt?.mainText?.text).trim();
  if (city.length === 0) return null;
  const tail = asStr(fmt?.secondaryText?.text).trim();
  const parts = tail.split(",").map((s) => s.trim()).filter(Boolean);
  const country = parts.length > 0 ? parts[parts.length - 1] : "";
  const region = parts.length > 1 ? parts.slice(0, -1).join(", ") : "";
  const label = tail ? `${city}, ${tail}` : city;
  return { label: label.slice(0, 120), city: city.slice(0, 80), region, country };
}

function unavailable(reason: string, ms: number, status?: number): Response {
  captureEdgeException(new Error(`growth-tools-geocode upstream failed: ${reason}`), {
    fn: "growth-tools-geocode",
    tags: { issue: "4334", code: "geocode_unavailable" },
    extra: { upstream_status: status ?? null },
  });
  void recordApiCall("google_places", false, ms, status, {
    code: "geocode_unavailable",
    text: reason,
  });
  return json({ error: "geocode_unavailable" }, 502);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!checkIpRateLimit(ip)) return json({ error: "rate_limited" }, 429);

  let q: string;
  try {
    const body = await req.json();
    q = asStr((body as Record<string, unknown>)?.q).trim();
  } catch {
    return json({ error: "validation" }, 400);
  }
  if (q.length < 2 || q.length > 80) return json({ error: "validation" }, 400);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!key) return unavailable("key_missing", 0);

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: q,
        languageCode: "en",
        includeQueryPredictions: false,
        includedPrimaryTypes: CITY_PRIMARY_TYPES,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return unavailable("fetch_exception", Date.now() - t0);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return unavailable(`http_${upstream.status}`, Date.now() - t0, upstream.status);
  }

  let data: { suggestions?: Prediction[] };
  try {
    data = await upstream.json() as { suggestions?: Prediction[] };
  } catch {
    return unavailable("unreadable_body", Date.now() - t0, upstream.status);
  }
  void recordApiCall("google_places", true, Date.now() - t0, upstream.status);

  const seen = new Set<string>();
  const cities: CityHit[] = [];
  for (const s of data.suggestions ?? []) {
    const hit = toCity(s);
    if (!hit) continue;
    const k = hit.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cities.push(hit);
  }
  return json({ cities });
}

if (import.meta.main) {
  serve(handler);
}
