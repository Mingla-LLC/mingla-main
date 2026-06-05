/**
 * StripeBlockedCard — ORCH-1076 Stream B [proactive publish banners].
 *
 * Shared proactive "Connect Stripe to publish" status card consumed by all
 * three creator wizards (event Step 7, trip review, experience Pricing/Cover
 * steps). Extracted VERBATIM from the event Step-7 private `StripeBlockedCard`
 * (CreatorStep7Preview.tsx:221-248 + the warnCard/statusRow/statusTitle/
 * statusSub/connectStripeBtn/connectStripeLabel styles, lines 350-391) so the
 * event refactor is byte-identical: the default props reproduce the event copy
 * + look exactly. Trip + experience pass their own title/body/ctaLabel (§6 of
 * SPEC_ORCH-1076_STREAM_B_PUBLISH_BANNERS.md); the look/tokens never change.
 *
 * The CTA routes to `brandStripeOnboardingRoute(brandId)` at the call site —
 * the SAME builder the reactive ORCH-1075 catches use (paidPublishGuards.ts:106).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export interface StripeBlockedCardProps {
  /** Card title. Defaults to the event copy (byte-identical refactor). */
  title?: string;
  /** Card body. Defaults to the event copy. */
  body?: string;
  /** CTA button label. Defaults to the event copy ("Connect Stripe"). */
  ctaLabel?: string;
  /** Connect-Stripe CTA handler. */
  onConnectStripe: () => void;
  testID?: string;
}

export const StripeBlockedCard: React.FC<StripeBlockedCardProps> = ({
  title = "Stripe required for paid tickets",
  body = "Connect Stripe to publish. Free tickets can be published any time.",
  ctaLabel = "Connect Stripe",
  onConnectStripe,
  testID,
}) => (
  <GlassCard
    variant="base"
    padding={spacing.md}
    style={styles.warnCard}
    testID={testID}
  >
    <View style={styles.statusRow}>
      <Icon name="flag" size={20} color={accent.warm} />
      <View style={styles.statusTextCol}>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusSub}>{body}</Text>
      </View>
    </View>
    <Pressable
      onPress={onConnectStripe}
      accessibilityRole="button"
      accessibilityLabel={ctaLabel}
      style={styles.connectStripeBtn}
    >
      <Text style={styles.connectStripeLabel}>{ctaLabel}</Text>
      <Icon name="chevR" size={14} color={accent.warm} />
    </Pressable>
  </GlassCard>
);

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  statusSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
    lineHeight: typography.caption.lineHeight * 1.4,
  },
  warnCard: {
    borderColor: accent.border,
    borderWidth: 1,
  },
  connectStripeBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  connectStripeLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});
