import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Calendar, Clock, UtensilsCrossed } from "lucide-react-native";

import {
  accent,
  androidOpaque,
  radius,
  restaurantHubLayout,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

export type VenueHubEmptyIcon = "reservations" | "waitlist" | "menu";

export function emptyIconBorderColor(platform: string): string {
  // #2726: Android's blur-free icon chip needs the approved opaque warm edge;
  // translucent accent.border remains correct over real/fallback web glass.
  return platform === "android" ? accent.warm : accent.border;
}

export interface VenueHubEmptyStateProps {
  icon: VenueHubEmptyIcon;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  wrapTestID?: string;
  bodyTestID?: string;
  actionTestID?: string;
}

function EmptyIcon({ icon }: { icon: VenueHubEmptyIcon }): React.ReactElement {
  const props = { size: 24, color: accent.warm } as const;
  if (icon === "reservations") return <Calendar {...props} />;
  if (icon === "waitlist") return <Clock {...props} />;
  return <UtensilsCrossed {...props} />;
}

/**
 * Issue #2726 — the single presentation owner for the three Hub empty states.
 * Outer width stays on GlassCard.style; child rhythm stays on the real content
 * descendants. Moving that rhythm back to `style` silently removes every gap.
 */
export function VenueHubEmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  loading = false,
  disabled = false,
  testID,
  wrapTestID,
  bodyTestID,
  actionTestID,
}: VenueHubEmptyStateProps): React.ReactElement {
  const hasAction = actionLabel !== undefined && onAction !== undefined;
  return (
    <View style={styles.wrap} testID={wrapTestID ?? `${testID}-wrap`}>
      <GlassCard
        variant="base"
        radius="lg"
        style={styles.card}
        contentStyle={styles.cardContent}
        testID={testID}
      >
        <View style={styles.content} testID={`${testID}-anatomy`}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.iconContainer}
            testID={`${testID}-icon`}
          >
            <EmptyIcon icon={icon} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {body !== undefined ? (
            <Text style={styles.body} testID={bodyTestID ?? `${testID}-body`}>
              {body}
            </Text>
          ) : null}
          {hasAction ? (
            // #2726: CTA presentation lives here so call sites cannot drift back
            // to grey secondary, oversized, or full-card-width variants.
            <Button
              label={actionLabel}
              onPress={onAction}
              variant="primary"
              size="md"
              shape="pill"
              accentColor={accent.warm}
              loading={loading}
              disabled={disabled}
              fullWidth={false}
              style={styles.action}
              testID={actionTestID ?? `${testID}-action`}
            />
          ) : null}
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "stretch",
  },
  card: {
    width: "100%",
    alignSelf: "stretch",
  },
  cardContent: {
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: restaurantHubLayout.emptyContentMaxWidth,
    alignSelf: "center",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  iconContainer: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    backgroundColor: Platform.OS === "android" ? androidOpaque.accentFill : accent.tint,
    borderColor: emptyIconBorderColor(Platform.OS),
    borderWidth: 1,
    overflow: "hidden",
    elevation: 0,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  action: {
    alignSelf: "center",
    maxWidth: restaurantHubLayout.compactCtaMaxWidth,
    marginTop: spacing.md,
  },
});

export default VenueHubEmptyState;
