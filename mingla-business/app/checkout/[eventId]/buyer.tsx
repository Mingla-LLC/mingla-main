/**
 * J-C2 — Buyer Details screen.
 *
 * Route: /checkout/{eventId}/buyer
 *
 * Buyer types name + email + optional phone + marketing opt-in. Validation
 * runs inline on each field. Continue button disabled until name + email
 * pass validation.
 *
 * On Continue:
 *   - Free order (totals.totalGbp === 0) → generate stub OrderResult
 *     synchronously + recordResult + router.replace to /confirm. Skips
 *     Payment + 3DS entirely (Q-C5).
 *   - Paid order → router.push to /checkout/{eventId}/payment.
 *
 * Keyboard handling lifted from EventCreatorWizard.tsx pattern (Keyboard
 * listener + dynamic paddingBottom + deferred scrollToEnd via
 * requestAnimationFrame). Memory rule: keyboard never blocks an Input.
 *
 * Per Cycle 8 spec §4.5 + §4.7.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import { formatGbp } from "../../../src/utils/currency";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import {
  generateOrderId,
  generateTicketId,
} from "../../../src/utils/stubOrderId";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN_CHARS = 2;
const PHONE_MIN_CHARS = 7;

interface ValidationState {
  nameError: string | null;
  emailError: string | null;
  phoneError: string | null;
  isValid: boolean;
}

const validate = (
  name: string,
  email: string,
  phone: string,
  showErrors: boolean,
): ValidationState => {
  const nameTrim = name.trim();
  const emailTrim = email.trim();
  const phoneTrim = phone.trim();

  const nameValid = nameTrim.length >= NAME_MIN_CHARS;
  const emailValid = EMAIL_REGEX.test(emailTrim);
  const phoneValid = phoneTrim.length === 0 || phoneTrim.length >= PHONE_MIN_CHARS;

  return {
    nameError:
      showErrors && !nameValid ? "Please enter your full name" : null,
    emailError:
      showErrors && !emailValid ? "Enter a valid email" : null,
    phoneError:
      showErrors && !phoneValid ? "Enter a valid phone or leave blank" : null,
    isValid: nameValid && emailValid && phoneValid,
  };
};

export default function CheckoutBuyerScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const event = useLiveEventStore((s) =>
    eventId === null ? null : s.events.find((e) => e.id === eventId) ?? null,
  );
  const { lines, buyer, setBuyer, recordResult } = useCart();
  const totals = useCartTotals();

  // Touched flags — show validation errors only after first focus blur,
  // so a fresh-mount form doesn't immediately scream red.
  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [phoneTouched, setPhoneTouched] = useState<boolean>(false);

  // ----- Keyboard pattern (lifted from EventCreatorWizard) ---------
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const pendingScrollToBottomRef = useRef<boolean>(false);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(
      showEvent,
      (e: KeyboardEvent): void => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardHeight > 0 && pendingScrollToBottomRef.current) {
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
    if (keyboardHeight === 0) {
      pendingScrollToBottomRef.current = false;
    }
  }, [keyboardHeight]);

  const requestScrollToInput = useCallback((): void => {
    pendingScrollToBottomRef.current = true;
    if (keyboardHeight > 0) {
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [keyboardHeight]);

  // ----- Validation ----------------------------------------------------
  const showErrorsForName = nameTouched;
  const showErrorsForEmail = emailTouched;
  const showErrorsForPhone = phoneTouched;
  const validation = useMemo<ValidationState>(
    () =>
      validate(
        buyer.name,
        buyer.email,
        buyer.phone,
        false, // we render per-field errors below using individual touched flags
      ),
    [buyer.name, buyer.email, buyer.phone],
  );
  // Per-field error rendering — show only when touched AND invalid
  const visibleErrors = useMemo<{
    name: string | null;
    email: string | null;
    phone: string | null;
  }>(() => {
    const v = validate(buyer.name, buyer.email, buyer.phone, true);
    return {
      name: showErrorsForName ? v.nameError : null,
      email: showErrorsForEmail ? v.emailError : null,
      phone: showErrorsForPhone ? v.phoneError : null,
    };
  }, [
    buyer.name,
    buyer.email,
    buyer.phone,
    showErrorsForName,
    showErrorsForEmail,
    showErrorsForPhone,
  ]);

  // ----- Defensive guard: cart empty / event missing ----------------
  const hasNoLines = lines.length === 0;
  useEffect(() => {
    if (hasNoLines && eventId !== null) {
      router.replace(`/checkout/${eventId}` as never);
    }
  }, [hasNoLines, eventId, router]);

  // ----- Handlers ---------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (eventId !== null) {
      router.replace(`/checkout/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleContinue = useCallback((): void => {
    // Mark all fields touched so any validation errors render
    setNameTouched(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    if (!validation.isValid) return;
    if (eventId === null) return;
    if (totals.isFree) {
      // Free-skip path — generate stub OrderResult synchronously, no
      // payment + 3DS detour. Per Q-C5 + spec §4.7.
      const orderId = generateOrderId();
      const ticketIds: string[] = [];
      lines.forEach((line, lineIdx) => {
        for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
          ticketIds.push(generateTicketId(orderId, lineIdx, seatIdx));
        }
      });
      recordResult({
        orderId,
        ticketIds,
        paidAt: new Date().toISOString(),
        paymentMethod: "free",
        totalGbp: 0,
      });
      router.replace(`/checkout/${eventId}/confirm` as never);
      return;
    }
    router.push(`/checkout/${eventId}/payment` as never);
  }, [
    validation.isValid,
    eventId,
    totals.isFree,
    lines,
    recordResult,
    router,
  ]);

  const continueLabel = totals.isFree
    ? "Reserve free ticket"
    : "Continue to payment";

  if (event === null || hasNoLines) {
    // Render an empty shell — useEffect above redirects on the next tick.
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={1}
          totalSteps={3}
          title="Your details"
          onBack={handleBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={1}
        totalSteps={3}
        title="Your details"
        onBack={handleBack}
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Order summary recap */}
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Edit ticket selection"
          style={({ pressed }) => [
            styles.summaryWrap,
            pressed && styles.summaryPressed,
          ]}
        >
          <GlassCard variant="base" radius="lg" padding={spacing.md}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryHeaderText}>Order summary</Text>
              <Text style={styles.summaryEditText}>Edit</Text>
            </View>
            {lines.map((l) => (
              <View key={l.ticketTypeId} style={styles.summaryLine}>
                <Text style={styles.summaryLineQty}>{l.quantity}×</Text>
                <Text style={styles.summaryLineName} numberOfLines={1}>
                  {l.ticketName}
                </Text>
                <Text style={styles.summaryLineTotal}>
                  {l.isFree
                    ? "Free"
                    : formatGbp(l.unitPriceGbp * l.quantity)}
                </Text>
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={styles.summaryTotalValue}>
                {totals.isFree ? "Free" : formatGbp(totals.totalGbp)}
              </Text>
            </View>
          </GlassCard>
        </Pressable>

        <Text style={styles.sectionLabel}>Buyer details</Text>

        {/* Name */}
        <View style={styles.fieldWrap}>
          <Input
            value={buyer.name}
            onChangeText={(next) => setBuyer({ name: next })}
            variant="text"
            placeholder="Full name"
            accessibilityLabel="Full name"
            onFocus={requestScrollToInput}
            onBlur={() => setNameTouched(true)}
          />
          {visibleErrors.name !== null ? (
            <Text style={styles.errorText}>{visibleErrors.name}</Text>
          ) : null}
        </View>

        {/* Email */}
        <View style={styles.fieldWrap}>
          <Input
            value={buyer.email}
            onChangeText={(next) => setBuyer({ email: next })}
            variant="email"
            placeholder="Email"
            accessibilityLabel="Email address"
            onFocus={requestScrollToInput}
            onBlur={() => setEmailTouched(true)}
          />
          {visibleErrors.email !== null ? (
            <Text style={styles.errorText}>{visibleErrors.email}</Text>
          ) : null}
        </View>

        {/* Phone (optional) */}
        <View style={styles.fieldWrap}>
          <Input
            value={buyer.phone}
            onChangeText={(next) => setBuyer({ phone: next })}
            variant="text"
            placeholder="Phone (optional)"
            accessibilityLabel="Phone number, optional"
            onFocus={requestScrollToInput}
            onBlur={() => setPhoneTouched(true)}
          />
          {visibleErrors.phone !== null ? (
            <Text style={styles.errorText}>{visibleErrors.phone}</Text>
          ) : null}
        </View>

        {/* Marketing opt-in */}
        <Pressable
          onPress={() => setBuyer({ marketingOptIn: !buyer.marketingOptIn })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: buyer.marketingOptIn }}
          accessibilityLabel="Email me about this organiser's future events"
          style={({ pressed }) => [
            styles.checkboxRow,
            pressed && styles.checkboxRowPressed,
          ]}
        >
          <View
            style={[
              styles.checkboxBox,
              buyer.marketingOptIn && styles.checkboxBoxChecked,
            ]}
          >
            {buyer.marketingOptIn ? (
              <Icon name="check" size={14} color={textTokens.primary} />
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>
            Email me about this organiser&apos;s future events
          </Text>
        </Pressable>
      </ScrollView>

      {/* Sticky bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
          keyboardHeight > 0 ? styles.bottomBarHidden : null,
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {totals.isFree ? "Free" : formatGbp(totals.totalGbp)}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!validation.isValid}
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  // Order summary recap
  summaryWrap: {
    marginBottom: spacing.lg,
  },
  summaryPressed: {
    opacity: 0.7,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  summaryHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
  },
  summaryEditText: {
    fontSize: 12,
    fontWeight: "600",
    color: accent.warm,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: spacing.sm,
  },
  summaryLineQty: {
    fontSize: 14,
    color: textTokens.tertiary,
    fontWeight: "500",
    minWidth: 28,
  },
  summaryLineName: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "500",
  },
  summaryLineTotal: {
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "600",
  },
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryTotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  summaryTotalValue: {
    fontSize: 17,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  // Field wrappers
  fieldWrap: {
    marginBottom: spacing.md,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: semantic.error,
    fontWeight: "500",
  },
  // Checkbox row
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  checkboxRowPressed: {
    opacity: 0.7,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: radiusTokens.sm,
    borderWidth: 1.5,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  // Sticky bottom bar
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  // When keyboard is up, hide the absolute-positioned bottom bar
  // so it doesn't sit between focused input and keyboard. The
  // ScrollView's increased paddingBottom + scrollToEnd brings the
  // focused field into view above the keyboard.
  bottomBarHidden: {
    transform: [{ translateY: 200 }],
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  totalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  totalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
