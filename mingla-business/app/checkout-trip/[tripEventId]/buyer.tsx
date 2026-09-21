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
 * Keyboard handling + form structure are 1:1 with event-side buyer.tsx:
 * focused-field scroll delegated to SmartScrollView (DERIVED bottom offset);
 * ORCH-1252 removed the manual double-adjust listener/padding/scroll.
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

// ORCH-1252 — keyboard-driven focused-field scroll is delegated entirely to
// SmartScrollView (native = react-native-keyboard-controller's
// KeyboardAwareScrollView at the wrapper's DERIVED DEFAULT_BOTTOM_OFFSET;
// web = plain RN ScrollView). The
// prior manual keyboard listener + dynamic padding + programmatic scroll
// DOUBLE-adjusted on top of the library's auto-scroll, overshooting the field
// off the top of the screen. useKeyboardIsVisible supplies the minimal
// keyboard-visible boolean retained ONLY to hide the sticky bottom bar
// (returns false on web — no-op there, matching prior web behavior).
//
// #1834 [keyboard-blocks-bank-field] — that offset was documented here as a
// flat `bottomOffset=54` until it was measured on glass. It is now DERIVED in
// src/wrappers/SmartScrollView.native.tsx from three named terms:
//   DONE_BAR_OCCUPIED (KEYBOARD_TOOLBAR_HEIGHT - the library's OPENED_OFFSET —
//   53 on iOS 26+, 42 elsewhere) + INPUT_CHROME_BELOW_TEXT_FRAME (iOS 13.5 /
//   Android 3.16, measured) + MIN_VISIBLE_CLEARANCE (12)
//   => 78.5 iOS 26+ / 67.5 iOS <26 / 57.16 Android.
// 54 budgeted 1pt of visible clearance on iOS 26+, not 12, which put the
// focused field BEHIND the Done bar. Read the wrapper; never re-type a total.
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../../src/wrappers/useKeyboardIsVisible";

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
import { phoneStartCountryForCurrency } from "../../../src/utils/phoneStartCountryForCurrency";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
import { isValidE164, composeE164 } from "../../../src/utils/phone";
// issue #2337 — the trip rail's FREE branch used to render `error.message`
// straight to the guest, so a handled 409 arrived as the literal transport
// string "Edge Function returned a non-2xx status code" (the #2136 defect, still
// live on this route) and a resubmit of a completed free reservation — which
// this rail cannot prove possession for, because it forwards no buyer status
// token — arrived as exactly that. Same mapper as the event rail; no second
// decision path.
import {
  createTicketCheckout,
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  freeCheckoutErrorMessage,
  isFreeReservationAlreadyExists,
} from "../../../src/services/ticketCheckoutService";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { tripFunnelTotalSteps } from "./tripFunnelSteps";
// issue #3351 [free trip intake loop] — the SINGLE owner of what comes next.
// This screen holds no predicate of its own over the intake schema query: it
// asks `tripIntakeState` for the facts and `nextTripCheckoutStep` for the
// decision. The old local `hasAnyIntakeSchema` tested intake PRESENCE, which is
// unchanged by answering the form, so a free trip with any question bounced
// between this screen and /intake forever and made zero reservation requests.
import {
  nextTripCheckoutStep,
  tripIntakeFormDataArray,
  tripIntakeState,
  type TripIntakeState,
} from "./tripCheckoutStepOrder";

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
  brandCountry: string | null,
): string => {
  if (existingFullE164.length > 0) {
    const found = [...COUNTRIES]
      .sort((a, b) => b.dialCode.length - a.dialCode.length)
      .find((c) => existingFullE164.startsWith(c.dialCode));
    if (found) return found.code;
  }
  // issue #3380 — the event's own country beats the visitor's locale: a naira
  // event opens on +234 even on a phone set to US English.
  if (brandCountry !== null && COUNTRIES.some((c) => c.code === brandCountry)) {
    return brandCountry;
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

/**
 * issue #3351 [free trip intake loop] — the honest sentence for a schema read
 * that FAILED (after React Query's two retries, so this includes a terminal
 * permission denial). A failed read cannot tell us whether the organiser asks
 * any questions, so the rail fails CLOSED: before this, an unresolved query
 * made the old presence predicate `false`, and a free trip with a required form
 * would have submitted with NO answers and taken the server's 400.
 *
 * This lives here, not in `checkoutErrorCopy.ts`: it describes a client-side
 * read failure, not one of the server's bounded refusal tokens.
 */
const INTAKE_SCHEMA_UNAVAILABLE_MESSAGE =
  "We could not load this trip's questions, so we cannot hold your spot yet. Go back and reopen this trip to try again — nothing was reserved.";

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
  // issue #3351 — `intakeFormData` is read here for the first time. Without it
  // this screen could not tell "the organiser asks questions" from "the
  // traveller has answered them", which is the whole defect.
  const {
    lines,
    buyer,
    intakeFormData,
    setBuyer,
    recordResult,
    paymentPlanChoice,
  } = useCart();
  const totals = useCartTotals();

  // ORCH-1130 Fix #1 — "Total due today" (deposit) line for the order-summary
  // box. When pay-over-time is selected AND the cart holds a plan-active tier,
  // surface the DEPOSIT DUE TODAY alongside the full Total. Read from the SAME
  // projectInstallmentSchedule(...).depositCents the public page + Review step
  // use (mirror of index.tsx's dueTodayCents memo) — NEVER recomputed here.
  // null → no due-today line (pay-in-full / no-plan), Total only (unchanged).
  const dueTodayCents = useMemo<number | null>(() => {
    if (paymentPlanChoice !== "installments" || trip === null) return null;
    for (const line of lines) {
      const sourceTier = trip.pricingTiers.find(
        (t) => t.ticketTypeId === line.ticketTypeId,
      );
      if (
        sourceTier !== undefined &&
        sourceTier.installmentSchedule !== null &&
        line.quantity >= 1
      ) {
        const projected = projectInstallmentSchedule(
          sourceTier,
          new Date(),
          line.quantity,
        );
        if (projected !== null) return projected.depositCents;
      }
    }
    return null;
  }, [paymentPlanChoice, trip, lines]);

  // ORCH-0880 [Tr5 Traveler Intake Forms] — fetch per-tier intake schemas to
  // decide whether to route Continue → /intake (before /payment) when any
  // cart tier has a schema with ≥1 question. Buyer-anon route per
  // `feedback_anon_buyer_routes.md` — query uses the anon-tolerant
  // `trip_intake_schemas_anon_select` RLS policy from Phase 1 migration §3.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(tripEventId ?? "", {
    enabled: tripEventId !== null,
  });
  // issue #3351 — the ONE predicate over the schema query on this screen. It
  // reports whether the read has settled, whether any cart tier carries
  // questions, and whether every such tier has a cart-committed answer set at
  // that tier's CURRENT schema_version_id.
  const intakeState = useMemo<TripIntakeState>(
    () =>
      tripIntakeState({
        lines,
        schemas: intakeSchemasQuery.data,
        committed: intakeFormData,
      }),
    [intakeSchemasQuery.data, lines, intakeFormData],
  );

  // issue #3351 — ONE decision, read by the primary control's label, by its
  // disabled state, and by `handleContinue`, so the three can never disagree.
  const detailsDecision = useMemo(
    () =>
      nextTripCheckoutStep("details", {
        isFree: totals.isFree,
        ...intakeState,
      }),
    [totals.isFree, intakeState],
  );

  // ORCH-1178 — the cart step ALWAYS shows now, so the funnel is index → buyer
  // → [intake] → [payment]. (Supersedes the ORCH-1176 bookableTierCount-derived
  // 2|3, which collapsed the single-tier trip to 2 — that collapse is gone.)
  // issue #3351 — the total is now `isFree`-aware: a FREE cart never reaches the
  // payment step, so free+intake is 3 and free+no-intake is 2. Derived from the
  // same `hasIntake` fact the routing turns on, so the counter and the routing
  // can never disagree, and the denominator never moves mid-flow because it does
  // not read `intakeComplete`.
  const totalSteps = tripFunnelTotalSteps({
    isFree: totals.isFree,
    hasIntake: intakeState.hasIntake,
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [phoneTouched, setPhoneTouched] = useState<boolean>(false);

  const [phoneCountry, setPhoneCountry] = useState<string>(() =>
    resolveInitialCountry(buyer.phone, phoneStartCountryForCurrency(totals.currency)),
  );
  const [phoneLocal, setPhoneLocal] = useState<string>(() =>
    splitExistingPhone(buyer.phone, resolveInitialCountry(buyer.phone, phoneStartCountryForCurrency(totals.currency))),
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

  // ----- Keyboard visibility (ORCH-1252) -----
  // SmartScrollView (KeyboardAwareScrollView, inheriting the wrapper's DERIVED
  // DEFAULT_BOTTOM_OFFSET) is now the SOLE
  // owner of focused-field scrolling — the prior manual listener + dynamic
  // padding + programmatic scroll double-adjusted and overshot the field off the
  // top. All that remains is a single visibility boolean, used ONLY to hide the
  // sticky bottom bar while the keyboard is open. Returns false on web (no-op).
  const keyboardVisible = useKeyboardIsVisible();

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

  /**
   * issue #3351 — THE ONE PLACE A FREE TRIP RESERVATION IS CREATED. There is
   * exactly one `createTicketCheckout` call in this file, and nothing about the
   * request is assembled anywhere else, so #3353 relocates ONE call into its
   * shared seam rather than redesigning this rail.
   *
   * It is invoked ONLY from `handleContinue`'s `submit_free` arm — i.e. only
   * from a deliberate buyer tap. Seth's OQ-2 decision: nothing on this route
   * may submit a reservation without a tap, so there is no effect, no timer and
   * no token that can fire this.
   *
   * The single-shot ref is cleared ONLY in the catch. A refusal re-enables the
   * control so a deliberate second tap retries; a success never re-arms it, so
   * a remount cannot resubmit. An automatic retry of a free reservation whose
   * reply was lost is exactly how #2462/#2511 gave guests two orders.
   */
  const freeReservationFiredRef = useRef<boolean>(false);
  const runFreeReservation = useCallback(async (): Promise<void> => {
    if (tripEventId === null) return;
    if (freeReservationFiredRef.current) return;
    freeReservationFiredRef.current = true;
    // issue #3351 — the answers the traveller committed on /intake, flattened
    // by the shared helper into the array shape `ticket-checkout-create`
    // matches by `ticket_type_id`. The conditional spread is load-bearing:
    // `ticketCheckoutService` omits `intake_form_data` from the wire body when
    // the array is empty, so a free trip with NO schema sends byte-identically
    // to before this change.
    const intakeArray = tripIntakeFormDataArray(intakeFormData, lines);
    try {
      setSubmitting(true);
      // ORCH-0876: createTicketCheckout is event_type-agnostic — passes
      // the events-row id (here the trip's id). Tr3 RPC branches on
      // v_event.event_type='trip' server-side.
      const result = await createTicketCheckout({
        eventId: tripEventId,
        buyer,
        lines,
        ...(intakeArray.length > 0 ? { intakeFormData: intakeArray } : {}),
      });
      if (result.kind !== "free_completed") {
        throw new Error("Free reservation unexpectedly required payment.");
      }
      recordResult({
        orderId: result.orderId,
        ticketIds: result.tickets.map((ticket) => ticket.ticketId),
        checkoutSessionId: result.checkoutSessionId,
        // issue #2323 — see checkout/[eventId]/buyer.tsx. Free reservations
        // reach /confirm with no query string, so the possession proof must
        // ride the order result or the attendance claim can never be minted.
        ...(typeof result.buyerStatusToken === "string" &&
          result.buyerStatusToken.length > 0
          ? { buyerStatusToken: result.buyerStatusToken }
          : {}),
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
      freeReservationFiredRef.current = false;
      // issue #2337 — the guest already holds this reservation; saying
      // anything else pushes them to reserve a second time.
      if (isFreeReservationAlreadyExists(error)) {
        setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE);
        return;
      }
      // issue #3351 — every refusal this rail shows is a mapped sentence. The
      // token `intake_form_required` now maps to one that says the organiser
      // needs answers and that NOTHING was reserved, instead of falling through
      // to "your ticket may already be reserved".
      setSubmitError(freeCheckoutErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [tripEventId, intakeFormData, lines, buyer, recordResult, router]);

  const handleContinue = useCallback(async (): Promise<void> => {
    setNameTouched(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    if (!validation.isValid) return;
    if (tripEventId === null) return;
    setSubmitError(null);
    // issue #3351 — ONE switch on the owner's decision. No other navigation and
    // no other create call may live in this handler.
    switch (detailsDecision) {
      case "wait":
        // The schema read has not settled (or failed): the control is already
        // disabled, and no request may be issued with unknown questions.
        return;
      case "go_intake":
        router.push(`/checkout-trip/${tripEventId}/intake` as never);
        return;
      case "submit_free":
        await runFreeReservation();
        return;
      case "go_payment":
        router.push(`/checkout-trip/${tripEventId}/payment` as never);
        return;
      case "go_details_finalize":
        // Only the intake screen's exit produces this; unreachable from here.
        return;
      default: {
        const unreachable: never = detailsDecision;
        void unreachable;
        return;
      }
    }
  }, [
    validation.isValid,
    tripEventId,
    detailsDecision,
    router,
    runFreeReservation,
  ]);

  // issue #3351 — the label states what the tap actually does. A paid trip with
  // questions used to say "Continue to payment" and open a form instead.
  const continueLabel =
    detailsDecision === "go_intake"
      ? "Continue"
      : totals.isFree
        ? "Reserve free spot"
        : "Continue to payment";

  // issue #3351 — the schema read failed, so we cannot know whether the
  // organiser asks anything. Say so and keep the control disabled rather than
  // submit with no answers.
  const bannerMessage =
    submitError ??
    (intakeSchemasQuery.isError ? INTAKE_SCHEMA_UNAVAILABLE_MESSAGE : null);

  if (trip === null || hasNoLines) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={1}
          totalSteps={totalSteps}
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
        totalSteps={totalSteps}
        title="Your details"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
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
            {/* ORCH-1130 Fix #1 — pay-over-time only: full Total stays above;
                the amount charged TODAY (deposit) shows as its own labeled
                line. Hidden for pay-in-full / no-plan. */}
            {dueTodayCents !== null ? (
              <View style={styles.summaryDueTodayRow}>
                <Text style={styles.summaryDueTodayLabel}>Total due today</Text>
                <Text style={styles.summaryDueTodayValue}>
                  {formatCurrency(dueTodayCents, totals.currency, true)}
                </Text>
              </View>
            ) : null}
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
            onBlur={() => setEmailTouched(true)}
          />
          {visibleErrors.email !== null ? (
            <Text style={styles.errorText}>{visibleErrors.email}</Text>
          ) : null}
        </View>

        {/* Phone */}
        <View style={styles.fieldWrap}>
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
        {bannerMessage !== null ? (
          <Text style={styles.errorText}>{bannerMessage}</Text>
        ) : null}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
          keyboardVisible ? styles.bottomBarHidden : null,
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {totals.isFree ? "Free" : formatCurrency(totals.total, totals.currency)}
          </Text>
        </View>
        {/* ORCH-1130 Fix #1 — due-today (deposit) line in the sticky bar under
            pay-over-time; mirrors the order-summary box above. */}
        {dueTodayCents !== null ? (
          <View style={styles.dueTodayRow}>
            <Text style={styles.dueTodayLabel}>Total due today</Text>
            <Text style={styles.dueTodayValue}>
              {formatCurrency(dueTodayCents, totals.currency, true)}
            </Text>
          </View>
        ) : null}
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          // issue #3351 — `!intakeState.settled` fails the rail CLOSED while the
          // intake schema read is unresolved or failed. Before this, an
          // unresolved read read as "no questions", so a free trip with a
          // required form submitted with no answers and took the server's 400.
          disabled={!validation.isValid || submitting || !intakeState.settled}
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
  // ORCH-0882 — wrap for plan disclosure above order summary
  planDisclosureWrap: { width: "100%", marginBottom: spacing.lg },
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
  // ORCH-1130 Fix #1 — due-today (deposit) rows on the order-summary box +
  // sticky bar. Subordinate weight to the full Total so the full price stays
  // the dominant headline number.
  summaryDueTodayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 6,
  },
  summaryDueTodayLabel: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "600",
  },
  summaryDueTodayValue: {
    fontSize: 15,
    color: accent.warm,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  dueTodayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  dueTodayLabel: { fontSize: 13, color: accent.warm, fontWeight: "600" },
  dueTodayValue: {
    fontSize: 16,
    color: accent.warm,
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
