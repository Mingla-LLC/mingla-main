/**
 * UniversalCreatorSheet (ORCH-0826) — top-anchored creator picker.
 *
 * Opens from the top-bar "+" button on Home / Hub / Marketing / Account.
 * Renders three options as tappable rows: Create event / Create experience /
 * Create trip. Each option routes:
 *   - "Create event" → `/event/create` (existing flow, unchanged)
 *   - "Create experience" → `/experience/coming-soon` (stub; Ve5+ ships real)
 *   - "Create trip or otherwise" → `/trip/coming-soon` (stub; Tr2+ ships real)
 *
 * Uses TopSheet with `heightMode="compact"` (new in ORCH-0826) so the panel
 * fits the 3-row content rather than the 70% screen height BrandSwitcherSheet
 * uses.
 *
 * Per Q1-Q8 SPEC ORCH-0826:
 *   - Q2: TopSheet (not bottom Sheet) — operator override
 *   - Q7: short-and-friendly copy
 *   - Constitution #1 (no dead taps): every row routes
 *   - Constitution #9 (no fabricated data): copy describes real offering types
 *   - I-38: Icon rows ≥ 44pt touch target (44×44 iconWrap below)
 *   - I-39: Every Pressable has accessibilityLabel
 *
 * Caller mounts and controls `visible`. Each consumer (Home / Hub / Marketing
 * / Account) owns its own `[isCreatorOpen, setIsCreatorOpen]` state.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.2
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "./Icon";
import { TopSheet } from "./TopSheet";

export interface UniversalCreatorSheetProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

interface CreatorOption {
  readonly key: "event" | "experience" | "trip";
  readonly iconName: "calendar" | "sparkle" | "globe";
  readonly title: string;
  readonly subtitle: string;
  readonly route: string;
  readonly testID: string;
}

const OPTIONS: readonly CreatorOption[] = [
  {
    key: "event",
    iconName: "calendar",
    title: "Create event",
    subtitle: "A ticketed gathering: concert, party, comedy night, festival.",
    route: "/event/create",
    testID: "universal-creator-event",
  },
  {
    key: "experience",
    iconName: "sparkle",
    title: "Create experience",
    subtitle: "A single-intent offering for venues: brunch, tasting, class.",
    route: "/experience/coming-soon",
    testID: "universal-creator-experience",
  },
  {
    key: "trip",
    iconName: "globe",
    // I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972): /trip/create routes
    // universally for every brand.
    title: "Create trip or otherwise",
    subtitle: "A multi-day curated package: retreat, tour, weekend getaway.",
    route: "/trip/create",
    testID: "universal-creator-trip",
  },
] as const;

export const UniversalCreatorSheet: React.FC<UniversalCreatorSheetProps> = ({
  visible,
  onClose,
  testID,
}) => {
  const router = useRouter();

  const handleSelect = useCallback(
    (option: CreatorOption): void => {
      // Close first so the sheet's exit animation begins, then push the
      // route. The 50ms delay matches the scrim-fade lead so the route
      // transition feels intentional rather than abrupt.
      onClose();
      setTimeout(() => {
        router.push(option.route as never);
      }, 50);
    },
    [onClose, router],
  );

  return (
    <TopSheet visible={visible} onClose={onClose} heightMode="compact" testID={testID}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>What are you creating?</Text>
          <Text style={styles.headerSubtitle}>
            Pick one and we&apos;ll walk you through it.
          </Text>
        </View>
        <View style={styles.rows}>
          {OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              accessibilityHint={option.subtitle}
              onPress={() => handleSelect(option)}
              style={({ pressed }) =>
                pressed ? [styles.row, styles.rowPressed] : styles.row
              }
              testID={option.testID}
            >
              <View style={styles.rowIconWrap}>
                <Icon name={option.iconName} size={28} color={textTokens.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{option.title}</Text>
                <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
              </View>
              <Icon name="chevR" size={20} color={textTokens.tertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    </TopSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerSubtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  rowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSubtitle: {
    fontSize: typography.bodySm?.fontSize ?? typography.body.fontSize,
    lineHeight: typography.bodySm?.lineHeight ?? typography.body.lineHeight,
    color: textTokens.secondary,
  },
});

export default UniversalCreatorSheet;
