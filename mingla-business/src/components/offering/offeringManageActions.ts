/**
 * offeringManageActions — META-ORCH-1059 Pass 1.
 *
 * The pure (no-JSX) action-config layer for the shared OfferingManageSheet.
 * Kept separate from the component so callers + tests can build the per-kind
 * action list without importing React Native. This is the canonical Edit ·
 * View public · Orders · Share · Cancel · Duplicate set; rows whose handler is
 * undefined are dropped (no dead taps).
 */

import type { IconName } from "../ui/Icon";
import { offeringKindConfig, type OfferingKind } from "./offeringKind";

export type OfferingActionTone = "default" | "accent" | "danger";

export interface OfferingManageAction {
  key: string;
  icon: IconName;
  label: string;
  tone: OfferingActionTone;
  onPress: () => void;
  testID?: string;
}

/**
 * Handlers a caller wires per kind. Each is OPTIONAL — when omitted the
 * corresponding row is not rendered. This keeps the sheet honest across kinds
 * that don't yet have e.g. an Orders route or a Duplicate flow.
 */
export interface OfferingManageHandlers {
  onEdit?: () => void;
  onViewPublic?: () => void;
  onOrders?: () => void;
  onShare?: () => void;
  onCancel?: () => void;
  onDuplicate?: () => void;
}

/**
 * Build the canonical Edit · View public · Orders · Share · Duplicate · Cancel
 * action list for a kind. Rows whose handler is undefined are dropped. Each
 * handler is wrapped to close the sheet first (avoids the iOS present-while-
 * dismissing modal collision — see EventManageMenu / ORCH-0862).
 */
export function buildOfferingManageActions(
  kind: OfferingKind,
  handlers: OfferingManageHandlers,
  onClose: () => void,
): OfferingManageAction[] {
  const cfg = offeringKindConfig(kind);
  const wrap = (fn: () => void) => (): void => {
    onClose();
    fn();
  };
  const list: OfferingManageAction[] = [];

  if (handlers.onEdit !== undefined) {
    list.push({
      key: "edit",
      icon: "edit",
      label: `Edit ${cfg.noun}`,
      tone: "default",
      onPress: wrap(handlers.onEdit),
      testID: "offering-manage-edit",
    });
  }
  if (handlers.onViewPublic !== undefined) {
    list.push({
      key: "view-public",
      icon: "eye",
      label: "View public page",
      tone: "default",
      onPress: wrap(handlers.onViewPublic),
      testID: "offering-manage-view-public",
    });
  }
  if (handlers.onOrders !== undefined) {
    list.push({
      key: "orders",
      icon: "ticket",
      label: "Orders",
      tone: "default",
      onPress: wrap(handlers.onOrders),
      testID: "offering-manage-orders",
    });
  }
  if (handlers.onShare !== undefined) {
    list.push({
      key: "share",
      icon: "share",
      label: `Share ${cfg.noun}`,
      tone: "default",
      onPress: wrap(handlers.onShare),
      testID: "offering-manage-share",
    });
  }
  if (handlers.onDuplicate !== undefined) {
    list.push({
      key: "duplicate",
      icon: "branch",
      label: "Duplicate",
      tone: "default",
      onPress: wrap(handlers.onDuplicate),
      testID: "offering-manage-duplicate",
    });
  }
  if (handlers.onCancel !== undefined) {
    list.push({
      key: "cancel",
      icon: "trash",
      label: `Cancel ${cfg.noun}`,
      tone: "danger",
      onPress: wrap(handlers.onCancel),
      testID: "offering-manage-cancel",
    });
  }

  return list;
}
