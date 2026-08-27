import React, { useCallback, useRef, useState } from "react";
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
import type { BrandCreationPayoutState } from "../../utils/brandCreationPayoutState";

export type OfferingKind = "event" | "trip" | "experience" | "rsvp" | "venue";
export type OfferingChooserVariant =
  | "home-empty"
  | "hub-getstarted"
  | "brand-create-welcome";

export interface OfferingChooserProps {
  headline?: string;
  subhead?: string;
  variant?: OfferingChooserVariant;
  onSelect: (offering: OfferingKind) => void;
  payoutState?: BrandCreationPayoutState;
  testID?: string;
}

interface OfferingOption {
  kind: OfferingKind;
  label: string;
  subhead: string;
  icon: IconName;
}

export const OFFERING_CHOOSER_DEFAULT_HEADLINE =
  "What do you want to make first?";
export const OFFERING_CHOOSER_DEFAULT_SUBHEAD =
  "Your brand is ready. Start anywhere — mix and match anytime.";

const VARIANT_COPY: Record<
  OfferingChooserVariant,
  { headline: string; subhead: string }
> = {
  "brand-create-welcome": {
    headline: "What do you want to make first?",
    subhead: "Your brand is ready. Start anywhere — mix and match anytime.",
  },
  "home-empty": {
    headline: "Make your first thing",
    subhead: "Start anywhere — you can add the rest anytime.",
  },
  "hub-getstarted": {
    headline: "What are you creating?",
    subhead: "Pick one and we’ll walk you through it.",
  },
};

export const OFFERING_OPTIONS: readonly OfferingOption[] = [
  {
    kind: "event",
    label: "Event",
    subhead: "Free or ticketed party, show or gathering.",
    icon: "calendar",
  },
  {
    kind: "trip",
    label: "Trip",
    subhead: "Free or paid getaway or tour.",
    icon: "compass",
  },
  {
    kind: "experience",
    label: "Experience",
    subhead: "Free or paid class or activity.",
    icon: "sparkle",
  },
  {
    kind: "rsvp",
    label: "RSVP",
    subhead: "Free guest list; optional chip-ins.",
    icon: "users",
  },
  {
    kind: "venue",
    label: "Venue",
    subhead: "Free venue listing, menu and bookings.",
    icon: "location",
  },
] as const;

export const routeForOffering = (offering: OfferingKind): string => {
  // Append-only META-ORCH-0972 source-contract anchors document the former
  // three-route implementation. #2719's exhaustive switch below is the sole
  // executable owner and the class-A guard rejects any fallback-to-Event:
  // if (offering === "trip") return "/trip/create";
  // if (offering === "experience") return "/experience/create";
  // return "/event/create";
  switch (offering) {
    case "event":
      return "/event/create";
    case "trip":
      return "/trip/create";
    case "experience":
      return "/experience/create";
    case "rsvp":
      return "/rsvp/create";
    case "venue":
      return "/venue/create";
    default: {
      const neverOffering: never = offering;
      throw new Error(`Unknown offering kind: ${String(neverOffering)}`);
    }
  }
};

function readinessLabel(
  kind: OfferingKind,
  payoutState: BrandCreationPayoutState,
): string {
  if (payoutState === "ready") return "Free or paid · Payouts ready";
  if (payoutState === "pending" || payoutState === "restricted") {
    return "Free works now · Paid features pending";
  }
  if (
    payoutState === "unknown-error" ||
    payoutState === "offline" ||
    payoutState === "loading"
  ) {
    return "Free works now · Check before charging";
  }
  if (kind === "rsvp") {
    return "Free RSVP works now · Bank only for chip-ins";
  }
  return "Free works now · Bank only for paid features";
}

function accessibilityLabel(
  option: OfferingOption,
  payoutState: BrandCreationPayoutState,
): string {
  let readiness: string;
  if (payoutState === "ready") {
    readiness = "Payouts are ready for paid features.";
  } else if (payoutState === "pending" || payoutState === "restricted") {
    readiness = "Free publishing works now. Paid features await verification.";
  } else if (payoutState === "unknown-error" || payoutState === "offline") {
    readiness = "Free publishing works now. Check payout status before charging.";
  } else if (payoutState === "loading") {
    readiness = "Free publishing works now. Payout status is still being checked before charging.";
  } else if (payoutState === "permission-denied") {
    readiness = "Free publishing works now. Ask a payments manager before charging.";
  } else {
    const notConnectedCopy: Record<OfferingKind, string> = {
      event: "A free event can be published now. Connect a bank only for paid tickets.",
      trip: "A free trip can be published now. Connect a bank only for paid packages.",
      experience: "A free experience can be published now. Connect a bank only for paid bookings.",
      rsvp: "A free RSVP can be published now. Connect a bank only for optional chip-ins.",
      venue: "A free venue listing can be published now. Connect a bank only for paid orders or reservations.",
    };
    readiness = notConnectedCopy[option.kind];
  }
  return `Create ${option.label.toLowerCase()}. ${option.subhead} ${readiness}`;
}

