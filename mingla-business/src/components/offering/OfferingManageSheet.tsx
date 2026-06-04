/**
 * OfferingManageSheet — META-ORCH-1059 Pass 1 shared 3-dot manage sheet.
 *
 * The single, kind-configurable action sheet opened from a Hub list-card's
 * 3-dot trigger AND from a kind's dashboard "more" menu. Generalized from the
 * event manage menu's row-rendering (the best-of-breed version) into a
 * config-driven primitive: the caller passes an ordered `OfferingManageAction[]`
 * and the sheet renders it.
 *
 * The canonical action set for trips + experiences (META-ORCH-1059 Pass 1) is:
 *   Edit · View public page · Orders · Share · Cancel · Duplicate
 * built per-kind by `buildOfferingManageActions` below (routes resolved from
 * the OfferingKind config). Each action is hidden when its handler isn't
 * available for the row (e.g. drafts have no public page / Orders; published
 * offerings hide Cancel when already ended).
 *
 * Events keep their richer EventManageMenu (11 status-aware actions) — it is the
 * "best version" and forcing it onto this 6-action shape would regress events.
 * This sheet is the shared surface for trip + experience and exposes the same
 * row primitive so all three read identically.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { offeringKindConfig, type OfferingKind } from "./offeringKind";
// Pure (no-JSX) action-config layer — kept separate so callers + tests can
// build the per-kind action list without importing React Native.
import {
  buildOfferingManageActions,
  type OfferingActionTone,
  type OfferingManageAction,
  type OfferingManageHandlers,
} from "./offeringManageActions";

export {
  buildOfferingManageActions,
  type OfferingActionTone,
  type OfferingManageAction,
  type OfferingManageHandlers,
};

export interface OfferingManageSheetProps {
  visible: boolean;
  onClose: () => void;
  kind: OfferingKind;
  actions: OfferingManageAction[];
  testID?: string;
}

const TONE_COLOR: Record<OfferingActionTone, string> = {
  default: textTokens.primary,
  accent: accent.warm,
  danger: semantic.error,
};

export const OfferingManageSheet: React.FC<OfferingManageSheetProps> = ({
  visible,
  onClose,
  kind,
  actions,
  testID,
}) => {
  const cfg = offeringKindConfig(kind);

  // Content-fit snap: heading (~44) + each row ~52 + bottom padding.
  const snapPx = useMemo<number>(
    () => 44 + actions.length * 52 + spacing.lg,
    [actions.length],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snapPx}
      testID={testID ?? "offering-manage-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>{cfg.manageSheetTitle}</Text>
        <View style={styles.actionsList}>
          {actions.map((action) => (
            <ActionRow key={action.key} action={action} />
          ))}
        </View>
      </View>
    </Sheet>
  );
};

interface ActionRowProps {
  action: OfferingManageAction;
}

const ActionRow: React.FC<ActionRowProps> = ({ action }) => {
  const color = TONE_COLOR[action.tone];
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      testID={action.testID}
      style={({ pressed }) => [
        styles.actionRow,
        pressed && styles.actionRowPressed,
      ]}
    >
      <Icon name={action.icon} size={18} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  actionsList: {
    gap: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    minHeight: 48,
  },
  actionRowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
});

export default OfferingManageSheet;
