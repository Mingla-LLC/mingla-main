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
  Linking,
  Platform,
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

import { radius as radiusTokens, space, edge } from "../../../src/constants/designSystem";
import { checkoutStyles, color, materials } from "../../../src/components/checkout/checkoutTheme";
import { usePublicExperienceById } from "../../../src/hooks/usePublicExperience";
import { formatCurrency } from "../../../src/utils/currency";
import { phoneStartCountryForCurrency } from "../../../src/utils/phoneStartCountryForCurrency";
import { isValidE164, composeE164 } from "../../../src/utils/phone";
// issue #2337 — the THIRD free rail. Like `checkout-trip`, this catch rendered
// `error.message` straight to the guest, so every handled 409 arrived as the
// literal transport string "Edge Function returned a non-2xx status code". Same
// mapper as the other two rails; no second decision path.
import {
  createTicketCheckout,
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  freeCheckoutErrorMessage,
  isFreeReservationAlreadyExists,
} from "../../../src/services/ticketCheckoutService";
import { recordConsent } from "../../../src/services/consentService";
import {
  CHECKOUT_MARKETING_NOTICE,
  PURCHASE_PRIVACY_URL,
  PURCHASE_TERMS_DISCLOSURE_TEXT,
  PURCHASE_TERMS_DISCLOSURE_VERSION,
  PURCHASE_TERMS_LABEL_JOINER,
  PURCHASE_TERMS_LABEL_PREFIX,
  PURCHASE_TERMS_LABEL_PRIVACY,
  PURCHASE_TERMS_LABEL_SUFFIX,
  PURCHASE_TERMS_LABEL_TERMS,
  PURCHASE_TERMS_URL,
} from "../../../src/constants/purchaseTermsDisclosure";
import { BUYER_CLAIM_COPY } from "../../../src/constants/buyerClaimCopy";
import { supabase } from "../../../src/services/supabase";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";
import { FieldErrorLine } from "../../../src/components/checkout/FieldErrorLine";
import { useSteadyQuote } from "../../../src/components/checkout/useSteadyQuote";
import { useRevealedFieldErrors } from "../../../src/hooks/useRevealedFieldErrors";

import {
  type CheckoutBrandFormAnswers,
  useCart,
  useCartQuoteTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutOfferingStrip } from "../../../src/components/checkout/CheckoutOfferingStrip";
import { useCheckoutWideLayout } from "../../../src/components/checkout/CheckoutOrderSummary";
import { formatExperienceDateSubline } from "../../../src/utils/experienceDateSubline";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import {
  isContinueDisabled,
  shouldShowConsentHintOnDisabledTap,
} from "../../../src/components/checkout/checkoutConsentGate";

import {
  PhoneInput,
  COUNTRIES,
  getCountryByCode,
  type PhoneInputTheme,
  type PhoneInputIconName,
} from "@mingla/phone-input";

const TicketQuoteSummary = React.lazy(() =>
  import("../../../src/components/checkout/TicketQuoteSummary").then(
    (module) => ({ default: module.TicketQuoteSummary }),
  ),
);

// #4514 wave 5 — the Questions step loads through the ONE forms lazy owner.
// Your spot › Details › Questions › Payment.
const CheckoutQuestionsStep = React.lazy(() =>
  import("../../../src/components/checkout/intake/formRenderingPrimitives").then(
    (module) => ({ default: module.CheckoutQuestionsStep }),
  ),
);
// #4514 wave 5 — the refusals that reopen the Questions step. Only these: a
// server failure of the check or the stash (brand_form_check_failed /
// brand_form_stash_failed) is the normal retryable error and never opens a step
// the buyer cannot finish. Inline in each route on purpose: a shared module
// would land in the eager bundle (the #4514 bundle budget).
const FORM_REFUSAL = /^(form_answers_required|form_answers_invalid|form_changed)$/;
const formRefusalOf = (code: unknown): string | null =>
  typeof code === "string" && FORM_REFUSAL.test(code) ? code : null;
/** The `questions` param payment sets: the real refusal code ("1" from an older link). */
const questionsParamRefusal = (param: unknown): string | null =>
  param === "1" ? "form_answers_required" : formRefusalOf(param);
const BRAND_FORM_SERVER_FAILURE = /^brand_form_(check|stash)_failed$/;
const FORM_STEP_NAMES = ["Your spot", "Details", "Questions", "Payment"] as const;

