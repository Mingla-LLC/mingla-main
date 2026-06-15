/**
 * ExperienceCreateChooser (ORCH-1144) — universal experience-create pre-step.
 *
 * Opens after the top-bar "+" → "Create experience" (via the /experience/choose
 * route the UniversalCreatorSheet now points at) and from the Experiences-tab
 * empty-state CTA. Renders THREE options, flat / equal / UNCONDITIONAL to every
 * brand (no `venueCategory` gating, no verification gating):
 *
 *   1. "Snap a food menu"       → /experience/snap?mode=menu       (Ve5 parser)
 *   2. "Snap an activities menu" → /experience/snap?mode=activities (Ve6 parser)
 *   3. "Build it yourself"       → /experience/create               (manual wizard)
 *
 * `parseMode` is chosen EXPLICITLY by the user's pick — never inferred from the
 * brand. See I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC.
 *
 * Modeled structurally on UniversalCreatorSheet.tsx (same TopSheet
 * heightMode="compact", same row shape, same handleSelect → onClose +
 * setTimeout(50) → route). Strings are the Recommended-primary set from
 * Mingla_Artifacts/design/ORCH-1144/COPY_ORCH-1144_EXPERIENCE_CREATE_CHOOSER.md
 * (title overridden to "Create An Experience" per Seth 2026-06-15).
 *
 * Android glass: rows use the opaque fallback (Platform.select solid fill, no
 * rgba bleed, overflow:'hidden', no Android shadow) per
 * ANDROID_GLASS_USES_OPAQUE_FALLBACK. iOS keeps the translucent glass tint to
 * match UniversalCreatorSheet.
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md §4.1
 */

import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { TopSheet } from "../ui/TopSheet";

export interface ExperienceCreateChooserProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

interface ChooserOption {
  readonly key: "food" | "activities" | "manual";
  readonly iconName: "flash" | "list" | "sparkle";
  readonly title: string;
  readonly helper: string;
  readonly route: string;
  readonly testID: string;
}

// Order is FIXED and flat: food → activities → manual. Every brand sees all 3.
// COPY §1/§2 Recommended-primary set (title overridden per Seth 2026-06-15).
const OPTIONS: readonly ChooserOption[] = [
  {
    key: "food",
    iconName: "flash",
    title: "Snap a food menu",
    helper:
      "Photo or PDF of your food or drinks menu. Mingla suggests experiences you can accept, edit, or reject.",
    route: "/experience/snap?mode=menu",
    testID: "experience-chooser-food",
  },
  {
    key: "activities",
    iconName: "list",
    title: "Snap an activities menu",
    helper:
      "Photo or PDF of your activities, packages, or rates — bowling, arcade, escape room, mini-golf. Mingla suggests experiences you can accept, edit, or reject.",
    route: "/experience/snap?mode=activities",
    testID: "experience-chooser-activities",
  },
  {
    key: "manual",
    iconName: "sparkle",
    title: "Build it yourself",
    helper:
      "No menu handy? Set up your experience step by step — full control over every detail.",
    route: "/experience/create",
    testID: "experience-chooser-manual",
  },
] as const;

export const ExperienceCreateChooser: React.FC<ExperienceCreateChooserProps> = ({
  visible,
  onClose,
  testID,
}) => {
  const router = useRouter();

  const handleSelect = useCallback(
    (option: ChooserOption): void => {
      // Close first so the sheet's exit animation begins, then push the route.
      // The 50ms delay matches the scrim-fade lead (mirrors UniversalCreatorSheet).
      onClose();
      setTimeout(() => {
        router.push(option.route as never);
      }, 50);
    },
    [onClose, router],
  );

  return (
    <TopSheet
      visible={visible}
      onClose={onClose}
      heightMode="compact"
      testID={testID}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Create An Experience</Text>
          <Text style={styles.headerSubtitle}>
            Snap a menu and let Mingla draft it for you, or build it yourself.
          </Text>
        </View>
        <View style={styles.rows}>
          {OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              accessibilityHint={option.helper}
              onPress={() => handleSelect(option)}
              style={({ pressed }) =>
                pressed ? [styles.row, styles.rowPressed] : styles.row
              }
              testID={option.testID}
            >
              <View style={styles.rowIconWrap}>
                <Icon
                  name={option.iconName}
                  size={28}
                  color={textTokens.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{option.title}</Text>
                <Text style={styles.rowSubtitle}>{option.helper}</Text>
              </View>
              <Icon name="chevR" size={20} color={textTokens.tertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    </TopSheet>
  );
};

// ANDROID_GLASS_USES_OPAQUE_FALLBACK — opaque solid fills on Android (no rgba
// bleed-through over the TopSheet surface), translucent glass on iOS. No Android
// shadow under the rounded fill; overflow:'hidden' clips the row content.
const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});
const ROW_BG_PRESSED = Platform.select({
  ios: glass.tint.profileElevated,
  android: "#2c2f35",
  default: glass.tint.profileElevated,
});
const ROW_ICON_BG = Platform.select({
  ios: glass.tint.profileElevated,
  android: "#2c2f35",
  default: glass.tint.profileElevated,
});

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
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: ROW_BG_PRESSED,
  },
  rowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ROW_ICON_BG,
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

export default ExperienceCreateChooser;
