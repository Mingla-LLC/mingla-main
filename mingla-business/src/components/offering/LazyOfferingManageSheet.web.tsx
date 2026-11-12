/**
 * #4389 — web build of LazyOfferingManageSheet: nothing mounts until the sheet
 * is first opened; while its chunk loads an empty sheet with a spinner opens in
 * its place (createOnIntentLazySheet). The action list is plain data and stays
 * where it was.
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import type { OfferingManageSheetProps } from "./OfferingManageSheet";

export {
  buildOfferingManageActions,
  type OfferingActionTone,
  type OfferingManageAction,
  type OfferingManageHandlers,
} from "./offeringManageActions";
export type { OfferingManageSheetProps } from "./OfferingManageSheet";

export const OfferingManageSheet = createOnIntentLazySheet<OfferingManageSheetProps>(
  async () => (await import("./OfferingManageSheet")).OfferingManageSheet,
  { loadingLabel: "Loading" },
);
