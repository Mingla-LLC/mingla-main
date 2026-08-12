import React, { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StayGuestBooking, type StayGuestBookingProps } from "@mingla/brand-rendering/StayGuestBooking";
import {
  type PublicStayDetail,
  type StayGuestCheckoutInput,
  type StayPaymentSession,
  type StayQuote,
} from "@mingla/brand-rendering/stayGuest";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuestMoney";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone";
import { Icon } from "../ui/Icon";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import { captureWeb } from "../../analytics/webAnalytics";
import { stayGuestService } from "../../services/stayGuestService";
import { supabase } from "../../services/supabase";

// Payment Element and Stripe.js are needed only after an instant reservation
// group has been created. This second lazy boundary keeps both SDKs out of the
// shared boot chunk and out of Request-to-book sessions entirely.
const StayStripePayment = React.lazy(() =>
  import("./StayStripePayment").then((module) => ({
    default: module.StayStripePayment,
  })),
);

type Surface = ReturnType<typeof offeringSurfaceStyles>;
type StayPhoneRenderer = NonNullable<StayGuestBookingProps["renderPhoneField"]>;

export function BuyerStayGuestExperience({
  venueId,
  brandId,
  detail,
  state,
  palette,
  surface,
  theme,
  onQuoteChange,
}: {
  venueId: string;
  brandId: string;
  detail: PublicStayDetail | null;
  state: "loading" | "ready" | "unavailable" | "error";
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  /**
   * issue #1562 mitigation 2 — report the guest's REAL quoted total upward so
   * the first screen can replace the "from" rate with it IN THE SAME SLOT.
   *
   * WHY A CALLBACK AND NOT LIFTED STATE. The quote is produced HERE, by this
   * component's own `stayGuestService.quote` call, and every other consumer of
   * it (confirm, payment, cancellation) is also here. Lifting the whole quote
   * into the route would move five call sites to fix one read. Reporting it is
   * one effect, and it keeps this component the single writer.
   *
   * ONLY AN `active` QUOTE IS REPORTED. A quote that has expired or been
   * consumed is no longer the guest's total, and continuing to headline it
   * would be exactly the stale-number problem the from-rate swap exists to
   * prevent. Those states report `null`, and the from-rate honestly returns.
   */
  onQuoteChange?: (quote: { totalMinor: string; currencyCode: string } | null) => void;
}): React.ReactElement {
  const router = useRouter();
  const [checkout, setCheckout] = useState<StayGuestCheckoutInput | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [payment, setPayment] = useState<StayPaymentSession | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneTheme = React.useMemo<PhoneInputTheme>(() => ({
    backgroundPrimary: palette.page,
    textPrimary: palette.primaryText,
    textTertiary: palette.tertiaryText,
    borderDefault: palette.panelBorder,
    borderFocused: palette.accent,
    borderError: "#ef4444",
    searchBackground: palette.card,
    rowPressedBackground: palette.accentWash,
    divider: palette.panelBorder,
    accessoryBackground: palette.page,
    accessoryBorder: palette.panelBorder,
    accent: palette.accent,
    errorText: theme.foregroundColor === "#ffffff" ? "#f87171" : "#b91c1c",
  }), [palette, theme.foregroundColor]);
  const renderPhoneField = React.useCallback<StayPhoneRenderer>((args) => (
    <View style={styles.phoneField}>
      <Text style={[styles.phoneLabel, { color: palette.tertiaryText }]}>{args.label}</Text>
      <PhoneInput
        pickerPresentation="overlay"
        value={args.rawValue}
        countryCode={args.countryCode}
        onChangePhone={(raw: string) => args.onChangeRawValue(raw, resolveUserPhoneE164(raw, args.countryCode))}
        onChangeCountry={(iso: string) => args.onChangeCountry(iso, resolveUserPhoneE164(args.rawValue, iso))}
        error={args.invalid ? "Select a country and enter a valid phone number." : null}
        disabled={args.disabled}
        theme={phoneTheme}
        maxLength={40}
        testID={args.testID}
        countryButtonAccessibilityLabel={args.countryCode === null ? "Select country" : `${args.label} country, ${getCountryByCode(args.countryCode)?.name ?? args.countryCode}, tap to change`}
        phoneInputAccessibilityLabel={`${args.label} phone number`}
        iconRenderer={(name: PhoneInputIconName, iconProps: { size: number; color: string }) => (
          <Icon name={name === "chevronDown" ? "chevD" : name === "checkmark" ? "check" : name === "close" ? "close" : "search"} size={iconProps.size} color={iconProps.color} />
        )}
        labels={{
          phonePlaceholder: "Phone number",
          countryButtonAccessibilityLabel: (name: string) => `Country code, ${name}, tap to change`,
          phoneInputAccessibilityLabel: "Phone number",
          doneButton: "Done",
          pickerTitle: "Select Country",
          pickerSearchPlaceholder: "Search country or dial code",
          pickerCloseAccessibilityLabel: "Close country picker",
          pickerNoResults: "No countries found",
        }}
      />
    </View>
  ), [palette.tertiaryText, phoneTheme]);

  // issue #1562 — publish the quoted total to the page's first screen. Runs on
  // every quote transition INCLUDING back to null (a cleared or expired quote
  // must restore the from-rate, not freeze the last total on screen).
  React.useEffect(() => {
    if (onQuoteChange === undefined) return;
    onQuoteChange(
      quote !== null && quote.status === "active"
        ? { totalMinor: quote.totalMinor, currencyCode: quote.currencyCode }
        : null,
    );
  }, [onQuoteChange, quote]);

  const requireSession = async (): Promise<boolean> => {
    const { data } = await supabase.auth.getSession();
    if (data.session !== null) return true;
    if (typeof window !== "undefined") {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/auth?next=${encodeURIComponent(next)}`);
    }
    return false;
  };

  const prepareQuote = async (input: StayGuestCheckoutInput): Promise<void> => {
    if (!(await requireSession())) return;
    setSubmitting(true);
    setError(null);
    try {
      const nextQuote = await stayGuestService.quote(venueId, input.lines);
      setCheckout(input);
      setQuote(nextQuote);
      captureWeb("stay_quote_succeeded", {
        surface: "buyer_web",
        brand_id: brandId,
        venue_id: venueId,
        line_count: input.lines.length,
        currency: nextQuote.currencyCode,
        mode: nextQuote.mode,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Current availability could not be confirmed.",
      );
      captureWeb("stay_quote_failed", {
        surface: "buyer_web",
        brand_id: brandId,
        venue_id: venueId,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (quote === null || checkout === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const group = await stayGuestService.createGroup(quote, checkout.guest);
      setGroupId(group.groupId);
      if (group.mode === "request") {
        captureWeb("stay_request_submitted", {
          surface: "buyer_web",
          brand_id: brandId,
          venue_id: venueId,
          group_id: group.groupId,
        });
        router.push(`/stay/${group.groupId}` as never);
        return;
      }
      const session = await stayGuestService.createPayment(group);
      captureWeb("stay_payment_started", {
        surface: "buyer_web",
        brand_id: brandId,
        venue_id: venueId,
        group_id: group.groupId,
        provider: session.provider,
        currency: session.currencyCode,
      });
      if (session.provider === "paystack") {
        await Linking.openURL(session.authorizationUrl);
        router.push(`/stay/${group.groupId}` as never);
        return;
      }
      setPayment(session);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "This Stay reservation could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (payment?.provider === "stripe" && groupId !== null) {
    return (
      <View style={[styles.paymentCard, surface.card]}>
        <Text style={[styles.heading, { color: palette.primaryText }]}>
          Pay {formatStayMoney(payment.amountMinor, payment.currencyCode)}
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Your Room and Place inventory is held while you complete payment.
        </Text>
        <React.Suspense
          fallback={
            <Text style={[styles.body, { color: palette.secondaryText }]}>
              Loading secure payment…
            </Text>
          }
        >
          <StayStripePayment
            session={payment}
            groupId={groupId}
            accent={palette.accent}
            onComplete={() => {
              captureWeb("stay_payment_completed", {
                surface: "buyer_web",
                brand_id: brandId,
                venue_id: venueId,
                group_id: groupId,
                provider: "stripe",
              });
              router.replace(`/stay/${groupId}?payment=returned` as never);
            }}
          />
        </React.Suspense>
      </View>
    );
  }

  return (
    <StayGuestBooking
      detail={detail}
      state={state}
      palette={palette}
      surface={surface}
      theme={theme}
      submitting={submitting}
      errorMessage={error}
      quote={quote}
      onRetry={() => {
        if (typeof window !== "undefined") window.location.reload();
      }}
      onSubmit={prepareQuote}
      renderPhoneField={renderPhoneField}
      onConfirmQuote={confirm}
      onEditQuote={() => {
        setQuote(null);
        setError(null);
      }}
      onAnalytics={(event, properties) => {
        captureWeb(event, {
          surface: "buyer_web",
          brand_id: brandId,
          venue_id: venueId,
          ...properties,
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  phoneField: { marginBottom: 16 },
  phoneLabel: { fontSize: 12, fontWeight: "700", marginBottom: 6 },
  paymentCard: { padding: 18, gap: 14 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "900" },
  body: { fontSize: 14, lineHeight: 20 },
});
