/**
 * #4271 — the routes' only way to the door card-sale screens (doorSaleScreens.ts).
 * Every owner here resolves the same dynamic import, so the sheet, Tap to Pay
 * setup and the Tap to Pay sale share one chunk loaded on intent, and nothing they
 * share is hoisted into the eager web __common chunk.
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { DoorSaleNewSheetProps } from "./DoorSaleNewSheet";
import type { TapToPaySaleScreenProps } from "./tap/TapToPaySaleScreen";
import type { TapToPaySetupScreenProps } from "./tap/TapToPaySetupScreen";

type DoorSaleScreensModule = typeof import("./doorSaleScreens");

let doorSaleScreensPromise: Promise<DoorSaleScreensModule> | null = null;

/** One request per session; a failed load is retried on the next call. */
export const loadDoorSaleScreens = (): Promise<DoorSaleScreensModule> => {
  doorSaleScreensPromise ??= import("./doorSaleScreens").catch((error: unknown) => {
    doorSaleScreensPromise = null;
    throw error;
  });
  return doorSaleScreensPromise;
};

export const LazyTapToPaySetupScreen = createRetryableLazyErrorBoundary<TapToPaySetupScreenProps>(
  async () => ({ default: (await loadDoorSaleScreens()).TapToPaySetupScreen }),
  { loadingLabel: "Loading Tap to Pay" },
);

export const LazyTapToPaySaleScreen = createRetryableLazyErrorBoundary<TapToPaySaleScreenProps>(
  async () => ({ default: (await loadDoorSaleScreens()).TapToPaySaleScreen }),
  { loadingLabel: "Loading Tap to Pay" },
);

/** The door hub's sale sheet, fetched while the hub is idle so "Sell at door" opens promptly. */
export const LazyDoorSaleNewSheet = createOnIntentLazySheet<DoorSaleNewSheetProps>(
  async () => (await loadDoorSaleScreens()).DoorSaleNewSheet,
  { loadingLabel: "Loading door sale", preload: true },
);
