/**
 * RolePickerSheet — reusable role picker (J-A9).
 *
 * Used by:
 *   - BrandInviteSheet → pick role for new invitation (5 INVITE_ROLES, no owner)
 *   - BrandMemberDetailView → change existing member's role (5 INVITE_ROLES;
 *                                owner-self never opens this picker)
 *
 * Each role row: role label (Pill) + 2-line description + check icon when
 * selected. Tap a row → calls onPick(role). Parent owns Sheet visibility +
 * persistence; this component is purely presentational.
 *
 * I-13 invariant: this Sheet portals to OS root via the kit Sheet primitive
 * (which wraps RN Modal). Safe to mount anywhere in the tree.
 *
 * Per J-A9 spec §3.8.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BrandMemberRole } from "../../store/currentBrandStore";

import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

/**
 * Roles invitable via the team UI. Owner is excluded — exactly one owner
 * per brand; ownership transfer is post-MVP.
 */
export const INVITE_ROLES: BrandMemberRole[] = [
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
];

const ROLE_LABEL: Record<BrandMemberRole, string> = {
  owner: "Owner",
  brand_admin: "Admin",
  event_manager: "Events",
  finance_manager: "Finance",
  marketing_manager: "Marketing",
  scanner: "Scanner",
};

const ROLE_DESCRIPTION: Record<BrandMemberRole, string> = {
  owner:
    "Full access to everything, including team management, payments, and brand settings.",
  brand_admin:
    "Manage events, team, payments, and brand settings. Cannot delete the brand.",
  event_manager:
    "Create and run events. Cannot see financial figures or manage team.",
  finance_manager:
    "View payments, payouts, refunds, and finance reports. No event editing.",
  marketing_manager:
    "Run marketing campaigns and email blasts. No financial access.",
  scanner:
    "Scan tickets at the door. No edit access. Cannot view financials.",
};

export interface RolePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Role options to show. For invite + role-change use INVITE_ROLES. */
  options: BrandMemberRole[];
  /** Currently selected role; renders check icon next to that row. */
  selectedRole: BrandMemberRole | undefined;
  onPick: (role: BrandMemberRole) => void;
}

export const RolePickerSheet: React.FC<RolePickerSheetProps> = ({
  visible,
  onClose,
  options,
  selectedRole,
  onPick,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <Text style={styles.title}>Pick a role</Text>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {options.map((role) => {
          const isSelected = role === selectedRole;
          return (
            <Pressable
              key={role}
              onPress={() => onPick(role)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`Pick role ${ROLE_LABEL[role]}`}
              style={[styles.row, isSelected && styles.rowSelected]}
            >
              <View style={styles.rowTextCol}>
                <View style={styles.rowPillRow}>
                  <Pill variant={role === "owner" ? "accent" : "draft"}>
                    {ROLE_LABEL[role]}
                  </Pill>
                </View>
                <Text style={styles.rowDescription}>
                  {ROLE_DESCRIPTION[role]}
                </Text>
              </View>
              {isSelected ? (
                <View style={styles.checkWrap}>
                  <Icon name="check" size={20} color={accent.warm} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  scroll: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  rowSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  rowPillRow: {
    flexDirection: "row",
  },
  rowDescription: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  checkWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default RolePickerSheet;
