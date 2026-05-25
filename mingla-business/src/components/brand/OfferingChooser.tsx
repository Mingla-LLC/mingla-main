import React, { useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";

export type OfferingKind = "event" | "trip" | "experience";
export type OfferingChooserVariant =
  | "home-empty"
  | "hub-getstarted"
  | "brand-create-welcome";

export interface OfferingChooserProps {
  headline?: string;
  subhead?: string;
  variant?: OfferingChooserVariant;
  onSelect: (offering: OfferingKind) => void;
  testID?: string;
}

interface OfferingOption {
  kind: OfferingKind;
  label: string;
  subhead: string;
  icon: IconName;
  accessibilityLabel: string;
}

export const OFFERING_CHOOSER_DEFAULT_HEADLINE =
  "What do you want to make first?";
export const OFFERING_CHOOSER_DEFAULT_SUBHEAD = "Mix and match anytime.";

export const OFFERING_OPTIONS: readonly OfferingOption[] = [
  {
    kind: "event",
    label: "Event",
    subhead: "One night, one place.",
    icon: "calendar",
    accessibilityLabel: "Create event. One night, one place.",
  },
  {
    kind: "trip",
    label: "Trip",
    subhead: "Multi-day getaway.",
    icon: "compass",
    accessibilityLabel: "Plan trip. Multi-day getaway.",
  },
  {
    kind: "experience",
    label: "Experience",
    subhead: "Recurring or evergreen.",
    icon: "sparkle",
    accessibilityLabel: "Design experience. Recurring or evergreen.",
  },
] as const;

export const routeForOffering = (offering: OfferingKind): string => {
  if (offering === "trip") return "/trip/create";
  if (offering === "experience") return "/experience/create";
  return "/event/create";
};

export const OfferingChooser: React.FC<OfferingChooserProps> = ({
  headline = OFFERING_CHOOSER_DEFAULT_HEADLINE,
  subhead = OFFERING_CHOOSER_DEFAULT_SUBHEAD,
  variant = "home-empty",
  onSelect,
  testID,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 760;

  const handlePress = useCallback(
    (offering: OfferingKind): void => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onSelect(offering);
    },
    [onSelect],
  );

  return (
    <View style={styles.host} testID={testID ?? `offering-chooser-${variant}`}>
      <Text style={styles.headline}>{headline}</Text>
      {subhead.trim().length > 0 ? (
        <Text style={styles.subhead}>{subhead}</Text>
      ) : null}
      <View style={[styles.grid, isWide ? styles.gridWide : null]}>
        {OFFERING_OPTIONS.map((option) => (
          <Pressable
            key={option.kind}
            onPress={() => handlePress(option.kind)}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel}
            style={({ pressed }) => [
              styles.optionPressable,
              isWide ? styles.optionWide : null,
              pressed ? styles.optionPressed : null,
            ]}
            testID={`offering-chooser-${option.kind}`}
          >
            <GlassCard
              variant="base"
              radius="lg"
              padding={spacing.md}
              style={styles.optionCard}
            >
              <View style={styles.optionInner}>
                <Icon name={option.icon} size={28} color={accent.warm} />
                <Text style={styles.optionTitle}>{option.label}</Text>
                <Text style={styles.optionSubhead}>{option.subhead}</Text>
              </View>
            </GlassCard>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
  },
  headline: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  subhead: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  grid: {
    gap: spacing.sm,
  },
  gridWide: {
    flexDirection: "row",
  },
  optionPressable: {
    minHeight: 44,
  },
  optionWide: {
    flex: 1,
  },
  optionPressed: {
    opacity: 0.88,
  },
  optionCard: {
    minHeight: 128,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
  },
  optionInner: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  optionTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
  },
  optionSubhead: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
});

export default OfferingChooser;
