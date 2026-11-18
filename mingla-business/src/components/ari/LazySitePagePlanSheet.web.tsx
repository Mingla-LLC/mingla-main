/**
 * #4453 m11 rework — web build of LazySitePagePlanSheet: nothing mounts until
 * the plan is first opened; while its chunk loads an empty sheet with a
 * spinner opens in its place (createOnIntentLazySheet).
 *
 * The sheet loads through the Website editor's own on-intent chunk
 * (WebsiteApp re-exports it). A chunk of its own would share planApi, the
 * site-contracts catalogue and the Website hooks with that chunk, and Expo
 * moves every module two async chunks share into the eager __common chunk
 * (#3493 boot payload gate).
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import type { SitePagePlanSheetProps as Props } from "./SitePagePlanSheet";

export type { SitePagePlanSheetProps } from "./SitePagePlanSheet";

export const SitePagePlanSheet = createOnIntentLazySheet<Props>(
  async () => (await import("../sites/website/WebsiteApp")).SitePagePlanSheet,
  { loadingLabel: "Loading the plan" },
);
