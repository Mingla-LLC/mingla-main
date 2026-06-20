/**
 * J-C2 — Buyer Details screen.
 *
 * Route: /checkout/{eventId}/buyer
 *
 * Buyer types name + email + required phone + marketing opt-in. Validation
 * runs inline on each field. Continue button disabled until name + email
 * pass validation.
 *
 * On Continue:
 *   - Free order (totals.total === 0) → create server order/tickets and route
 *     to /confirm after durable sales rows exist.
 *   - Paid order → router.push to /checkout/{eventId}/payment.
 *
 * Keyboard handling lifted from EventCreatorWizard.tsx pattern (Keyboard
 * listener + dynamic paddingBottom + deferred scrollToEnd via
 * requestAnimationFrame). Memory rule: keyboard never blocks an Input.
 *
 * Per Cycle 8 spec §4.5 + §4.7.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header: insets.bottom IS applied (line 409 + 582) for home-indicator clearance; the top status-bar overlap with back arrow / "Your details" header / "2 OF 3" pill is the intended banner-style buyer aesthetic. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 19-CHECKOUT-BUYER.png).

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
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
// ORCH-1162 Bug 3 — brand-accent for the checkout CTA, matching the public page.
import { resolveCheckoutBrandAccent } from "../../../src/utils/checkoutBrandAccent";
import { formatCurrency } from "../../../src/utils/currency";
import { isValidE164, composeE164 } from "../../../src/utils/phone";
import { createTicketCheckout } from "../../../src/services/ticketCheckoutService";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";

// ORCH-0847 Phase B — country-picker phone input shared with app-mobile
// auth onboarding. Replaces the prior single-text-field phone Input which
// only validated US-shaped 10/11-digit numbers client-side.
import {
  PhoneInput,
  COUNTRIES,
  getCountryByCode,
  type PhoneInputTheme,
} from "@mingla/phone-input";

// ORCH-0847 Phase B — dark-mode theme tokens for the public buyer form's
// phone field. mingla-business renders on a dark canvas (`#0c0e12`); the
// package's default LIGHT-mode tokens would be unreadable here. Values
// mirror mingla-business's designSystem (`glass`, `text`, `semantic`,
// `accent` from `src/constants/designSystem.ts`).
const PUBLIC_BUYER_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#0c0e12",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  borderDefault: "rgba(255, 255, 255, 0.14)",
  borderFocused: "#eb7825",
  borderError: "#ef4444",
  searchBackground: "rgba(255, 255, 255, 0.06)",
  rowPressedBackground: "rgba(255, 255, 255, 0.04)",
  divider: "rgba(255, 255, 255, 0.08)",
  accessoryBackground: "rgba(12, 14, 18, 0.95)",
  accessoryBorder: "rgba(255, 255, 255, 0.08)",
  accent: "#eb7825",
  errorText: "#ef4444",
};

/**
 * Resolves the initial country ISO-2 code for the phone field per SPEC Q1
 * (locale-first). Order:
 *   1. If buyer.phone is already set (resume case), parse the leading dial
 *      code and use that country.
 *   2. Device locale via `Intl.DateTimeFormat().resolvedOptions().locale` —
 *      e.g., "en-GB" → "GB". expo-localization is not a mingla-business dep
 *      today; Intl works without it.
 *   3. Brand country (forward-prepared — not yet exposed on PublicBrandProps).
 *   4. Fallback to "GB" matching the mingla-business GBP default.
 */
const resolveInitialCountry = (
  existingFullE164: string,
  _brandCountry: string | null,
): string => {
  if (existingFullE164.length > 0) {
    // Sort by descending dialCode length so "+1268" matches before "+1".
    const found = [...COUNTRIES]
      .sort((a, b) => b.dialCode.length - a.dialCode.length)
      .find((c) => existingFullE164.startsWith(c.dialCode));
    if (found) return found.code;
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split("-")[1]?.toUpperCase();
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  } catch {
    // Intl unavailable — fall through.
  }
  return "GB";
};

const splitExistingPhone = (
  existingFullE164: string,
  countryCode: string,
): string => {
  const country = getCountryByCode(countryCode);
  if (!country) return "";
  if (existingFullE164.startsWith(country.dialCode)) {
    return existingFullE164.slice(country.dialCode.length);
  }
  return "";
};
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN_CHARS = 2;

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
  // ORCH-0847 Phase B — phone now stored as full E.164 (PhoneInput composes
  // dial code + local digits). Validate the composed value directly.
  const phoneValid = isValidE164(phoneTrim);

  return {
    nameError:
      showErrors && !nameValid ? "Please enter your full name" : null,
    emailError:
      showErrors && !emailValid ? "Enter a valid email" : null,
    phoneError:
      showErrors && !phoneValid ? "Enter a valid mobile number" : null,
    isValid: nameValid && emailValid && phoneValid,
  };
};

