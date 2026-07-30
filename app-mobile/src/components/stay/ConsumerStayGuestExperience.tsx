import React, { useState } from "react";
import { initStripe } from "@stripe/stripe-react-native";
import { useStripePaymentSheet } from "@mingla/payments-native";
import { StayGuestBooking } from "@mingla/brand-rendering/StayGuestBooking";
import {
  type StayGuestCheckoutInput,
  type StayQuote,
} from "@mingla/brand-rendering/stayGuest";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";

import { usePublicStayDetail } from "../../hooks/useStayGuest";
import { postHogService } from "../../services/postHogService";
import { stayGuestService } from "../../services/stayGuestService";
import { supabase } from "../../services/supabase";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

const applePayItems = (
  title: string,
  amountMinor: string,
  currencyCode: string,
): {
  label: string;
  amount: string;
  paymentType: "Immediate";
}[] => {
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const padded = amountMinor.padStart(digits + 1, "0");
  const amount =
    digits === 0
      ? padded
      : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return [{ label: title.trim() || "Stay reservation", amount, paymentType: "Immediate" }];
};

export function ConsumerStayGuestExperience({
  venueId,
  venueName,
  brandId,
  palette,
  surface,
  theme,
}: {
  venueId: string;
  venueName: string;
  brandId: string;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}): React.ReactElement {
  const router = useRouter();
  const detailQuery = usePublicStayDetail(venueId, true);
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();
  const [checkout, setCheckout] = useState<StayGuestCheckoutInput | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepareQuote = async (input: StayGuestCheckoutInput): Promise<void> => {
    const { data } = await supabase.auth.getSession();
    if (data.session === null) {
      router.push("/" as never);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const nextQuote = await stayGuestService.quote(venueId, input.lines);
      setCheckout(input);
      setQuote(nextQuote);
      postHogService.capture("stay_quote_succeeded", {
        surface: "consumer_native",
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
      postHogService.capture("stay_quote_failed", {
        surface: "consumer_native",
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
      if (group.mode === "request") {
        postHogService.capture("stay_request_submitted", {
          surface: "consumer_native",
          brand_id: brandId,
          venue_id: venueId,
          group_id: group.groupId,
        });
        router.push(`/stay/${group.groupId}` as never);
        return;
      }
      const payment = await stayGuestService.createPayment(group);
      postHogService.capture("stay_payment_started", {
        surface: "consumer_native",
        brand_id: brandId,
        venue_id: venueId,
        group_id: group.groupId,
        provider: payment.provider,
        currency: payment.currencyCode,
      });
      if (payment.provider === "paystack") {
        await WebBrowser.openBrowserAsync(payment.authorizationUrl);
        router.push(`/stay/${group.groupId}` as never);
        return;
      }
      if (!isPaymentSheetSupported) {
        throw new Error("Native payment is not available on this device.");
      }
      await initStripe({
        publishableKey: payment.publishableKey,
        stripeAccountId: payment.stripeAccountId,
        merchantIdentifier: "merchant.com.mingla.app.v2",
        urlScheme: "com.mingla.app.v2",
      });
      const initialized = await initPaymentSheet({
        merchantDisplayName: "Mingla",
        paymentIntentClientSecret: payment.clientSecret,
        returnURL: "com.mingla.app.v2://stripe-redirect",
        applePay: {
          merchantCountryCode: "US",
          cartItems: applePayItems(
            venueName,
            payment.amountMinor,
            payment.currencyCode,
          ),
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: process.env.EAS_BUILD_PROFILE !== "production",
          currencyCode: payment.currencyCode.toLowerCase(),
        },
      });
      if (initialized.error) {
        throw new Error(
          initialized.error.localizedMessage ??
            initialized.error.message ??
            "Payment could not open.",
        );
      }
      const presented = await presentPaymentSheet();
      if (presented.error) {
        if (presented.error.code === "Canceled") {
          setSubmitting(false);
          return;
        }
        throw new Error(
          presented.error.localizedMessage ??
            presented.error.message ??
            "Payment could not be completed.",
        );
      }
      postHogService.capture("stay_payment_completed", {
        surface: "consumer_native",
        brand_id: brandId,
        venue_id: venueId,
        group_id: group.groupId,
        provider: "stripe",
      });
      router.push(`/stay/${group.groupId}?payment=returned` as never);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "This Stay reservation could not be completed.",
      );
      postHogService.capture("stay_payment_failed", {
        surface: "consumer_native",
        brand_id: brandId,
        venue_id: venueId,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StayGuestBooking
      detail={detailQuery.data ?? null}
      state={
        detailQuery.isLoading
          ? "loading"
          : detailQuery.isError
            ? "error"
            : detailQuery.data === null
              ? "unavailable"
              : "ready"
      }
      palette={palette}
      surface={surface}
      theme={theme}
      submitting={submitting}
      errorMessage={error}
      quote={quote}
      onRetry={() => {
        void detailQuery.refetch();
      }}
      onSubmit={prepareQuote}
      onConfirmQuote={confirm}
      onEditQuote={() => {
        setQuote(null);
        setError(null);
      }}
      onAnalytics={(event, properties) => {
        postHogService.capture(event, {
          surface: "consumer_native",
          brand_id: brandId,
          venue_id: venueId,
          ...properties,
        });
      }}
    />
  );
}
