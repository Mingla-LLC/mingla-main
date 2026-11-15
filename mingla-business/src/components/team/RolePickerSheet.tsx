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
    paddingHorizontal: space[6],
    paddingTop: space[4],
    paddingBottom: space[7],
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
