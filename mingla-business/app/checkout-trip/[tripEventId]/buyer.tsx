/**
 * Trip Buyer Details screen. ORCH-0876 [Trip CRUD + Purchase Flow
 * Completion] — mirror of `app/checkout/[eventId]/buyer.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}/buyer
 *
 * Buyer types name + email + required phone + marketing opt-in. Validation
 * runs inline on each field. Continue button disabled until name + email
 * pass validation.
 *
 * On Continue:
 *   - Free order (totals.total === 0) → create server order/tickets and route
 *     to /confirm after durable sales rows exist.
 *   - Paid order → router.push to /checkout-trip/{tripEventId}/payment.
 *
 * Keyboard pattern + form structure are 1:1 with event-side buyer.tsx.
 * Trip-specific swaps: usePublicEventById → usePublicTripById; route
 * literals → /checkout-trip/; event → trip variable name; copy "ticket" →
 * "spot" where buyer-facing.
 *
 * The underlying `biz_ticket_checkout_create_session` RPC accepts the
 * trip's event-row-id as eventId — Tr3 [ORCH-0869] branches on
 * v_event.event_type='trip' server-side. Service `createTicketCheckout`
 * is event_type-agnostic.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.3.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirror of /checkout/[eventId]/buyer.tsx; insets.bottom IS applied (bottom dock) for home-indicator clearance; the top status-bar overlap with back arrow / "Your details" header / "2 OF 3" pill is the intended banner-style buyer aesthetic.

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
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { useTripIntakeSchemasByEvent } from "../../../src/hooks/useIntakeSchema";
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

const resolveInitialCountry = (
  existingFullE164: string,
  _brandCountry: string | null,
): string => {
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
  const nameTrim = name.trim();
  const emailTrim = email.trim();
  const phoneTrim = phone.trim();

  const nameValid = nameTrim.length >= NAME_MIN_CHARS;
  const emailValid = EMAIL_REGEX.test(emailTrim);
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

export default function CheckoutTripBuyerScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripEventId: string }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const { lines, buyer, setBuyer, recordResult } = useCart();
  const totals = useCartTotals();

  // ORCH-0880 [Tr5 Traveler Intake Forms] — fetch per-tier intake schemas to
  // decide whether to route Continue → /intake (before /payment) when any
  // cart tier has a schema with ≥1 question. Buyer-anon route per
  // `feedback_anon_buyer_routes.md` — query uses the anon-tolerant
  // `trip_intake_schemas_anon_select` RLS policy from Phase 1 migration §3.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(tripEventId ?? "", {
    enabled: tripEventId !== null,
  });
  const hasAnyIntakeSchema = useMemo<boolean>(() => {
    if (intakeSchemasQuery.data === undefined) return false;
    for (const line of lines) {
      const schema = intakeSchemasQuery.data.get(line.ticketTypeId);
      if (schema !== undefined && schema.questions.length > 0) return true;
    }
    return false;
  }, [intakeSchemasQuery.data, lines]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [phoneTouched, setPhoneTouched] = useState<boolean>(false);

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
  const showErrorsForName = nameTouched;
  const showErrorsForEmail = emailTouched;
  const showErrorsForPhone = phoneTouched;
  const validation = useMemo<ValidationState>(
    () =>
      validate(buyer.name, buyer.email, buyer.phone, false),
    [buyer.name, buyer.email, buyer.phone],
  );
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

  // ----- Defensive guard: cart empty / trip missing -----
  const hasNoLines = lines.length === 0;
  useEffect(() => {
    if (hasNoLines && tripEventId !== null) {
      router.replace(`/checkout-trip/${tripEventId}` as never);
    }
  }, [hasNoLines, tripEventId, router]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (tripEventId !== null) {
      router.replace(`/checkout-trip/${tripEventId}` as never);
    }
  }, [router, tripEventId]);

  const handleContinue = useCallback(async (): Promise<void> => {
    setNameTouched(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    if (!validation.isValid) return;
    if (tripEventId === null) return;
    setSubmitError(null);
    if (totals.isFree) {
      // ORCH-0880 [Tr5 Traveler Intake Forms] — when free trip has intake
      // schemas, the buyer must complete /intake BEFORE the free reservation
      // is created (so intake_form_data is included in the createTicketCheckout
      // call to satisfy I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT).
      if (hasAnyIntakeSchema) {
        router.push(`/checkout-trip/${tripEventId}/intake` as never);
        return;
      }
      try {
        setSubmitting(true);
        // ORCH-0876: createTicketCheckout is event_type-agnostic — passes
        // the events-row id (here the trip's id). Tr3 RPC branches on
        // v_event.event_type='trip' server-side.
        const result = await createTicketCheckout({
          eventId: tripEventId,
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
        router.replace(`/checkout-trip/${tripEventId}/confirm` as never);
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
    // ORCH-0880 [Tr5 Traveler Intake Forms] — paid trips with intake
    // schemas route to /intake BEFORE /payment so buyer answers required
    // questions before the Stripe Checkout Session is created (per
    // I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT gate in
    // ticket-checkout-create).
    if (hasAnyIntakeSchema) {
      router.push(`/checkout-trip/${tripEventId}/intake` as never);
      return;
    }
    router.push(`/checkout-trip/${tripEventId}/payment` as never);
  }, [
    validation.isValid,
    tripEventId,
    totals.isFree,
    hasAnyIntakeSchema,
    lines,
    buyer,
    recordResult,
    router,
  ]);

  const continueLabel = totals.isFree
    ? "Reserve free spot"
    : "Continue to payment";

  if (trip === null || hasNoLines) {
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
          accessibilityLabel="Edit tier selection"
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

        {/* Phone */}
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
          accessibilityLabel="Email me about this organiser's future trips and events"
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
            Email me about this organiser&apos;s future trips and events
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
