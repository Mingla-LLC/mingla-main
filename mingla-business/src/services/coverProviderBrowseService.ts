/**
 * coverProviderBrowseService — ORCH-0989 [Unified cover picker sheet].
 *
 * Gallery-first browse for the unified CoverPicker's GIF + Stock tabs:
 *   - `trendingGiphyCovers`  → GIPHY Trending, CLIENT-DIRECT (ToS forbids
 *     proxying GIPHY; key is the public EXPO_PUBLIC_GIPHY_API_KEY).
 *   - `curatedPexelsCovers`  → Pexels Curated, via the edge proxy
 *     `event-cover-pexels-curated` (key stays SERVER-SIDE; never client-read).
 *
 * Returns the SAME result shapes as the existing search adapters
 * (`GiphyCoverSearchResult[]` / `PexelsCoverSearchPage`) so the picker can
 * render trending/curated and search results through one code path.
 *
 * External-API contract (COMMS-0003 — docs cited inline):
 *   GIPHY Trending:
 *     GET https://api.giphy.com/v1/gifs/trending
 *     https://developers.giphy.com/docs/api/endpoint/#trending
 *     Client-side mandatory; proxying forbidden:
 *     https://developers.giphy.com/docs/api/
 *     Rate limit (beta key) 100/hour:
 *     https://developers.giphy.com/docs/api/#rate-limits
 *     Attribution "Powered By GIPHY":
 *     https://developers.giphy.com/docs/api/#design-guidelines-and-requirements
 *   Pexels Curated:
 *     GET https://api.pexels.com/v1/curated  (proxied via edge fn)
 *     https://www.pexels.com/api/documentation/#photos-curated
 *
 * Replaces the retired giphyBrandCoverService + pexelsBrandCoverService
 * (subtract-before-add — the brand sheet's two duplicates are deleted).
 */

import Constants from "expo-constants";

import { supabase } from "./supabase";
import { EventCoverProviderError } from "./eventCoverProviderError";
import type { GiphyCoverSearchResult } from "./giphyEventCoverService";
import type {
  PexelsCoverSearchPage,
} from "./pexelsEventCoverService";

// ----- GIPHY trending (client-direct) ------------------------------------

type GiphyImage = { url?: unknown };
type GiphyResult = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  source_post_url?: unknown;
  source?: unknown;
  images?: {
    fixed_width?: GiphyImage;
    downsized_medium?: GiphyImage;
    downsized?: GiphyImage;
    original?: GiphyImage;
  };
};

// ORCH-1127: read the GIPHY key from Constants.expoConfig.extra FIRST (mirror
// supabase.ts). Dynamic process.env[name] is NOT inlined by babel-preset-expo
// and is undefined in Hermes standalone/OTA builds — extra is the
// manifest-backed, build-safe path. Do NOT revert to process.env[<var>].
type GiphyKeyName = "EXPO_PUBLIC_GIPHY_API_KEY" | "EXPO_PUBLIC_GIPHY_KEY";

// `extra` is a runtime object materialized from the resolved app.config.ts and
// baked into the app manifest at build time, so a dynamic key read here is safe
// (it does not depend on babel inlining).
const readExtra = (name: GiphyKeyName): string | undefined => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  return extra?.[name];
};

// The process.env fallback MUST use STATIC member access so babel-preset-expo
// inlines it for the Metro-dev / web-export path (where `extra` may be absent).
const readStaticProcessEnv = (name: GiphyKeyName): string | undefined =>
  name === "EXPO_PUBLIC_GIPHY_API_KEY"
    ? process.env.EXPO_PUBLIC_GIPHY_API_KEY
    : process.env.EXPO_PUBLIC_GIPHY_KEY;

const envValue = (name: GiphyKeyName): string | null => {
  const value = readExtra(name) ?? readStaticProcessEnv(name);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

const publicGiphyKey = (): string | null =>
  envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY");

const asUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;

const normalizeGiphy = (result: GiphyResult): GiphyCoverSearchResult | null => {
  const id =
    typeof result.id === "string" && result.id.length > 0 ? result.id : null;
  const previewUrl = asUrl(result.images?.fixed_width?.url);
  const selectedUrl =
    asUrl(result.images?.downsized_medium?.url) ??
    asUrl(result.images?.downsized?.url) ??
    asUrl(result.images?.original?.url);
  if (id === null || previewUrl === null || selectedUrl === null) return null;
  const sourceUrl =
    asUrl(result.url) ?? asUrl(result.source_post_url) ?? asUrl(result.source);
  const title =
    typeof result.title === "string" && result.title.trim().length > 0
      ? result.title.trim()
      : null;
  return {
    id,
    provider: "giphy",
    previewUrl,
    mediaUrl: selectedUrl,
    sourceUrl,
    credit: "GIPHY",
    creditUrl: sourceUrl,
    alt: title,
  };
};

export const trendingGiphyCovers = async (
  options: { limit?: number; offset?: number } = {},
): Promise<GiphyCoverSearchResult[]> => {
  const apiKey = publicGiphyKey();
  if (apiKey === null) {
    throw new EventCoverProviderError(
      "not_configured",
      "GIPHY is not configured yet.",
    );
  }
  // Clamp 6-25 to match searchGiphyEventCovers; rating pg to match.
  const limit = Math.max(6, Math.min(options.limit ?? 24, 25));
  const offset = Math.max(0, Math.min(options.offset ?? 0, 499));
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    offset: String(offset),
    rating: "pg",
  });
  // GIPHY Trending — client-direct (no `q`). Proxying is forbidden by ToS.
  const response = await fetch(
    `https://api.giphy.com/v1/gifs/trending?${params}`,
  );
  if (response.status === 429) {
    throw new EventCoverProviderError("rate_limited", "GIPHY is rate limited.", 429);
  }
  if (!response.ok) {
    throw new EventCoverProviderError(
      "provider_unavailable",
      "GIPHY is unavailable.",
      response.status,
    );
  }
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new EventCoverProviderError(
      "invalid_response",
      "GIPHY returned an unexpected response.",
    );
  }
  return body.data
    .map((item) => normalizeGiphy(item as GiphyResult))
    .filter((item): item is GiphyCoverSearchResult => item !== null);
};

// ----- Pexels curated (edge-proxied) -------------------------------------

const pexelsErrorCodeForEdgeError = (
  error: unknown,
): EventCoverProviderError["code"] => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("auth_required")) return "auth_required";
  if (message.includes("pexels_rate_limited")) return "rate_limited";
  if (message.includes("pexels_not_configured")) return "not_configured";
  return "provider_unavailable";
};

export const curatedPexelsCovers = async (
  options: { page?: number; perPage?: number } = {},
): Promise<PexelsCoverSearchPage> => {
  // Pexels key stays SERVER-SIDE — never read client-side here.
  const { data, error } = await supabase.functions.invoke(
    "event-cover-pexels-curated",
    {
      body: {
        page: options.page,
        perPage: options.perPage,
      },
    },
  );
  if (error !== null) {
    throw new EventCoverProviderError(
      pexelsErrorCodeForEdgeError(error),
      error.message,
    );
  }
  const page = data as PexelsCoverSearchPage | null;
  if (page === null || !Array.isArray(page.photos)) {
    throw new EventCoverProviderError(
      "invalid_response",
      "Pexels returned an unexpected response.",
    );
  }
  return page;
};
