/**
 * Ve3 — surfaces physical-venue claim_status on Hub screens.
 *
 * ORCH-1064 — the `follow_up` variant becomes interactive: a tappable tile with
 * a leading icon, an open-count (or "Ready") badge, a trailing chevron, and
 * press feedback, opening the feedback sheet. The other 3 variants
 * (pending_review / verified / rejected) stay byte-identical static Views.
 * DESIGN_ORCH-1064 §2.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { Icon } from "../ui/Icon";
import {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "../../services/venueClaimService";

interface VenueClaimStatusBannerProps {
  brand: Brand | null | undefined;
  /** ORCH-1064 — count of open feedback items in the active round (follow_up only). */
  openCount?: number;
  /** ORCH-1064 — opens the feedback sheet (follow_up only). */
  onPressFeedback?: () => void;
}

export function VenueClaimStatusBanner({
  brand,
  openCount = 0,
  onPressFeedback,
}: VenueClaimStatusBannerProps): React.ReactElement | null {
  const handlePress = useCallback((): void => {
    HapticFeedback.buttonPress();
    onPressFeedback?.();
  }, [onPressFeedback]);

  if (brand === null || brand === undefined) {
    return null;
  }

  const variant = venueClaimBannerVariant({
    claim_status: brand.claimStatus ?? "none",
    rejection_reason: brand.rejectionReason ?? null,
    claim_follow_up_at: brand.claimFollowUpAt ?? null,
  });

  if (variant === null) {
    return null;
  }

  const copy = venueClaimBannerCopy(variant, brand.rejectionReason);
  if (copy === null) return null;

  // ── ORCH-1064 — interactive follow_up tile ─────────────────────────────────
  if (variant === "follow_up") {
    const allFixed = openCount === 0;
    // DESIGN §2.4 — openCount===0 (all addressed, not yet re-submitted) swaps to
    // the "Ready" success badge + check icon + the re-submit nudge body.
    const body = allFixed
      ? "Nice — everything's addressed. Tap to re-submit for review."
      : copy.body;
    const a11yLabel = allFixed
      ? "Venue updates requested, everything addressed, tap to re-submit"
      : `Venue updates requested, ${openCount} to fix, tap to review feedback`;

    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Opens the feedback list"
        style={({ pressed }) => [
          styles.wrap,
          styles.toneWarning,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.headerRow}>
          <Icon
            name={allFixed ? "check" : "flag"}
            size={18}
            color={allFixed ? semantic.success : semantic.warning}
          />
          <Text style={[styles.title, styles.titleInline]}>{copy.title}</Text>
          {allFixed ? (
            <View style={[styles.badge, styles.badgeReady]}>
              <Text style={[styles.badgeText, styles.badgeTextReady]}>Ready</Text>
            </View>
          ) : openCount > 0 ? (
            <View style={[styles.badge, styles.badgeCount]}>
              <Text style={[styles.badgeText, styles.badgeTextCount]}>
                {openCount === 1 ? "1 to fix" : `${openCount} to fix`}
              </Text>
            </View>
          ) : null}
          <Icon name="chevR" size={18} color={textTokens.tertiary} />
        </View>
        <Text style={[styles.body, styles.bodyFollowUp]}>{body}</Text>
      </Pressable>
    );
  }

  // ── unchanged static variants (byte-identical to pre-ORCH-1064) ────────────
  const toneStyle =
    variant === "rejected"
      ? styles.toneError
      : styles.toneInfo;

  return (
    <View style={[styles.wrap, toneStyle]} accessibilityRole="summary">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    ...typography.bodySm,
    fontWeight: "600",
    marginBottom: spacing.xs,
    color: textTokens.primary,
  },
  titleInline: {
    flex: 1,
    marginBottom: 0,
  },
  body: {
    ...typography.caption,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  bodyFollowUp: {
    marginTop: spacing.xs,
  },
  badge: {
    borderRadius: radius.full,
    minWidth: 18,
    height: 22,
    paddingHorizontal: spacing.sm,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeCount: {
    backgroundColor: semantic.warning,
  },
  badgeReady: {
    backgroundColor: semantic.success,
  },
  badgeText: {
    ...typography.micro,
  },
  badgeTextCount: {
    color: "#1a1206",
  },
  badgeTextReady: {
    color: "#04210f",
  },
  toneError: {
    backgroundColor: semantic.errorTint,
    borderColor: semantic.error,
  },
  toneWarning: {
    backgroundColor: semantic.warningTint,
    borderColor: semantic.warning,
  },
  toneInfo: {
    backgroundColor: semantic.infoTint,
    borderColor: semantic.info,
  },
});