// #4420 — read per render: the tokens follow the host palette.
const publicBuyerPhoneTheme = (): PhoneInputTheme => ({
  backgroundPrimary: color.canvas,
  fieldBackground: color.fill.input,
  textPrimary: color.text1,
  textTertiary: color.text3,
  borderDefault: color.lineStrong,
  borderFocused: edge.ringInputFocus.borderColor,
  borderError: edge.ringError.borderColor,
  searchBackground: color.fill.tile,
  rowPressedBackground: color.fill.inset,
  divider: color.line,
  accessoryBackground: materials.chrome.glassFill,
  accessoryBorder: color.line,
  accent: color.text1,
  errorText: color.errorText,
});

const resolveInitialCountry = (
  existingFullE164: string,
  brandCountry: string | null = null,
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
    phoneError:
      showErrors && !phoneValid ? "Enter a valid mobile number" : null,
    isValid: nameValid && emailValid && phoneValid,
  };
};

export default function CheckoutExperienceBuyerScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    experienceEventId: string;
    /** #4514 wave 5 — set by payment when the server asked for the questions. */
    questions?: string;
  }>();
  const experienceEventId =
    typeof params.experienceEventId === "string"
      ? params.experienceEventId
      : null;

  const query = usePublicExperienceById(experienceEventId);
  const experience = query.data?.experience ?? null;
  const stripWide = useCheckoutWideLayout();
  const {
    lines,
    buyer,
    discountCode,
    quote,
    quoteStatus,
    setBuyer,
    recordResult,
    checkoutAttemptIdFor,
    eventDateId,
    bookedStartAt,
    bookedEndAt,
    partySize,
  } = useCart();
  const totals = useCartQuoteTotals();
  const summaryQuote = useSteadyQuote(quote, quoteStatus);

  const [submitting, setSubmitting] = useState<boolean>(false);
  // issue #2689 — synchronous re-entry guard (ref, not batched state). Consent
  // is awaited before createTicketCheckout; without this claim two taps both
  // enter the free rail. Mirrors checkout/[eventId]/buyer.tsx.
  const submitInFlight = useRef<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // #4514 wave 5 — what the page's brand form asks of this checkout.
  const [formProbe, setFormProbe] = useState<string>("loading");
  const [formRefusal, setFormRefusal] = useState<string | null>(
    questionsParamRefusal(params.questions),
  );
  const [questionsOpen, setQuestionsOpen] = useState<boolean>(
    questionsParamRefusal(params.questions) !== null,
  );
  const hasFormStep =
    formProbe === "required" || formProbe === "optional" || formRefusal !== null;
  const termsAccepted = buyer.termsAccepted === true;
  const [consentHintVisible, setConsentHintVisible] = useState<boolean>(false);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const acceptedGrantRef = useRef<{ userId: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => supabase.auth?.getSession?.())
      .then((result) => {
        if (cancelled) return;
        const id = result?.data?.session?.user?.id;
        const readyId = typeof id === "string" && id.length > 0 ? id : null;
        setSessionUserId(readyId);
        setAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSessionUserId(null);
          setAuthReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleTerms = useCallback((): void => {
    if (!authReady) return;
    const next = !(buyer.termsAccepted === true);
    if (next) {
      acceptedGrantRef.current = { userId: sessionUserId };
    } else {
      acceptedGrantRef.current = null;
    }
    setBuyer({ termsAccepted: next });
    if (next) setConsentHintVisible(false);
  }, [authReady, buyer.termsAccepted, sessionUserId, setBuyer]);


  // prettier-ignore -- #3380 source contract keeps the locale fallback auditable.
  const [phoneCountry, setPhoneCountry] = useState<string>(() =>
    resolveInitialCountry(buyer.phone, phoneStartCountryForCurrency(totals.currency)),
  );
  // prettier-ignore -- #3380 source contract keeps the same fallback in both seeds.
  const [phoneLocal, setPhoneLocal] = useState<string>(() =>
    splitExistingPhone(buyer.phone, resolveInitialCountry(buyer.phone, phoneStartCountryForCurrency(totals.currency))),
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

  // ----- Keyboard visibility (ORCH-1252) -----
  // SmartScrollView (KeyboardAwareScrollView, inheriting the wrapper's DERIVED
  // DEFAULT_BOTTOM_OFFSET) is now the SOLE
  // owner of focused-field scrolling — the prior manual listener + dynamic
  // padding + programmatic scroll double-adjusted and overshot the field off the
  // top. All that remains is a single visibility boolean, used ONLY to hide the
  // sticky bottom bar while the keyboard is open. Returns false on web (no-op).
  const keyboardVisible = useKeyboardIsVisible();

  // ----- Validation -----
  const validation = useMemo<ValidationState>(
    () => validate(buyer.name, buyer.email, buyer.phone, false),
    [buyer.name, buyer.email, buyer.phone],
  );
  // #4420 — Constitution 12: an error appears on blur or Continue, never
  // mid-typing, and clears live once the value is valid.
  const fieldErrors = useMemo(
    () => validate(buyer.name, buyer.email, buyer.phone, true),
    [buyer.name, buyer.email, buyer.phone],
  );
  const {
    shows: showsFieldError,
    blur: blurField,
    revealAll: revealAllFieldErrors,
  } = useRevealedFieldErrors({
    name: fieldErrors.nameError !== null,
    email: fieldErrors.emailError !== null,
    phone: fieldErrors.phoneError !== null,
  });
  const visibleErrors = {
    name: showsFieldError("name") ? fieldErrors.nameError : null,
    email: showsFieldError("email") ? fieldErrors.emailError : null,
    phone: showsFieldError("phone") ? fieldErrors.phoneError : null,
  };

  // ----- Defensive guard: cart empty -----
  const hasNoLines = lines.length === 0;
  useEffect(() => {
    if (hasNoLines && experienceEventId !== null) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
    }
  }, [hasNoLines, experienceEventId, router]);

  // #4514 P3-C — the Questions step's way out once a Try again has failed.
  const handleBackToEvent = useCallback((): void => {
    if (experience !== null) {
      router.replace(`/exp/${experience.brandSlug}/${experience.slug}` as never);
    } else if (experienceEventId !== null) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
    }
  }, [router, experience, experienceEventId]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (experienceEventId !== null) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
    }
  }, [router, experienceEventId]);

  const showConsentHint = useCallback((): void => {
    revealAllFieldErrors();
    if (
      shouldShowConsentHintOnDisabledTap({
        fieldsValid: validation.isValid,
        termsAccepted,
      })
    ) {
      setConsentHintVisible(true);
    }
  }, [termsAccepted, validation.isValid, revealAllFieldErrors]);

  const handleContinue = useCallback(async (
    // #4514 wave 5 — the Questions step's answers (undefined: no step shown).
    formAnswers?: CheckoutBrandFormAnswers | null,
  ): Promise<void> => {
    revealAllFieldErrors();
    if (!validation.isValid) return;
    if (!termsAccepted) {
      setConsentHintVisible(true);
      return;
    }
    if (experienceEventId === null) return;
    if (quoteStatus !== "ready" || quote === null) return;
    // issue #2689 — claim before the consent network round trip (re-entry window).
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const grant = acceptedGrantRef.current;
      const buyerUserId = grant?.userId ?? null;
      const consentResult = await recordConsent({
        source: "checkout",
        disclosureText: PURCHASE_TERMS_DISCLOSURE_TEXT,
        disclosureVersion: PURCHASE_TERMS_DISCLOSURE_VERSION,
        scopes: ["transactional"],
        phone: buyer.phone,
        email: buyer.email,
        countryCode: phoneCountry,
        userId: buyerUserId,
        eventId: experienceEventId,
      });
      if (!consentResult.ok) {
        console.error(
          "[checkout-experience-buyer] consent_records write failed (proceeding; checkbox act stands)",
        );
      }
      // #4273: no marketing record is written here any more. Buying opts the
      // buyer in; the order ingest records that grant (purchase_auto_optin)
      // unless they have opted out.
    } catch (consentErr) {
      console.error(
        "[checkout-experience-buyer] consent write threw",
        consentErr,
      );
    }
    if (totals.isFree) {
      try {
        const result = await createTicketCheckout({
          eventId: experienceEventId,
          brandId: experience?.brandId,
          buyer:
            formAnswers === undefined ? buyer : { ...buyer, brandForm: formAnswers },
          lines,
          discountCode,
          quoteDigest: quote.quoteDigest,
          quoteListDigest: quote.quoteListDigest,
          ...(eventDateId !== null ? { eventDateId } : {}),
          ...(bookedStartAt !== null ? { bookedStartAt } : {}),
          ...(bookedEndAt !== null ? { bookedEndAt } : {}),
          ...(partySize !== null ? { partySize } : {}),
          ...(Platform.OS === "web"
            ? {
                checkoutContractVersion: 2 as const,
                checkoutAttemptId: checkoutAttemptIdFor({
                  eventId: experienceEventId,
                  surface: "web",
                }),
              }
            : {}),
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
          buyerContact: result.buyerContact,
          receipt: result.receipt,
          claim: result.claim,
          attachedToAccount: result.attachedToAccount,
          boughtForSomeoneElse: result.boughtForSomeoneElse,
          tickets: result.tickets,
        });
        router.replace(
          `/checkout-experience/${experienceEventId}/confirm` as never,
        );
      } catch (error) {
        // issue #2337 — the guest already holds this reservation; saying
        // anything else pushes them to reserve a second time.
        if (isFreeReservationAlreadyExists(error)) {
          setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE);
          return;
        }
        // #4514 wave 5 — reopen the Questions step, answers kept.
        // Only the three form refusals: a server failure of the check or the
        // stash is the normal retryable error below, never a dead-end step.
        const formCode = formRefusalOf((error as { code?: string } | null)?.code);
        if (formCode !== null) {
          setFormRefusal(formCode);
          setQuestionsOpen(true);
          return;
        }
        // #4514 — a server failure of the form check or stash happened before
        // any reservation: the normal retryable error, never the step.
        if (BRAND_FORM_SERVER_FAILURE.test((error as { code?: string } | null)?.code ?? "")) {
          setSubmitError(FREE_CHECKOUT_FAILED_MESSAGE);
          return;
        }
        setSubmitError(freeCheckoutErrorMessage(error));
      } finally {
        submitInFlight.current = false;
        setSubmitting(false);
      }
      return;
    }
    // issue #2689 — release immediately after paid push so back cannot strand
    // a mounted screen on a permanently dead button.
    router.push(`/checkout-experience/${experienceEventId}/payment` as never);
    submitInFlight.current = false;
    setSubmitting(false);
  }, [
    revealAllFieldErrors,
    validation.isValid,
    termsAccepted,
    experienceEventId,
    totals.isFree,
    discountCode,
    quote,
    quoteStatus,
    lines,
    buyer,
    checkoutAttemptIdFor,
    recordResult,
    router,
    phoneCountry,
    eventDateId,
    bookedStartAt,
    bookedEndAt,
    partySize,
    experience?.brandId,
  ]);

  const finalLabel = totals.isFree
    ? "Reserve free spot"
    : "Continue to payment";
  // #4514 wave 5 — with a Questions step, Details only continues to it.
  const continueLabel = hasFormStep ? "Continue" : finalLabel;

  const handleDetailsContinue = useCallback((): void => {
    if (!hasFormStep) {
      void handleContinue();
      return;
    }
    revealAllFieldErrors();
    if (!validation.isValid) return;
    if (!termsAccepted) {
      setConsentHintVisible(true);
      return;
    }
    setQuestionsOpen(true);
  }, [hasFormStep, handleContinue, revealAllFieldErrors, validation.isValid, termsAccepted]);

  const handleQuestionsContinue = useCallback(
    (answers: CheckoutBrandFormAnswers | null): void => {
      setFormRefusal(null);
      setBuyer({ brandForm: answers });
      void handleContinue(answers);
    },
    [setBuyer, handleContinue],
  );

  const continueDisabled =
    !authReady ||
    quoteStatus !== "ready" ||
    isContinueDisabled({
      fieldsValid: validation.isValid,
      termsAccepted,
      submitting,
    });

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

  if (questionsOpen && experienceEventId !== null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={2}
          totalSteps={4}
          stepNames={FORM_STEP_NAMES}
          title="A few questions"
          onBack={() => setQuestionsOpen(false)}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + space[6] },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <React.Suspense fallback={null}>
            <CheckoutQuestionsStep
              eventId={experienceEventId}
              visible
              value={buyer.brandForm ?? null}
              onChange={(next) => setBuyer({ brandForm: next })}
              onProbe={setFormProbe}
              refusal={formRefusal}
              onContinue={handleQuestionsContinue}
              continueLabel={finalLabel}
              submitting={submitting}
              submitError={submitError}
              onBackToEvent={handleBackToEvent}
            />
          </React.Suspense>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={1}
        totalSteps={hasFormStep ? 4 : 3}
        {...(hasFormStep ? { stepNames: FORM_STEP_NAMES } : {})}
        title="Your details"
        onBack={handleBack}
      />
      {experienceEventId !== null ? (
        <React.Suspense fallback={null}>
          <CheckoutQuestionsStep
            eventId={experienceEventId}
            visible={false}
            value={null}
            onChange={() => undefined}
            onProbe={setFormProbe}
            refusal={null}
            onContinue={() => undefined}
            continueLabel={finalLabel}
            submitting={false}
          />
        </React.Suspense>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* #4420 wave 2 (§4.1) — phone: the offering this step belongs to. */}
        {experience !== null ? (
          <CheckoutOfferingStrip
            wide={stripWide}
            title={experience.title.trim().length > 0 ? experience.title : "Untitled experience"}
            eyebrow={
              formatExperienceDateSubline({
                venueText: null,
                dateStartIsos: experience.dates.map((d) => d.startAt),
                whenMode: experience.whenMode,
                recurrenceRule: experience.recurrenceRule,
              }) ?? null
            }
            byline={query.data?.brand?.name ?? null}
            coverUrl={experience.coverMediaUrl ?? null}
          />
        ) : null}
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
          <GlassCard variant="base" radius="lg" padding={space[4]}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryHeaderText}>Order summary</Text>
              <Text style={styles.summaryEditText}>Edit</Text>
            </View>
            {/* #4420 — the last priced quote stays on screen while typing
                re-quotes, so the summary never collapses under the form. */}
            {summaryQuote.quote !== null ? (
              <React.Suspense fallback={null}>
                <TicketQuoteSummary
                  quote={summaryQuote.quote}
                  compact
                  totalLabel={BUYER_CLAIM_COPY.confirmTotalLabel}
                  totalValue={
                    summaryQuote.quote.buyerTotalCents === 0
                      ? BUYER_CLAIM_COPY.receipt.free
                      : formatCurrency(
                          summaryQuote.quote.buyerTotalCents / 100,
                          summaryQuote.quote.currency,
                        )
                  }
                />
              </React.Suspense>
            ) : null}
          </GlassCard>
        </Pressable>

        {Platform.OS !== "web" && sessionUserId !== null ? (
          <Text
            style={styles.buyerContext}
            testID="business-buyer-recipient-note"
          >
            {BUYER_CLAIM_COPY.bizCheckout.forSomeoneElse}
          </Text>
        ) : null}

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
            onBlur={() => blurField("name")}
          />
          <FieldErrorLine
            message={visibleErrors.name}
            style={styles.errorText}
            testID="checkout-buyer-name-error"
          />
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
            onBlur={() => blurField("email")}
          />
          <FieldErrorLine
            message={visibleErrors.email}
            style={styles.errorText}
            testID="checkout-buyer-email-error"
          />
        </View>

        <View style={styles.fieldWrap}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <Text style={styles.required}>*</Text>
          </View>
          <PhoneInput
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={handlePhoneLocalChange}
            onChangeCountry={handlePhoneCountryChange}
            onBlur={() => blurField("phone")}
            reserveErrorSpace
            error={visibleErrors.phone}
            disabled={false}
            iconRenderer={(
              name: PhoneInputIconName,
              iconProps: { size: number; color: string },
            ) => {
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
            theme={publicBuyerPhoneTheme()}
          />
        </View>

        <Text style={styles.promise} testID="checkout-claim-promise">
          {BUYER_CLAIM_COPY.checkoutPromise.booking}
        </Text>

        <Pressable
          onPress={toggleTerms}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: termsAccepted, disabled: !authReady }}
          aria-checked={termsAccepted}
          accessibilityLabel={PURCHASE_TERMS_DISCLOSURE_TEXT}
          disabled={!authReady}
          style={({ pressed }) => [
            styles.checkboxRow,
            pressed && styles.checkboxRowPressed,
          ]}
        >
          <View
            style={[
              styles.checkboxBox,
              termsAccepted && styles.checkboxBoxChecked,
              consentHintVisible && !termsAccepted && styles.checkboxBoxFlash,
            ]}
          >
            {termsAccepted ? (
              <Icon name="check" size={14} color={color.text1} />
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>
            {PURCHASE_TERMS_LABEL_PREFIX}
            <Text
              style={styles.checkboxLinkUnderlined}
              onPress={(event) => {
                event.stopPropagation();
                void Linking.openURL(PURCHASE_TERMS_URL);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Mingla Terms of Service"
            >
              {PURCHASE_TERMS_LABEL_TERMS}
            </Text>
            {PURCHASE_TERMS_LABEL_JOINER}
            <Text
              style={styles.checkboxLinkUnderlined}
              onPress={(event) => {
                event.stopPropagation();
                void Linking.openURL(PURCHASE_PRIVACY_URL);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Mingla Privacy Policy"
            >
              {PURCHASE_TERMS_LABEL_PRIVACY}
            </Text>
            {PURCHASE_TERMS_LABEL_SUFFIX}
          </Text>
        </Pressable>
        {consentHintVisible && !termsAccepted ? (
          <Text style={styles.consentRequiredHint}>
            Please agree to continue.
          </Text>
        ) : null}
        {/* #4273: buying opts the buyer in to this brand's updates; there is
            no box to tick, only a plain notice. */}
        <Text style={styles.marketingHelper} testID="checkout-marketing-notice">
          {CHECKOUT_MARKETING_NOTICE}
        </Text>
        {submitError !== null ? (
          <Text style={styles.errorText}>{submitError}</Text>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + space[4] },
          keyboardVisible ? styles.bottomBarHidden : null,
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {BUYER_CLAIM_COPY.confirmTotalLabel}
          </Text>
          <Text style={styles.totalValue}>
            {quoteStatus !== "ready"
              ? "Updating…"
              : totals.isFree
                ? BUYER_CLAIM_COPY.receipt.free
                : formatCurrency(totals.allInTotal, totals.currency)}
          </Text>
        </View>
        <Pressable
          onPress={continueDisabled ? showConsentHint : undefined}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
        >
          <View pointerEvents={continueDisabled ? "none" : "auto"}>
            <Button
              label={continueLabel}
              onPress={handleDetailsContinue}
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={continueDisabled}
            />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = checkoutStyles(() => StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space[6], paddingTop: space[4] },
  summaryWrap: { marginBottom: space[6] },
  summaryPressed: { opacity: 0.7 },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space[2],
  },
  summaryHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: color.text3,
    letterSpacing: 1.4,
  },
  summaryEditText: { fontSize: 12, fontWeight: "600", color: color.accent },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: space[2],
  },
  summaryLineQty: {
    fontSize: 14,
    color: color.text3,
    fontWeight: "500",
    minWidth: 28,
  },
  summaryLineName: {
    flex: 1,
    fontSize: 14,
    color: color.text1,
    fontWeight: "500",
  },
  summaryLineTotal: {
    fontSize: 14,
    color: color.text1,
    fontWeight: "600",
  },
  summaryDivider: {
    marginVertical: space[2],
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.fill.pressed,
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryTotalLabel: {
    fontSize: 13,
    color: color.text3,
    fontWeight: "500",
  },
  summaryTotalValue: {
    fontSize: 17,
    color: color.text1,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: color.text3,
    letterSpacing: 1.4,
    marginBottom: space[2],
  },
  fieldWrap: { marginBottom: space[4] },
  buyerContext: {
    marginBottom: space[4],
    fontSize: 13,
    lineHeight: 19,
    color: color.text2,
  },
  promise: {
    marginTop: space[1],
    marginBottom: space[2],
    fontSize: 13,
    lineHeight: 19,
    color: color.text2,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
    gap: 4,
  },
  fieldLabel: { fontSize: 13, fontWeight: "500", color: color.text2 },
  required: { fontSize: 13, fontWeight: "600", color: color.danger },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: color.danger,
    fontWeight: "500",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[2],
    gap: space[2],
    marginTop: space[1],
  },
  checkboxRowPressed: { opacity: 0.7 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: radiusTokens.sm,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: color.text2,
    lineHeight: 20,
  },
  checkboxLinkUnderlined: {
    color: color.accent,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  marketingHelper: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: color.text3,
  },
  checkboxBoxFlash: {
    borderColor: color.danger,
  },
  consentRequiredHint: {
    marginTop: 6,
    fontSize: 12,
    color: color.danger,
    fontWeight: "500",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[4],
    paddingHorizontal: space[6],
    backgroundColor: materials.chrome.glassFill,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  bottomBarHidden: { transform: [{ translateY: 200 }] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: space[2],
  },
  totalLabel: { fontSize: 13, color: color.text3, fontWeight: "500" },
  totalValue: {
    fontSize: 20,
    color: color.text1,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
}));
