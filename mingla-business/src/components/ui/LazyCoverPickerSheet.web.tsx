/**
 * #4389 — web build of LazyCoverPickerSheet: nothing mounts until the sheet is
 * first opened; while its chunk loads an empty sheet with a spinner opens in
 * its place (createOnIntentLazySheet), then the picker takes over.
 */
import { createOnIntentLazySheet } from "./OnIntentLazySheet";
import type { CoverPickerSheetProps as Props } from "./CoverPickerSheet";

export type { CoverPickerSheetProps } from "./CoverPickerSheet";

export const CoverPickerSheet = createOnIntentLazySheet<Props>(
  async () => (await import("./CoverPickerSheet")).CoverPickerSheet,
  { loadingLabel: "Loading covers" },
);
