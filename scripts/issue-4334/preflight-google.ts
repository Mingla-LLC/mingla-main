/**
 * #4334 spec v2 §2 step 4 — read-only preflight of the four Google endpoints
 * the product calls, against the key in GOOGLE_MAPS_API_KEY:
 * one Autocomplete (New), one Place Details (New), one Geocoding, one 1×1
 * Static map. Every verdict is a BODY verdict (the same rules as the
 * api-health probes), so HTTP 200 + REQUEST_DENIED or an error image fails.
 *
 *   GOOGLE_MAPS_API_KEY=… deno run --allow-env --allow-net scripts/issue-4334/preflight-google.ts
 *
 * Exit 0 only when all four pass. The key is never printed. The PR may not
 * merge until this prints four passes (spec v2 §2).
 */

import {
  GOOGLE_PROBE_URLS,
  googleAutocompleteProbeOk,
  googleGeocodingProbeOk,
  googlePlaceDetailsProbeOk,
  googleStaticProbeOk,
} from "../../supabase/functions/api-health-probe/logic.ts";

export interface PreflightRow {
  api: string;
  httpStatus: number | null;
  ok: boolean;
  detail: string | null;
}

export async function preflight(
  apiKey: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<PreflightRow[]> {
  const rows: PreflightRow[] = [];
  const attempt = async (api: string, call: () => Promise<PreflightRow>) => {
    try {
      rows.push(await call());
    } catch (e) {
      rows.push({ api, httpStatus: null, ok: false, detail: e instanceof Error ? e.name : "error" });
    }
  };
  const errStatus = (b: unknown) =>
    (b as { error?: { status?: string }; status?: string } | null)?.error?.status ??
      (b as { status?: string } | null)?.status ?? null;

  await attempt("places_autocomplete", async () => {
    const res = await fetchImpl(GOOGLE_PROBE_URLS.autocomplete, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "suggestions.placePrediction.placeId" },
      body: JSON.stringify({ input: "Lagos", languageCode: "en" }),
    });
    const body = await res.json().catch(() => null);
    return { api: "places_autocomplete", httpStatus: res.status, ok: googleAutocompleteProbeOk(res.status, body), detail: errStatus(body) };
  });
  await attempt("place_details", async () => {
    const res = await fetchImpl(GOOGLE_PROBE_URLS.placeDetails, {
      method: "GET",
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,location" },
    });
    const body = await res.json().catch(() => null);
    return { api: "place_details", httpStatus: res.status, ok: googlePlaceDetailsProbeOk(res.status, body), detail: errStatus(body) };
  });
  await attempt("geocoding", async () => {
    const res = await fetchImpl(`${GOOGLE_PROBE_URLS.geocoding}&key=${encodeURIComponent(apiKey)}`);
    const body = await res.json().catch(() => null);
    return { api: "geocoding", httpStatus: res.status, ok: googleGeocodingProbeOk(res.status, body), detail: errStatus(body) };
  });
  await attempt("static_maps", async () => {
    const res = await fetchImpl(`${GOOGLE_PROBE_URLS.staticMap}&key=${encodeURIComponent(apiKey)}`);
    const type = res.headers.get("content-type");
    await res.body?.cancel();
    return { api: "static_maps", httpStatus: res.status, ok: googleStaticProbeOk(res.status, type), detail: type };
  });
  return rows;
}

if (import.meta.main) {
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!key) {
    console.error("GOOGLE_MAPS_API_KEY is required");
    Deno.exit(2);
  }
  const rows = await preflight(key);
  for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.api} http=${r.httpStatus ?? "-"} ${r.detail ?? ""}`);
  Deno.exit(rows.every((r) => r.ok) ? 0 : 1);
}
