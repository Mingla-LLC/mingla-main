/**
 * #4453 m11 rework — web build of LazySitePagePlanSheet: nothing mounts until
 * the plan is first opened; while its chunk loads an empty sheet with a
 * spinner opens in its place (createOnIntentLazySheet).
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import type { SitePagePlanSheetProps as Props } from "./SitePagePlanSheet";

export type { SitePagePlanSheetProps } from "./SitePagePlanSheet";

export const SitePagePlanSheet = createOnIntentLazySheet<Props>(
  async () => (await import("./SitePagePlanSheet")).SitePagePlanSheet,
  { loadingLabel: "Loading the plan" },
);
