import Constants from "expo-constants";

import { EventCoverProviderError } from "./eventCoverProviderError";

export interface GiphyCoverSearchResult {
  id: string;
  provider: "giphy";
  previewUrl: string;
  mediaUrl: string;
  sourceUrl: string | null;
  credit: string;
  creditUrl: string | null;
  alt: string | null;
}

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

const normalizeResult = (result: GiphyResult): GiphyCoverSearchResult | null => {
  const id = typeof result.id === "string" && result.id.length > 0 ? result.id : null;
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

export const searchGiphyEventCovers = async (
  query: string,
  options: { limit?: number; offset?: number } = {},
): Promise<GiphyCoverSearchResult[]> => {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new EventCoverProviderError(
      "invalid_query",
      "Search with at least two characters.",
    );
  }
  const apiKey = publicGiphyKey();
  if (apiKey === null) {
    throw new EventCoverProviderError(
      "not_configured",
      "GIPHY search is not configured yet.",
    );
  }
  const limit = Math.max(6, Math.min(options.limit ?? 12, 25));
  const offset = Math.max(0, options.offset ?? 0);
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    offset: String(offset),
    q: trimmed,
    rating: "pg",
  });
  const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`);
  if (response.status === 429) {
    throw new EventCoverProviderError("rate_limited", "GIPHY is rate limited.", 429);
  }
  if (!response.ok) {
    throw new EventCoverProviderError(
      "provider_unavailable",
      "GIPHY search is unavailable.",
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
    .map((item) => normalizeResult(item as GiphyResult))
    .filter((item): item is GiphyCoverSearchResult => item !== null);
};
