/**
 * #4389 — the one way screens mount the offering manage sheet. Native: the
 * sheet itself, unchanged. Web (LazyOfferingManageSheet.web.tsx): the sheet's
 * code loads on intent (first open), because three web chunks render it and
 * Metro would otherwise hoist it into the eager web __common chunk.
 */
export {
  OfferingManageSheet,
  buildOfferingManageActions,
  type OfferingActionTone,
  type OfferingManageAction,
  type OfferingManageHandlers,
  type OfferingManageSheetProps,
} from "./OfferingManageSheet";
