/**
 * pexelsBrandCoverService — search Pexels for brand cover images.
 *
 * [ORCH-0805] This service reuses the existing `event-cover-pexels-search`
 * Supabase Edge Function as-is. That function is a thin Pexels API proxy
 * (no event-specific server logic) so cross-domain reuse is safe. A future
 * rename of the edge function to `pexels-search` is a cleanup ORCH; this
 * code documents the reuse to keep ownership clear.
 *
 * Per ORCH-0805 SPEC §6.4 + §5.1.
 */

import { supabase } from "./supabase";
import { BrandCoverError } from "../utils/brandCoverRules";

export interface PexelsBrandCoverResult {
  id: number;
  provider: "pexels";
  mediaUrl: string;
  sourceUrl: string;
  credit: string;
  creditUrl: string;
  alt: string | null;
  avgColor: string | null;
  width: number;
  height: number;
}

export interface PexelsBrandCoverPage {
  photos: PexelsBrandCoverResult[];
  page: number;
  nextPage: number | null;
  rateLimit: {
    limit: number | null;
    remaining: number | null;
    reset: string | null;
  };
}

const messageFromError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
};

const friendlyMessageForEdgeError = (error: unknown): string => {
  const message = messageFromError(error);
  if (message.includes("auth_required")) {
    return "Sign in again to browse Pexels.";
  }
  if (message.includes("pexels_rate_limited")) {
    return "Pexels is busy. Try again in a moment.";
  }
  if (message.includes("pexels_not_configured")) {
    return "Pexels search is not configured yet.";
  }
  if (message.includes("invalid_query")) {
    return "Search with at least two characters.";
  }
  return "Pexels search isn't available right now.";
};

export const searchPexelsBrandCovers = async (
  query: string,
  options: { page?: number; perPage?: number } = {},
): Promise<PexelsBrandCoverPage> => {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new BrandCoverError(
      "provider_search_failed",
      "Search with at least two characters.",
    );
  }
  const { data, error } = await supabase.functions.invoke(
    "event-cover-pexels-search",
    {
      body: {
        query: trimmed,
        page: options.page,
        perPage: options.perPage,
      },
    },
  );
  if (error !== null) {
    throw new BrandCoverError(
      "provider_search_failed",
      friendlyMessageForEdgeError(error),
    );
  }
  const page = data as PexelsBrandCoverPage | null;
  if (page === null || !Array.isArray(page.photos)) {
    throw new BrandCoverError(
      "provider_search_failed",
      "Pexels returned an unexpected response.",
    );
  }
  return page;
};
