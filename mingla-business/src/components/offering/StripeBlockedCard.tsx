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
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export interface StripeBlockedCardProps {
  /** Card title. Defaults to the event copy (byte-identical refactor). */
  title?: string;
  /** Card body. Defaults to the event copy. */
  body?: string;
  /** CTA button label. Defaults to the event copy ("Connect bank"). */
  ctaLabel?: string;
  /** Connect-Stripe CTA handler. */
  onConnectStripe: () => void;
  testID?: string;
}

export const StripeBlockedCard: React.FC<StripeBlockedCardProps> = ({
  title = "Bank required for paid tickets",
  body = "Connect a bank to publish. Free tickets can be published any time.",
  ctaLabel = "Connect bank",
  onConnectStripe,
  testID,
}) => (
  <GlassCard
    variant="base"
    padding={space[4]}
    style={styles.warnCard}
    testID={testID}
  >
    <View style={styles.statusRow}>
      <Icon name="flag" size={20} color={color.accent} />
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
      <Icon name="chevR" size={14} color={color.accent} />
    </Pressable>
  </GlassCard>
);

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  statusSub: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: 2,
    lineHeight: type.caption.lineHeight * 1.4,
  },
  warnCard: {
    borderColor: color.accentLine,
    borderWidth: 1,
  },
  connectStripeBtn: {
    marginTop: space[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  connectStripeLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
});
