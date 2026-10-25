export type ThumbnailState = "pending" | "ready" | "none";

// Pending metadata is polled once per minute. The edge endpoint always persists
// a ready result immediately, even inside that interval, so the next list/meta
// refetch can replace the pending row with its final dimensions and duration.
export const PENDING_THUMBNAIL_RETRY_MS = 60_000;

export interface ThumbnailResolutionPlan {
  shouldRequest: boolean;
  retryDelayMs: number | null;
}

export function thumbnailResolutionPlan(state: ThumbnailState): ThumbnailResolutionPlan {
  if (state === "none") return { shouldRequest: false, retryDelayMs: null };
  if (state === "pending") return { shouldRequest: true, retryDelayMs: PENDING_THUMBNAIL_RETRY_MS };
  return { shouldRequest: true, retryDelayMs: null };
}

export async function requestThumbnailForState<T>(
  state: ThumbnailState,
  request: () => Promise<T>,
): Promise<T | null> {
  if (!thumbnailResolutionPlan(state).shouldRequest) return null;
  return request();
}
