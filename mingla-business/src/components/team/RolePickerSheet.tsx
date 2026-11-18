/**
 * RolePickerSheet — sub-sheet picker for brand and venue-scoped roles.
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
  color,
  radius,
  space,
} from "../../constants/designSystem";
import {
  type BrandRole,
} from "../../utils/brandRole";
import { roleDescription, roleDisplayName } from "../../utils/brandRoleCopy";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

/** Render order mirrors operator UX convention: highest privilege first. */
const ROLE_ORDER: readonly BrandRole[] = [
  "brand_owner",
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
  "venue_staff",
];

export interface RolePickerSheetProps {
  visible: boolean;
  current: BrandRole;
  /** When true, render as info-only "Roles explained" reference. */
  readOnly?: boolean;
  /**
   * #4238 — roles this viewer may not give (Finance and owner are the
   * owner's to give). Shown, so the rule is visible, but not selectable.
   */
  lockedRoles?: readonly BrandRole[];
  onClose: () => void;
  onSelect: (role: BrandRole) => void;
}

/** #4238 — the line under a role only the brand owner can give. */
export const OWNER_ONLY_ROLE_NOTE = "Only the brand owner can give this role.";

export const RolePickerSheet: React.FC<RolePickerSheetProps> = ({
  visible,
  current,
  readOnly = false,
  lockedRoles = [],
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
          const locked = !readOnly && lockedRoles.includes(role);
          return (
            <Pressable
              key={role}
              onPress={() => {
                if (readOnly || locked) return;
                onSelect(role);
              }}
              disabled={locked}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: locked }}
              accessibilityLabel={locked ? `${roleDisplayName(role)}. ${OWNER_ONLY_ROLE_NOTE}` : roleDisplayName(role)}
              style={[
                styles.roleRow,
                !readOnly && active && styles.roleRowActive,
                locked && styles.roleRowLocked,
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
                <Text style={styles.roleRowSub}>{locked ? OWNER_ONLY_ROLE_NOTE : roleDescription(role)}</Text>
              </View>
              {!readOnly && active ? (
                <Icon name="check" size={18} color={color.text1} />
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
    paddingTop: space[4],
    paddingBottom: space[7],
    // #4420: the Sheet owns the 20pt side padding; no second inset here.
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.2,
    marginBottom: space[6],
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2] + 2,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginBottom: space[1] + 2,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  roleRowLocked: { opacity: 0.5 },
  roleRowActive: {
    borderColor: color.paper,
    backgroundColor: color.fill.tabOn,
  },
  roleRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  roleRowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: color.text1,
  },
  roleRowLabelActive: {
    color: color.text1,
  },
  roleRowSub: {
    fontSize: 12,
    color: color.text3,
    marginTop: 3,
    lineHeight: 17,
  },
  gotItWrap: {
    marginTop: space[4],
  },
});

export default RolePickerSheet;
