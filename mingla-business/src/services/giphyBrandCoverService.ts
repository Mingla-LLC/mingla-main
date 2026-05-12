/**
 * giphyBrandCoverService — search GIPHY for brand cover GIFs.
 *
 * Client-side direct call to GIPHY's public search API. The API key is a
 * public-search key (per GIPHY's API design) supplied via the
 * EXPO_PUBLIC_GIPHY_API_KEY env at build time — same convention as the
 * event-cover service.
 *
 * Per ORCH-0805 SPEC §6.5 + §5.2.
 */

import { BrandCoverError } from "../utils/brandCoverRules";

export interface GiphyBrandCoverResult {
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

const envValue = (name: string): string | null => {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const value = maybeProcess.process?.env?.[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

const publicGiphyKey = (): string | null =>
  envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY");

const asUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;

const normalizeResult = (result: GiphyResult): GiphyBrandCoverResult | null => {
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

export const searchGiphyBrandCovers = async (
  query: string,
  options: { limit?: number; offset?: number } = {},
): Promise<GiphyBrandCoverResult[]> => {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new BrandCoverError(
      "provider_search_failed",
      "Search with at least two characters.",
    );
  }
  const apiKey = publicGiphyKey();
  if (apiKey === null) {
    throw new BrandCoverError(
      "provider_search_failed",
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
    throw new BrandCoverError(
      "provider_search_failed",
      "GIPHY is busy. Try again in a moment.",
    );
  }
  if (!response.ok) {
    throw new BrandCoverError(
      "provider_search_failed",
      "GIPHY search is unavailable.",
    );
  }
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new BrandCoverError(
      "provider_search_failed",
      "GIPHY returned an unexpected response.",
    );
  }
  return body.data
    .map((item) => normalizeResult(item as GiphyResult))
    .filter((item): item is GiphyBrandCoverResult => item !== null);
};
