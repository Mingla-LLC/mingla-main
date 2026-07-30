import React, { useMemo, useState } from "react";
import {
  PaymentElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";

interface Props {
  session: Extract<StayPaymentSession, { provider: "stripe" }>;
  groupId: string;
  accent: string;
  onComplete: () => void;
}

export function StayStripePayment({
  session,
  groupId,
  accent,
  onComplete,
}: Props): React.ReactElement {
  const stripe = useMemo(
    () =>
      loadStripe(session.publishableKey, {
        stripeAccount: session.stripeAccountId,
      }),
    [session.publishableKey, session.stripeAccountId],
  );
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: session.clientSecret,
        appearance: {
          theme: "night",
          variables: { colorPrimary: accent, borderRadius: "12px" },
        },
      }}
    >
      <StayStripePaymentForm groupId={groupId} onComplete={onComplete} />
    </Elements>
  );
}

function StayStripePaymentForm({
  groupId,
  onComplete,
}: {
  groupId: string;
  onComplete: () => void;
}): React.ReactElement {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async (): Promise<void> => {
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    const returnUrl =
      `${window.location.origin}/stay/${encodeURIComponent(groupId)}?payment=returned`;
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Payment could not be completed.");
      setSubmitting(false);
      return;
    }
    onComplete();
  };

  return (
    <View style={styles.host}>
      <PaymentElement />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pay for Stay reservation"
        accessibilityState={{ disabled: submitting || !stripe || !elements }}
        disabled={submitting || !stripe || !elements}
        onPress={() => {
          void pay();
        }}
        style={[styles.button, (submitting || !stripe) && styles.disabled]}
      >
        <Text style={styles.buttonText}>
          {submitting ? "Processing securely…" : "Pay securely"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 16 },
  error: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
  button: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.55 },
});
