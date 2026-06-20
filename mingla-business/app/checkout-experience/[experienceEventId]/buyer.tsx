/**
 * Experience Buyer Details screen. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/buyer.tsx`, with the trip-only installment
 * plan + intake-schema steps removed (experiences have neither in v1).
 *
 * Route: /checkout-experience/{experienceEventId}/buyer
 *
 * Buyer types name + email + required phone + marketing opt-in. On Continue:
 *   - Free order  → create the server order via the shared ticket-checkout-create
 *     and route to /confirm.
 *   - Paid order  → router.push to /payment.
 *
 * `createTicketCheckout` is event_type-agnostic; the experience's events-row id
 * is the eventId (COMMS-0014/0016 — no parallel money fn).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirror of /checkout-trip/[tripEventId]/buyer.tsx; insets.bottom IS applied (bottom dock); the top status-bar overlap with the banner header is the intended buyer aesthetic.

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
import { usePublicExperienceById } from "../../../src/hooks/usePublicExperience";
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

import {
  PhoneInput,
  COUNTRIES,
  getCountryByCode,
  type PhoneInputTheme,
  type PhoneInputIconName,
} from "@mingla/phone-input";

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

const resolveInitialCountry = (existingFullE164: string): string => {
  if (existingFullE164.length > 0) {
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
  const nameValid = name.trim().length >= NAME_MIN_CHARS;
  const emailValid = EMAIL_REGEX.test(email.trim());
  const phoneValid = isValidE164(phone.trim());
  return {
    nameError: showErrors && !nameValid ? "Please enter your full name" : null,
    emailError: showErrors && !emailValid ? "Enter a valid email" : null,
    phoneError: showErrors && !phoneValid ? "Enter a valid mobile number" : null,
    isValid: nameValid && emailValid && phoneValid,
  };
};

export default function CheckoutExperienceBuyerScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ experienceEventId: string }>();
  const experienceEventId =
    typeof params.experienceEventId === "string"
      ? params.experienceEventId
      : null;

  const query = usePublicExperienceById(experienceEventId);
  const experience = query.data?.experience ?? null;
  const { lines, buyer, setBuyer, recordResult } = useCart();
  const totals = useCartTotals();

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [phoneTouched, setPhoneTouched] = useState<boolean>(false);

  const [phoneCountry, setPhoneCountry] = useState<string>(() =>
    resolveInitialCountry(buyer.phone),
  );
  const [phoneLocal, setPhoneLocal] = useState<string>(() =>
    splitExistingPhone(buyer.phone, resolveInitialCountry(buyer.phone)),
  );

  const handlePhoneLocalChange = useCallback(
    (next: string): void => {
      setPhoneLocal(next);
      const dialCode = getCountryByCode(phoneCountry)?.dialCode ?? "+44";
      setBuyer({ phone: composeE164(dialCode, next) ?? "" });
    },
    [phoneCountry, setBuyer],
  );

  const handlePhoneCountryChange = useCallback(
    (nextIso: string): void => {
      setPhoneCountry(nextIso);
      const dialCode = getCountryByCode(nextIso)?.dialCode ?? "+44";
      setBuyer({ phone: composeE164(dialCode, phoneLocal) ?? "" });
    },
    [phoneLocal, setBuyer],
  );

  // ----- Keyboard pattern -----
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

  // ----- Validation -----
  const validation = useMemo<ValidationState>(
    () => validate(buyer.name, buyer.email, buyer.phone, false),
    [buyer.name, buyer.email, buyer.phone],
  );
  const visibleErrors = useMemo<{
    name: string | null;
    email: string | null;
    phone: string | null;
  }>(() => {
    const v = validate(buyer.name, buyer.email, buyer.phone, true);
    return {
      name: nameTouched ? v.nameError : null,
      email: emailTouched ? v.emailError : null,
      phone: phoneTouched ? v.phoneError : null,
    };
  }, [
    buyer.name,
    buyer.email,
    buyer.phone,
    nameTouched,
    emailTouched,
    phoneTouched,
  ]);

  // ----- Defensive guard: cart empty -----
  const hasNoLines = lines.length === 0;
  useEffect(() => {
    if (hasNoLines && experienceEventId !== null) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
    }
  }, [hasNoLines, experienceEventId, router]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (experienceEventId !== null) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
    }
  }, [router, experienceEventId]);

  const handleContinue = useCallback(async (): Promise<void> => {
    setNameTouched(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    if (!validation.isValid) return;
    if (experienceEventId === null) return;
    setSubmitError(null);
    if (totals.isFree) {
      try {
        setSubmitting(true);
        const result = await createTicketCheckout({
          eventId: experienceEventId,
          buyer,
          lines,
        });
        if (result.kind !== "free_completed") {
          throw new Error("Free reservation unexpectedly required payment.");
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
        router.replace(
          `/checkout-experience/${experienceEventId}/confirm` as never,
        );
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Could not reserve your spot. Please try again.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    router.push(`/checkout-experience/${experienceEventId}/payment` as never);
  }, [
    validation.isValid,
    experienceEventId,
    totals.isFree,
    lines,
    buyer,
    recordResult,
    router,
  ]);

  const continueLabel = totals.isFree
    ? "Reserve free spot"
    : "Continue to payment";

  if (experience === null || hasNoLines) {
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
          accessibilityLabel="Edit your spot"
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
                {totals.isFree
                  ? "Free"
                  : formatCurrency(totals.total, totals.currency)}
              </Text>
            </View>
          </GlassCard>
        </Pressable>

        <Text style={styles.sectionLabel}>Buyer details</Text>

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

        <View style={styles.fieldWrap} onTouchStart={requestScrollToInput}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <Text style={styles.required}>*</Text>
          </View>
          <PhoneInput
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={(next: string) => {
              handlePhoneLocalChange(next);
              setPhoneTouched(true);
            }}
            onChangeCountry={(nextIso: string) => {
              handlePhoneCountryChange(nextIso);
              setPhoneTouched(true);
            }}
            error={visibleErrors.phone}
            disabled={false}
            iconRenderer={(name: PhoneInputIconName, iconProps: { size: number; color: string }) => {
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
              countryButtonAccessibilityLabel: (name: string) =>
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

        <Pressable
          onPress={() => setBuyer({ marketingOptIn: !buyer.marketingOptIn })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: buyer.marketingOptIn }}
          accessibilityLabel="Email me about this organiser's future experiences and events"
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
            Email me about this organiser&apos;s future experiences and events
          </Text>
        </Pressable>
        {submitError !== null ? (
          <Text style={styles.errorText}>{submitError}</Text>
        ) : null}
      </ScrollView>

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
            {totals.isFree
              ? "Free"
              : formatCurrency(totals.total, totals.currency)}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
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
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  summaryWrap: { marginBottom: spacing.lg },
  summaryPressed: { opacity: 0.7 },
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
  summaryEditText: { fontSize: 12, fontWeight: "600", color: accent.warm },
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
  summaryLineTotal: { fontSize: 14, color: textTokens.primary, fontWeight: "600" },
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
    gap: 4,
  },
  fieldLabel: { fontSize: 13, fontWeight: "500", color: textTokens.secondary },
  required: { fontSize: 13, fontWeight: "600", color: semantic.error },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: semantic.error,
    fontWeight: "500",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  checkboxRowPressed: { opacity: 0.7 },
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
  checkboxBoxChecked: { backgroundColor: accent.warm, borderColor: accent.warm },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
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
  bottomBarHidden: { transform: [{ translateY: 200 }] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  totalLabel: { fontSize: 13, color: textTokens.tertiary, fontWeight: "500" },
  totalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
