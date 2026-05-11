import { supabase } from "./supabase";
import { EventCoverProviderError } from "./eventCoverProviderError";

export interface PexelsCoverSearchResult {
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

export interface PexelsCoverSearchPage {
  photos: PexelsCoverSearchResult[];
  page: number;
  nextPage: number | null;
  rateLimit: {
    limit: number | null;
    remaining: number | null;
    reset: string | null;
  };
}

const errorCodeForEdgeError = (error: unknown): EventCoverProviderError["code"] => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("auth_required")) return "auth_required";
  if (message.includes("pexels_rate_limited")) return "rate_limited";
  if (message.includes("pexels_not_configured")) return "not_configured";
  if (message.includes("invalid_query")) return "invalid_query";
  return "provider_unavailable";
};

export const searchPexelsEventCovers = async (
  query: string,
  options: { page?: number; perPage?: number } = {},
): Promise<PexelsCoverSearchPage> => {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new EventCoverProviderError(
      "invalid_query",
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
    throw new EventCoverProviderError(
      errorCodeForEdgeError(error),
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
