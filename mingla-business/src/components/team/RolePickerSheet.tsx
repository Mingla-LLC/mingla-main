/**
 * RolePickerSheet — sub-sheet picker for the 6 brand roles (Cycle 13a).
 *
 * Mirrors Cycle 5 VisibilitySheet + Cycle 12 AvailableAtSheet patterns.
 * In `readOnly` mode the sheet renders as a "Roles explained" reference
 * (no select action; "Got it" CTA at bottom).
 *
 * Per Cycle 13a SPEC §4.8.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  type BrandRole,
  roleDescription,
  roleDisplayName,
} from "../../utils/brandRole";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

/** Render order mirrors operator UX convention: highest privilege first. */
const ROLE_ORDER: ReadonlyArray<BrandRole> = [
  "account_owner",
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
];

export interface RolePickerSheetProps {
  visible: boolean;
  current: BrandRole;
  /** When true, render as info-only "Roles explained" reference. */
  readOnly?: boolean;
  onClose: () => void;
  onSelect: (role: BrandRole) => void;
}

export const RolePickerSheet: React.FC<RolePickerSheetProps> = ({
  visible,
  current,
  readOnly = false,
  onClose,
  onSelect,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sheetTitle}>
          {readOnly ? "Roles explained" : "Pick a role"}
        </Text>
        {ROLE_ORDER.map((role) => {
          const active = current === role;
          return (
            <Pressable
              key={role}
              onPress={() => {
                if (readOnly) return;
                onSelect(role);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={roleDisplayName(role)}
              style={[
                styles.roleRow,
                !readOnly && active && styles.roleRowActive,
              ]}
            >
              <View style={styles.roleRowTextCol}>
                <Text
                  style={[
                    styles.roleRowLabel,
                    !readOnly && active && styles.roleRowLabelActive,
                  ]}
                >
                  {roleDisplayName(role)}
                </Text>
                <Text style={styles.roleRowSub}>{roleDescription(role)}</Text>
              </View>
              {!readOnly && active ? (
                <Icon name="check" size={18} color={accent.warm} />
              ) : null}
            </Pressable>
          );
        })}
        {readOnly ? (
          <View style={styles.gotItWrap}>
            <Button
              label="Got it"
              onPress={onClose}
              variant="primary"
              size="lg"
              fullWidth
              accessibilityLabel="Close roles explained"
            />
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.lg,
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs + 2,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  roleRowActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
  },
  roleRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  roleRowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  roleRowLabelActive: {
    color: accent.warm,
  },
  roleRowSub: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 3,
    lineHeight: 17,
  },
  gotItWrap: {
    marginTop: spacing.md,
  },
});

export default RolePickerSheet;