export default function CheckoutBuyerScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const brand = publicEventQuery.data?.brand ?? null;
  // ORCH-1162 Bug 3 — CTA brand accent (matches the public page button).
  const ctaAccent =
    event !== null
      ? (resolveCheckoutBrandAccent({
          brandTheme: brand?.theme ?? null,
          eventThemeOverrides: event.themeOverrides ?? null,
        }) ?? undefined)
      : undefined;
  const { lines, buyer, setBuyer, recordResult } = useCart();
  const totals = useCartTotals();
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Touched flags — show validation errors only after first focus blur,
  // so a fresh-mount form doesn't immediately scream red.
  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [phoneTouched, setPhoneTouched] = useState<boolean>(false);

  // ORCH-0847 Phase B — country-aware phone state. `buyer.phone` in CartContext
  // stores the FULL E.164 string (e.g., "+447700900000"). The PhoneInput
  // component manages country code + local digits separately; we compose
  // them into the full E.164 on every change and write back to the cart.
  const [phoneCountry, setPhoneCountry] = useState<string>(() =>
    resolveInitialCountry(buyer.phone, null),
  );
  const [phoneLocal, setPhoneLocal] = useState<string>(() =>
    splitExistingPhone(buyer.phone, resolveInitialCountry(buyer.phone, null)),
  );

  const handlePhoneLocalChange = useCallback(
    (next: string): void => {
      setPhoneLocal(next);
      const country = getCountryByCode(phoneCountry);
      const dialCode = country?.dialCode ?? "+44";
      const composed = composeE164(dialCode, next);
      setBuyer({ phone: composed ?? "" });
    },
    [phoneCountry, setBuyer],
  );

  const handlePhoneCountryChange = useCallback(
    (nextIso: string): void => {
      setPhoneCountry(nextIso);
      const country = getCountryByCode(nextIso);
      const dialCode = country?.dialCode ?? "+44";
      const composed = composeE164(dialCode, phoneLocal);
      setBuyer({ phone: composed ?? "" });
    },
    [phoneLocal, setBuyer],
  );

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

  const handleContinue = useCallback(async (): Promise<void> => {
    // Mark all fields touched so any validation errors render
    setNameTouched(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    if (!validation.isValid) return;
    if (eventId === null) return;
    setSubmitError(null);
    if (totals.isFree) {
      try {
        setSubmitting(true);
        const result = await createTicketCheckout({ eventId, buyer, lines });
        if (result.kind !== "free_completed") {
          throw new Error("Free checkout unexpectedly required payment.");
        }
        recordResult({
          orderId: result.orderId,
          ticketIds: result.tickets.map((ticket) => ticket.ticketId),
          checkoutSessionId: result.checkoutSessionId,
          paidAt: new Date().toISOString(),
          paymentMethod: "free",
          total: result.totalCents / 100,
          totalCents: result.totalCents,
          currency: result.currency,
          paymentStatus: result.paymentStatus,
          notificationStatus: result.notificationStatus,
          tickets: result.tickets,
        });
        router.replace(`/checkout/${eventId}/confirm` as never);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Could not reserve tickets. Please try again.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    router.push(`/checkout/${eventId}/payment` as never);
  }, [
    validation.isValid,
    eventId,
    totals.isFree,
    totals.currency,
    lines,
    buyer,
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
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 + 42 } : null,
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
                    : formatCurrency(l.unitPrice * l.quantity, l.currency)}
                </Text>
              </View>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={styles.summaryTotalValue}>
                {totals.isFree ? "Free" : formatCurrency(totals.total, totals.currency)}
              </Text>
            </View>
          </GlassCard>
        </Pressable>

        <Text style={styles.sectionLabel}>Buyer details</Text>

        {/* Name */}
        <View style={styles.fieldWrap}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <Text style={styles.required}>*</Text>
          </View>
          <Input
            value={buyer.name}
            onChangeText={(next) => setBuyer({ name: next })}
            variant="text"
            placeholder="Full name"
            accessibilityLabel="Full name, required"
            onFocus={requestScrollToInput}
            onBlur={() => setNameTouched(true)}
          />
          {visibleErrors.name !== null ? (
            <Text style={styles.errorText}>{visibleErrors.name}</Text>
          ) : null}
        </View>

        {/* Email */}
        <View style={styles.fieldWrap}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.required}>*</Text>
          </View>
          <Input
            value={buyer.email}
            onChangeText={(next) => setBuyer({ email: next })}
            variant="email"
            placeholder="Email"
            accessibilityLabel="Email address, required"
            onFocus={requestScrollToInput}
            onBlur={() => setEmailTouched(true)}
          />
          {visibleErrors.email !== null ? (
            <Text style={styles.errorText}>{visibleErrors.email}</Text>
          ) : null}
        </View>

        {/* Phone — ORCH-0847 Phase B PhoneInput with country picker */}
        <View
          style={styles.fieldWrap}
          onTouchStart={requestScrollToInput}
        >
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <Text style={styles.required}>*</Text>
          </View>
          <PhoneInput
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={(next) => {
              handlePhoneLocalChange(next);
              setPhoneTouched(true);
            }}
            onChangeCountry={(nextIso) => {
              handlePhoneCountryChange(nextIso);
              setPhoneTouched(true);
            }}
            error={visibleErrors.phone}
            disabled={false}
            iconRenderer={(name, iconProps) => {
              const iconName =
                name === "chevronDown"
                  ? "chevD"
                  : name === "checkmark"
                    ? "check"
                    : name === "close"
                      ? "close"
                      : "search";
              return (
                <Icon
                  name={iconName}
                  size={iconProps.size}
                  color={iconProps.color}
                />
              );
            }}
            labels={{
              phonePlaceholder: "Mobile number",
              countryButtonAccessibilityLabel: (name) =>
                `Country code, ${name}, tap to change`,
              phoneInputAccessibilityLabel: "Mobile number, required",
              doneButton: "Done",
              pickerTitle: "Select Country",
              pickerSearchPlaceholder: "Search country or dial code",
              pickerCloseAccessibilityLabel: "Close country picker",
            }}
            theme={PUBLIC_BUYER_PHONE_THEME}
          />
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
        {submitError !== null ? (
          <Text style={styles.errorText}>{submitError}</Text>
        ) : null}
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
            {totals.isFree ? "Free" : formatCurrency(totals.total, totals.currency)}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          accentColor={ctaAccent}
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!validation.isValid || submitting}
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
  // ORCH-0847 Phase B — labeled field header with required asterisk.
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  required: {
    fontSize: 13,
    fontWeight: "600",
    color: semantic.error,
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
