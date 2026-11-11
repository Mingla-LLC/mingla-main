/**
 * #4382 — the support routes' only way to the support screens
 * (supportScreens.ts). Every owner resolves the same dynamic import, so the
 * screens and everything they share load as one chunk on intent and stay out
 * of the eager web `__common` chunk.
 */
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { SupportTabPanelProps } from "./SupportTabPanel";

type SupportScreensModule = typeof import("./supportScreens");

let supportScreensPromise: Promise<SupportScreensModule> | null = null;

/** One request per session; a failed load is retried on the next call. */
const loadSupportScreens = (): Promise<SupportScreensModule> => {
  supportScreensPromise ??= import("./supportScreens").catch((error: unknown) => {
    supportScreensPromise = null;
    throw error;
  });
  return supportScreensPromise;
};

export const LazySupportTabPanel = createRetryableLazyErrorBoundary<SupportTabPanelProps>(
  async () => ({ default: (await loadSupportScreens()).SupportTabPanel }),
  { loadingLabel: "Loading your requests" },
);

export const LazySupportThread = createRetryableLazyErrorBoundary<{ ticketId: string; staffMode?: boolean }>(
  async () => ({ default: (await loadSupportScreens()).SupportThread }),
  { loadingLabel: "Loading the request" },
);

export const LazySupportInboxScreen = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await loadSupportScreens()).SupportInboxScreen }),
  { loadingLabel: "Loading the support inbox" },
);
