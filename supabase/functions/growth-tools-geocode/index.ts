// ISSUE-1096 [Event Turnout Predictor] — city autocomplete proxy.
//
// PUBLIC edge function (verify_jwt=false). The events intake city field is a
// validated typeahead: this proxies Mapbox Search Box /forward (server-side, so
// the MAPBOX_ACCESS_TOKEN secret never ships to the browser) and returns real
// city candidates. Cities/towns only (types=place,locality). No DB access.
//
//   POST {q} → 200 {cities:[{label, city, region, country}]}
//   → 400 {error:"validation"} | 502 {error:"geocode_unavailable"} | 500 server
//   OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Geocoding v6 forward (NOT Search Box /forward) — it supports autocomplete=true,
// so a partial query like "lond" resolves to "London".
const MAPBOX_FORWARD = "https://api.mapbox.com/search/geocode/v6/forward";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface CityHit {
  label: string;
  city: string;
  region: string;
  country: string;
}

interface MapboxFeature {
  properties?: {
    name?: string;
    place_formatted?: string;
    context?: {
      region?: { name?: string };
      country?: { name?: string };
    };
  };
}

function toCity(f: MapboxFeature): CityHit | null {
  const p = f.properties ?? {};
  const city = asStr(p.name).trim();
  if (city.length === 0) return null;
  const region = asStr(p.context?.region?.name).trim();
  const country = asStr(p.context?.country?.name).trim();
  // Prefer the API's own formatted context ("Region, Country") for the label.
  const tail = asStr(p.place_formatted).trim() ||
    [region, country].filter(Boolean).join(", ");
  const label = tail ? `${city}, ${tail}` : city;
  return { label: label.slice(0, 120), city: city.slice(0, 80), region, country };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let q: string;
  try {
    const body = await req.json();
    q = asStr((body as Record<string, unknown>)?.q).trim();
  } catch {
    return json({ error: "validation" }, 400);
  }
  if (q.length < 2 || q.length > 80) return json({ error: "validation" }, 400);

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
  if (!token) {
    console.error("[growth-tools-geocode] MAPBOX_ACCESS_TOKEN missing");
    return json({ error: "geocode_unavailable" }, 502);
  }

  const url = `${MAPBOX_FORWARD}?q=${encodeURIComponent(q)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&types=place,locality&autocomplete=true&limit=6&language=en`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET" });
  } catch (e) {
    console.warn("[growth-tools-geocode] fetch error", String(e));
    return json({ error: "geocode_unavailable" }, 502);
  }
  if (!upstream.ok) {
    console.warn("[growth-tools-geocode] non-OK", upstream.status);
    return json({ error: "geocode_unavailable" }, 502);
  }

  let data: { features?: MapboxFeature[] };
  try {
    data = await upstream.json() as { features?: MapboxFeature[] };
  } catch {
    return json({ error: "geocode_unavailable" }, 502);
  }

  const seen = new Set<string>();
  const cities: CityHit[] = [];
  for (const f of data.features ?? []) {
    const hit = toCity(f);
    if (!hit) continue;
    const key = hit.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(hit);
  }
  return json({ cities });
}

if (import.meta.main) {
  serve(handler);
}