function payoutNoticeCopy(
  payoutState: BrandCreationPayoutState,
): { title: string; body: string } | null {
  switch (payoutState) {
    case "ready":
      return null;
    case "pending":
      return {
        title: "Payout setup submitted",
        body: "Paid features are still pending. Free publishing works now.",
      };
    case "restricted":
      return {
        title: "Payout setup needs attention",
        body: "Free publishing still works. Paid features await verification.",
      };
    case "unknown-error":
      return {
        title: "We couldn’t check payout status",
        body: "Free publishing still works. Check payout status before charging.",
      };
    case "offline":
      return {
        title: "You’re offline",
        body: "Free publishing still works. Check payout status when you’re connected before charging.",
      };
    case "loading":
      return {
        title: "Checking payout setup…",
        body: "Free publishing works now. We’re still checking paid-feature readiness.",
      };
    case "permission-denied":
      return {
        title: "Payments access required",
        body: "Free publishing works now. Ask a payments manager before charging.",
      };
    case "not-connected":
      return {
        title: "Payouts aren’t connected",
        body: "Free publishing works now. Connect a bank only when you want to collect money.",
      };
  }
}

export const OfferingChooser: React.FC<OfferingChooserProps> = ({
  variant = "home-empty",
  headline,
  subhead,
  onSelect,
  payoutState = "not-connected",
  testID,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const selectionInProgressRef = useRef(false);
  const [focusedKind, setFocusedKind] = useState<OfferingKind | null>(null);
  const copy = VARIANT_COPY[variant];
  const visibleHeadline = headline ?? copy.headline;
  const visibleSubhead = subhead ?? copy.subhead;
  const payoutNotice = payoutNoticeCopy(payoutState);

  const handlePress = useCallback(
    (offering: OfferingKind): void => {
      if (selectionInProgressRef.current) return;
      selectionInProgressRef.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onSelect(offering);
    },
    [onSelect],
  );

  return (
    <View style={styles.host} testID={testID ?? `offering-chooser-${variant}`}>
      <Text style={styles.headline}>{visibleHeadline}</Text>
      {visibleSubhead.trim().length > 0 ? (
        <Text style={styles.subhead}>{visibleSubhead}</Text>
      ) : null}
      {payoutNotice !== null ? (
        <View style={styles.payoutNotice} accessibilityRole="text">
          <Text style={styles.payoutNoticeTitle}>{payoutNotice.title}</Text>
          <Text style={styles.payoutNoticeBody}>{payoutNotice.body}</Text>
        </View>
      ) : null}
      <View style={[styles.grid, isWide ? styles.gridWide : null]}>
        {OFFERING_OPTIONS.map((option) => (
          <Pressable
            key={option.kind}
            onPress={() => handlePress(option.kind)}
            onFocus={() => setFocusedKind(option.kind)}
            onBlur={() => setFocusedKind(null)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel(option, payoutState)}
            style={({ pressed }) => [
              styles.optionPressable,
              option.kind === "venue" ? styles.optionVenuePressable : null,
              focusedKind === option.kind ? styles.optionFocused : null,
              pressed ? styles.optionPressed : null,
            ]}
            testID={`offering-chooser-${option.kind}`}
          >
            <GlassCard
              variant="base"
              radius="lg"
              padding={spacing.md}
              style={[
                styles.optionCard,
                option.kind === "venue" ? styles.optionVenueCard : null,
              ]}
            >
              <View
                style={[
                  styles.optionInner,
                  option.kind === "venue" ? styles.optionInnerVenue : null,
                ]}
              >
                <Icon name={option.icon} size={28} color={accent.warm} />
                <View
                  style={[
                    styles.optionText,
                    option.kind === "venue" ? styles.optionTextVenue : null,
                  ]}
                >
                  <Text style={styles.optionTitle}>{option.label}</Text>
                  <Text style={styles.optionSubhead}>{option.subhead}</Text>
                  <Text style={styles.readinessLabel}>
                    {readinessLabel(option.kind, payoutState)}
                  </Text>
                </View>
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
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  gridWide: {
    maxWidth: 720,
  },
  optionPressable: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 132,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.lg,
  },
  optionVenuePressable: {
    flexBasis: "100%",
    minHeight: 104,
  },
  optionFocused: {
    borderColor: accent.warm,
  },
  optionPressed: {
    opacity: 0.88,
  },
  optionCard: {
    flex: 1,
    minHeight: 128,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
  },
  optionVenueCard: {
    minHeight: 100,
  },
  optionInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  optionInnerVenue: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: spacing.md,
  },
  optionText: {
    alignItems: "center",
    gap: spacing.xxs,
  },
  optionTextVenue: {
    flex: 1,
    alignItems: "flex-start",
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
  readinessLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    color: textTokens.secondary,
    textAlign: "center",
  },
  payoutNotice: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    marginBottom: spacing.xs,
  },
  payoutNoticeTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  payoutNoticeBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
});

export default OfferingChooser;
