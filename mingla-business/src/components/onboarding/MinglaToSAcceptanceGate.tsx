/**
 * MinglaToSAcceptanceGate — mandatory Organiser Terms gate for Mingla Host.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-17 + I-PROPOSED-U + #3645 PR11c.
 *
 * Behavior:
 *  - If user has accepted CURRENT_MINGLA_TOS_VERSION → renders nothing; fires onPassed.
 *  - Otherwise → non-dismissible sheet with short summary, link to the public
 *    Organiser Terms, checkbox, and Accept CTA.
 *
 * Full legal text lives at ORGANISER_TERMS_URL (usemingla.com/organiser-terms).
 * This sheet does not duplicate the website body.
 */

import React, { useCallback, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { Sheet } from "../ui/Sheet";
import { Spinner } from "../ui/Spinner";
import {
  spacing,
  radius,
  typography,
  text as textTokens,
  accent,
  semantic,
  glass,
} from "../../constants/designSystem";
import {
  CURRENT_MINGLA_TOS_VERSION,
  ORGANISER_TERMS_URL,
  isCurrentMinglaToSAccepted,
  useAcceptMinglaToS,
  useMinglaToSAcceptance,
} from "../../hooks/useMinglaToSAcceptance";

interface MinglaToSAcceptanceGateProps {
  brandId: string;
  userId: string;
  /** Fired when acceptance succeeds OR if already-accepted on mount */
  onPassed: () => void;
  /**
   * Optional context line under the title (defaults to a rail-neutral prompt).
   * Keep free of payout lies — #1180 scans this file.
   */
  subtitle?: string;
}

/** Short summary only — full text is on the website. Keep #1180 timing honest. */
const ORGANISER_TERMS_SUMMARY = [
  "Mingla Host lets you list and sell events, trips, experiences, stays and more. You are the seller; Mingla provides the software and payment rails.",
  "",
  "By continuing you agree to the Mingla Organiser Terms (Version " +
    CURRENT_MINGLA_TOS_VERSION +
    "). Those terms cover who sells, fees, refunds and chargebacks, payouts, and when Mingla may pause payouts.",
  "",
  // #1180 — honest payout timing (binding meaning; legal source of truth is the website).
  "Ticket and booking revenue is released to your payout account about a day after each payment, and typically arrives within 1–2 business days. In Nigeria, bank transfer fees and stamp duty are deducted from your payout.",
  "",
  "Open the full Organiser Terms below before you accept.",
].join("\n");

export function MinglaToSAcceptanceGate({
  brandId,
  userId,
  onPassed,
  subtitle = "A quick read before you sell or connect payouts.",
}: MinglaToSAcceptanceGateProps): React.ReactElement | null {
  const acceptanceQuery = useMinglaToSAcceptance(brandId, userId);
  const acceptMutation = useAcceptMinglaToS();
  const [agreed, setAgreed] = useState(false);

  const accepted = isCurrentMinglaToSAccepted(acceptanceQuery.data);

  React.useEffect(() => {
    if (accepted) onPassed();
  }, [accepted, onPassed]);

  const handleOpenTerms = useCallback((): void => {
    void Linking.openURL(ORGANISER_TERMS_URL);
  }, []);

  const handleAccept = useCallback((): void => {
    if (!agreed || acceptMutation.isPending) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    acceptMutation.mutate(
      { brandId, userId, version: CURRENT_MINGLA_TOS_VERSION },
      {
        onSuccess: () => {
          onPassed();
        },
      },
    );
  }, [agreed, acceptMutation, brandId, userId, onPassed]);

  if (acceptanceQuery.isLoading || accepted) {
    return null;
  }

  if (acceptanceQuery.isError) {
    return (
      <Sheet visible onClose={() => undefined}>
        <View style={styles.body}>
          <Text style={styles.title}>Couldn{"'"}t load Organiser Terms</Text>
          <Text style={styles.bodyText}>
            We need to confirm you{"'"}ve accepted Mingla{"'"}s Organiser Terms
            before you continue. Try again in a moment.
          </Text>
          <Pressable
            onPress={(): void => {
              void acceptanceQuery.refetch();
            }}
            style={styles.cta}
            accessibilityRole="button"
            accessibilityLabel="Retry loading terms"
          >
            <Text style={styles.ctaText}>Try again</Text>
          </Pressable>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible onClose={() => undefined}>
      <View style={styles.body}>
        <Text style={styles.title}>Accept Organiser Terms</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.tosBody}>{ORGANISER_TERMS_SUMMARY}</Text>
          <Pressable
            onPress={handleOpenTerms}
            accessibilityRole="link"
            accessibilityLabel="Open Mingla Organiser Terms in browser"
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>
              Read the full Organiser Terms at usemingla.com/organiser-terms
            </Text>
          </Pressable>
        </ScrollView>

        <Pressable
          onPress={(): void => {
            void Haptics.selectionAsync();
            setAgreed((prev) => !prev);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Mingla Organiser Terms"
          style={styles.agreeRow}
        >
          <View style={[styles.checkbox, agreed ? styles.checkboxOn : null]}>
            {agreed ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.agreeText}>
            I agree to the Mingla Organiser Terms (Version{" "}
            {CURRENT_MINGLA_TOS_VERSION}).
          </Text>
        </Pressable>

        {acceptMutation.isError ? (
          <Text style={styles.error}>
            Couldn{"'"}t save your acceptance. Tap Accept and continue to retry.
          </Text>
        ) : null}

        <Pressable
          onPress={handleAccept}
          disabled={!agreed || acceptMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel="Accept and continue"
          accessibilityState={{ disabled: !agreed || acceptMutation.isPending }}
          style={({ pressed }) => [
            styles.cta,
            !agreed ? styles.ctaDisabled : null,
            pressed && agreed ? styles.ctaPressed : null,
          ]}
        >
          {acceptMutation.isPending ? (
            <Spinner size={24} color={"#ffffff"} />
          ) : (
            <Text style={styles.ctaText}>Accept and continue</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  bodyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    paddingVertical: spacing.sm,
  },
  scroll: {
    flex: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.sm,
  },
  scrollContent: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  tosBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  linkRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  linkText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: accent.warm,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  checkboxMark: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  agreeText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  error: {
    fontSize: typography.bodySm.fontSize,
    color: semantic.error,
  },
  cta: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    fontSize: typography.body.fontSize,
    color: "#ffffff",
    fontWeight: "700",
    letterSpacing: 0.4,
  },
});

export default MinglaToSAcceptanceGate;
