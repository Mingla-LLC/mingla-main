/**
 * #4271 — the routes' only way to the door card-sale screens (doorSaleScreens.ts).
 * Every owner here resolves the same dynamic import, so Door mode (#4389), Tap
 * to Pay setup, the Tap to Pay sale and the pay code screen share one chunk
 * loaded on intent, and nothing they share is hoisted into the eager web
 * __common chunk.
 */
import { Platform } from "react-native";

import { tapToPayName } from "../../constants/tapToPayName";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { DoorModeScreenProps } from "./DoorModeScreen";
import type { DoorPayCodeScreenProps } from "./DoorPayCodeScreen";
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
  { loadingLabel: `Loading ${tapToPayName(Platform.OS)}` },
);

export const LazyTapToPaySaleScreen = createRetryableLazyErrorBoundary<TapToPaySaleScreenProps>(
  async () => ({ default: (await loadDoorSaleScreens()).TapToPaySaleScreen }),
  { loadingLabel: `Loading ${tapToPayName(Platform.OS)}` },
);

/** "Scan to pay": the sheet preloads this chunk, so the screen usually opens at once. */
export const LazyDoorPayCodeScreen = createRetryableLazyErrorBoundary<DoorPayCodeScreenProps>(
  async () => ({ default: (await loadDoorSaleScreens()).DoorPayCodeScreen }),
  { loadingLabel: "Loading the pay code" },
);

/** #4389 Door mode: the full-screen door sale (/event/[id]/door/sell). */
export const LazyDoorModeScreen = createRetryableLazyErrorBoundary<DoorModeScreenProps>(
  async () => ({ default: (await loadDoorSaleScreens()).DoorModeScreen }),
  { loadingLabel: "Loading the door" },
);
