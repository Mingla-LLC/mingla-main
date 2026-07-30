import React, { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StayGuestBooking } from "@mingla/brand-rendering/StayGuestBooking";
import {
  type PublicStayDetail,
  type StayGuestCheckoutInput,
  type StayPaymentSession,
  type StayQuote,
} from "@mingla/brand-rendering/stayGuest";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuestMoney";
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

export function BuyerStayGuestExperience({
  venueId,
  brandId,
  detail,
  state,
  palette,
  surface,
  theme,
}: {
  venueId: string;
  brandId: string;
  detail: PublicStayDetail | null;
  state: "loading" | "ready" | "unavailable" | "error";
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}): React.ReactElement {
  const router = useRouter();
  const [checkout, setCheckout] = useState<StayGuestCheckoutInput | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [payment, setPayment] = useState<StayPaymentSession | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  paymentCard: { padding: 18, gap: 14 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "900" },
  body: { fontSize: 14, lineHeight: 20 },
});
