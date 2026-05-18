/**
 * ORCH-0874 [Trip surfaces visual parity with Events] — TripManageMenu.
 *
 * Lightweight Sheet-based action menu opened from trip-detail header
 * `moreH` IconChrome. Mirrors the EventManageMenu shape but trip-specific
 * (4 actions instead of 11):
 *
 *   - View public page (opens /t/{brandSlug}/{tripSlug})
 *   - Share trip link (opens ShareModal)
 *   - Edit trip (router.push /trip/{id}/edit)
 *   - Cancel trip (destructive — opens parent ConfirmDialog)
 *
 * Per SPEC_ORCH-0874 §3.3.2 + DESIGN_ORCH-0874 §4 Q5 (Option A).
 *
 * Parent owns ConfirmDialog + ShareModal state. This menu just fires the
 * handlers and closes itself.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

export interface TripManageMenuProps {
  visible: boolean;
  onClose: () => void;
  /** Open ShareModal with the public trip URL. */
  onShare: () => void;
  /** Router.push /trip/{id}/edit. */
  onEdit: () => void;
  /** Open public trip page (in-app deep link to /t/{brandSlug}/{tripSlug}). */
  onViewPublic: () => void;
  /** Open Cancel ConfirmDialog (typeToConfirm). Only callable when trip is published. */
  onCancelTrip: () => void;
  /** Whether to render the Cancel trip row (hidden for drafts). */
  canCancelTrip?: boolean;
}

interface RowProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}

const Row: React.FC<RowProps> = ({ icon, label, onPress, destructive, testID }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    testID={testID}
  >
    <Icon
      name={icon}
      size={20}
      color={destructive === true ? semantic.error : textTokens.primary}
    />
    <Text style={[styles.rowLabel, destructive === true && styles.rowLabelDestructive]}>
      {label}
    </Text>
  </Pressable>
);

export const TripManageMenu: React.FC<TripManageMenuProps> = ({
  visible,
  onClose,
  onShare,
  onEdit,
  onViewPublic,
  onCancelTrip,
  canCancelTrip = true,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} testID="trip-manage-menu">
      <View style={styles.host}>
        <Text style={styles.heading}>Trip options</Text>
        <View style={styles.divider} />
        <Row
          icon="eye"
          label="View public page"
          onPress={() => {
            onClose();
            onViewPublic();
          }}
          testID="trip-manage-view-public"
        />
        <Row
          icon="share"
          label="Share trip link"
          onPress={() => {
            onClose();
            onShare();
          }}
          testID="trip-manage-share"
        />
        <Row
          icon="edit"
          label="Edit trip"
          onPress={() => {
            onClose();
            onEdit();
          }}
          testID="trip-manage-edit"
        />
        {canCancelTrip ? (
          <>
            <View style={styles.divider} />
            <Row
              icon="x"
              label="Cancel trip"
              destructive
              onPress={() => {
                onClose();
                onCancelTrip();
              }}
              testID="trip-manage-cancel"
            />
          </>
        ) : null}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingVertical: spacing.sm,
    gap: 2,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: textTokens.tertiary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: spacing.xs,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.md,
  },
  rowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: textTokens.primary,
  },
  rowLabelDestructive: {
    color: semantic.error,
  },
});

export default TripManageMenu;
