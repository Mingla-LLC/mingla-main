// Shared cover-media presentation resolver.
//
// Moved here from mingla-business `eventCoverMediaRules.ts` so the same logic
// drives EventCoverMedia across mingla-business, app-mobile, AND the shared
// brand page. mingla-business re-exports this to preserve its public API.
// Per I-MOR-0827-PACKAGE-ISOLATION this file imports nothing from any app src/.

import type { EventCoverMediaType } from "./types";

export const resolveEventCoverMediaPresentation = ({
  mediaUrl,
  mediaType,
  hasMediaError,
  reduceMotion,
}: {
  mediaUrl?: string | null;
  mediaType?: EventCoverMediaType | null;
  hasMediaError?: boolean;
  reduceMotion?: boolean;
}): "fallback" | "image" | "gif" | "video" | "video_still" => {
  if (hasMediaError === true || mediaUrl === null || mediaUrl === undefined) {
    return "fallback";
  }
  if (mediaType === "video") {
    return reduceMotion === true ? "video_still" : "video";
  }
  if (mediaType === "gif") return "gif";
  if (mediaType === "image") return "image";
  return "fallback";
};
