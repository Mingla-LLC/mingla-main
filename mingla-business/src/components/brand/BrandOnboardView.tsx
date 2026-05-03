/**
 * BrandOnboardView — Stripe Connect onboarding shell (J-A10 §5.3.8).
 *
 * Cycle 2 stub: WebView placeholder with simulated 3-state machine
 * (loading → complete → done navigates back; long-press header → failed).
 *
 * State machine:
 *   loading (1.5s simulated) → complete  [auto-advance]
 *   complete → calls onAfterDone()        [Done button]
 *   failed  → loading                     [Try again button]
 *   failed  → onCancel()                  [Cancel button]
 *
 * Long-press the "Stripe onboarding" header to flip into the failed
 * state — TRANSITIONAL dev gesture for QA. Exits when B2 wires real
 * Stripe SDK that can fail naturally.
 *
 * Custom TopBar (Cancel left + long-pressable centered title) inlined
 * because the kit's TopBar primitive doesn't support long-press on
 * title — composing this row locally rather than fighting the primitive.
 *
 * Per J-A10 spec §3.6.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";

// [TRANSITIONAL] simulated loading delay — replaced by real Stripe SDK
// onboarding flow in B2 backend cycle. The 1.5s beat creates a perceptible
// "Loading…" state so the UX feels real even though the in-memory state
// machine resolves synchronously.
const SIMULATED_LOADING_MS = 1500;

type OnboardingState = "loading" | "complete" | "failed";

export interface BrandOnboardViewProps {
  brand: Brand | null;
  onCancel: () => void;
  onAfterDone: () => void;
}

export const BrandOnboardView: React.FC<BrandOnboardViewProps> = ({
  brand,
  onCancel,
  onAfterDone,
}) => {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<OnboardingState>("loading");

  // Auto-advance from loading → complete after simulated delay.
  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => {
      setState("complete");
    }, SIMULATED_LOADING_MS);
    return (): void => clearTimeout(timer);
  }, [state]);

  // [TRANSITIONAL] dev gesture for QA — long-press the header to flip
  // into the failed state for visual review. Exits when B2 wires real
  // Stripe SDK that can fail naturally during onboarding submission.
  const handleHeaderLongPress = useCallback((): void => {
    setState((prev) => (prev === "failed" ? "loading" : "failed"));
  }, []);

  const handleDone = useCallback((): void => {
    onAfterDone();
  }, [onAfterDone]);

  const handleTryAgain = useCallback((): void => {
    setState("loading");
  }, []);

  // ----- Not-found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button
              label="Cancel"
              onPress={onCancel}
              variant="ghost"
              size="sm"
            />
          </View>
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
          <View style={styles.topBarSlot} />
        </View>
        <View style={styles.notFoundWrap}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to onboard doesn{"’"}t exist or has been
              removed.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back"
                onPress={onCancel}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </View>
      </View>
    );
  }

  // ----- Populated states -----

  return (
    <View style={styles.host}>
      {/* Custom TopBar — Cancel left + long-pressable title + empty right.
          Composed inline because kit TopBar primitive doesn't support
          long-press on the title. */}
      <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
        <View style={styles.topBarSlot}>
          <Button
            label="Cancel"
            onPress={onCancel}
            variant="ghost"
            size="sm"
          />
        </View>
        <Pressable
          onLongPress={handleHeaderLongPress}
          accessibilityRole="header"
          accessibilityLabel="Stripe onboarding"
          delayLongPress={500}
        >
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
        </Pressable>
        <View style={styles.topBarSlot} />
      </View>

      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {state === "loading" ? (
          <View style={styles.stateBlock}>
            <Spinner size={48} color={accent.warm} />
            <Text style={styles.stateTitle}>Loading Stripe onboarding…</Text>
            <Text style={styles.stateSub}>
              [TRANSITIONAL] This will be a real WebView in B2.
            </Text>
          </View>
        ) : null}

        {state === "complete" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleSuccess]}>
                <Icon name="check" size={32} color={accent.warm} />
              </View>
              <Text style={styles.stateTitle}>Onboarding submitted</Text>
              <Text style={styles.stateSub}>
                Stripe is verifying your details. We{"’"}ll email you when
                ready.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Done"
                onPress={handleDone}
                variant="primary"
                size="lg"
                fullWidth
              />
            </View>
          </>
        ) : null}

        {state === "failed" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                {/* W-1: alert/info absent in kit; flag = action-needed */}
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>Onboarding couldn{"’"}t complete</Text>
              <Text style={styles.stateSub}>
                Try again or contact support.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Try again"
                onPress={handleTryAgain}
                variant="primary"
                size="lg"
                fullWidth
              />
              <Button
                label="Cancel"
                onPress={onCancel}
                variant="secondary"
                size="md"
                fullWidth
              />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },

  // Custom TopBar --------------------------------------------------------
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 56,
  },
  topBarSlot: {
    flexShrink: 0,
    minWidth: 80,
  },
  topBarTitle: {
    flex: 1,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },

  // Body -----------------------------------------------------------------
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    gap: spacing.xl,
  },
  stateBlock: {
    alignItems: "center",
    gap: spacing.md,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  stateIconCircleSuccess: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  stateIconCircleFailed: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  stateTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateSub: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  actionsCol: {
    gap: spacing.sm,
  },

  // Not-found ------------------------------------------------------------
  notFoundWrap: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
});

export default BrandOnboardView;
