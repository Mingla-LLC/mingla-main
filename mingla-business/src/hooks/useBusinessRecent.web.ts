// Web detail routes resolve the compatibility facade to the writer-only
// boundary. Home resolves useBusinessRecentHome.web.ts to the reader instead.
import type { BusinessRecentPointer } from "../store/businessRecentTypes";

export {
  discardBusinessRecentDraft,
  promoteBusinessRecentDraft,
  useSuccessfulBusinessRecentOpen,
} from "./useBusinessRecentWriter";

const EMPTY_WEB_RECENT_ROWS: BusinessRecentPointer[] = [];
const noopRecentRefresh = async (): Promise<void> => undefined;

// Export parity must not pull the Home reader graph into every web detail route.
// Home uses useBusinessRecentHome.web.ts; this compatibility fallback keeps an
// accidental facade import defined and inert instead of crashing at runtime.
export const useBusinessRecent: typeof import("./useBusinessRecentReader").useBusinessRecent =
  () => ({
    rows: EMPTY_WEB_RECENT_ROWS,
    total: 0,
    state: "loading",
    isRefreshing: false,
    isLoadingMore: false,
    hasPageError: false,
    hasMore: false,
    retry: noopRecentRefresh,
    refresh: noopRecentRefresh,
  });
