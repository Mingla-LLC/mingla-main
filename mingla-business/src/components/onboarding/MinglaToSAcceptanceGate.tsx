/**
 * MinglaToSAcceptanceGate — pre-Stripe gate for Mingla Business platform ToS.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-17 + I-PROPOSED-U.
 *
 * Behavior:
 *  - If user has already accepted current version → renders nothing (silent).
 *  - If not accepted → renders a sheet with scrollable ToS body + "I agree"
 *    checkbox + "Accept and continue" CTA. Cannot be dismissed without
 *    accepting (gate is mandatory before Stripe onboarding).
 *
 * Mounted in BrandOnboardView's idle state ABOVE the country picker so the
 * gate fires first.
 *
 * [TRANSITIONAL] ToS body copy is a placeholder — exit when legal signs off
 * the V3 copy and operator swaps in the live text.
 */

import React, { useCallback, useState } from "react";
import {
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
  useAcceptMinglaToS,
  useMinglaToSAcceptance,
} from "../../hooks/useMinglaToSAcceptance";

interface MinglaToSAcceptanceGateProps {
  brandId: string;
  userId: string;
  /** Fired when acceptance succeeds OR if already-accepted on mount */
  onPassed: () => void;
}

// [TRANSITIONAL] Placeholder ToS body. Operator/legal swaps before launch.
const PLACEHOLDER_TOS_BODY = [
  "Mingla Business is a marketplace platform that helps you accept payments for events. By using Mingla Business, you agree to the terms below.",
  "",
  "1. Mingla acts as the merchant of record for ticket sales processed through this platform. You are the seller of record for the events themselves.",
  "",
  "2. Mingla collects an application fee on each ticket sale. The fee is disclosed at checkout and reported on your payouts.",
  "",
  "3. Refunds and chargebacks for tickets sold via Mingla are absorbed by Mingla. We may pause your payouts if dispute volume exceeds Stripe's risk thresholds.",
  "",
  "4. You authorise Mingla to share your business and identity verification details with Stripe, our payment processor, to enable payouts.",
  "",
  "5. You acknowledge that Stripe is the 1099-K filer for US sellers; Mingla does not file tax forms on your behalf.",
  "",
  "6. You may disconnect your Stripe Connect account at any time via the Mingla Business app. Pending payouts and refunds in flight will continue to settle.",
  "",
  "7. Mingla may update these terms; material changes require re-acceptance before further onboarding actions.",
  "",
  "Full Terms of Service will be available at mingla.com/business/terms before live launch.",
].join("\n");

export function MinglaToSAcceptanceGate({
  brandId,
  userId,
  onPassed,
}: MinglaToSAcceptanceGateProps): React.ReactElement | null {
  const acceptanceQuery = useMinglaToSAcceptance(brandId, userId);
  const acceptMutation = useAcceptMinglaToS();
  const [agreed, setAgreed] = useState(false);

  // Already-accepted bypass: any non-null acceptedAt satisfies the gate.
  // Version-bump re-acceptance is a separate UX (operator-driven via push
  // notification when ToS materially changes).
  const accepted = acceptanceQuery.data?.acceptedAt != null;

  // When acceptance state is known and positive, fire onPassed once.
  React.useEffect(() => {
    if (accepted) onPassed();
  }, [accepted, onPassed]);

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

  // While loading the acceptance query OR after successful acceptance, show
  // nothing (parent renders normally). The sheet only shows when we KNOW
  // the user hasn't accepted.
  if (acceptanceQuery.isLoading || accepted) {
    return null;
  }

  if (acceptanceQuery.isError) {
    // Fail-open is dangerous (lets users skip the gate). Fail-closed but
    // give them a retry path.
    return (
      <Sheet visible onClose={() => undefined}>
        <View style={styles.body}>
          <Text style={styles.title}>Couldn't load Terms of Service</Text>
          <Text style={styles.bodyText}>
            We need to confirm you've accepted Mingla's Business platform
            terms before you can connect Stripe. Try again in a moment.
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
        <Text style={styles.title}>Accept Mingla Business terms</Text>
        <Text style={styles.subtitle}>
          A quick read before we connect your Stripe account.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.tosBody}>{PLACEHOLDER_TOS_BODY}</Text>
        </ScrollView>

        <Pressable
          onPress={(): void => {
            void Haptics.selectionAsync();
            setAgreed((prev) => !prev);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Mingla Business Platform Terms"
          style={styles.agreeRow}
        >
          <View style={[styles.checkbox, agreed ? styles.checkboxOn : null]}>
            {agreed ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.agreeText}>
            I agree to the Mingla Business Platform Terms.
          </Text>
        </Pressable>

        {acceptMutation.isError ? (
          <Text style={styles.error}>
            Couldn't save your acceptance. Tap "Accept and continue" to retry.
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
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.sm,
  },
  scrollContent: {
    paddingVertical: spacing.md,
  },
  tosBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
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
