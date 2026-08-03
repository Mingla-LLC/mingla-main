import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripePaymentElement,
} from "@stripe/stripe-js";

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
  const stripePromise = useMemo(
    () =>
      loadStripe(session.publishableKey, {
        stripeAccount: session.stripeAccountId,
      }),
    [session.publishableKey, session.stripeAccountId],
  );
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let paymentElement: StripePaymentElement | null = null;
    setReady(false);
    setError(null);

    void stripePromise
      .then((stripe) => {
        if (disposed) return;
        if (stripe === null || mountRef.current === null) {
          setError("Secure payment could not be loaded.");
          return;
        }
        const elements = stripe.elements({
          clientSecret: session.clientSecret,
          appearance: {
            theme: "night",
            variables: { colorPrimary: accent, borderRadius: "12px" },
          },
        });
        paymentElement = elements.create("payment");
        paymentElement.on("ready", () => {
          if (!disposed) setReady(true);
        });
        paymentElement.on("loaderror", () => {
          if (!disposed) setError("Secure payment could not be loaded.");
        });
        paymentElement.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
      })
      .catch(() => {
        if (!disposed) setError("Secure payment could not be loaded.");
      });

    return () => {
      disposed = true;
      paymentElement?.destroy();
      stripeRef.current = null;
      elementsRef.current = null;
    };
  }, [accent, session.clientSecret, stripePromise]);

  const pay = async (): Promise<void> => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
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
    <div style={styles.host}>
      <div ref={mountRef} />
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        aria-label="Pay for Stay reservation"
        disabled={submitting || !ready}
        onClick={() => {
          void pay();
        }}
        style={{
          ...styles.button,
          opacity: submitting || !ready ? 0.55 : 1,
        }}
      >
        {submitting ? "Processing securely…" : "Pay securely"}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  host: { display: "grid", gap: 16 },
  error: { color: "#ef4444", fontSize: 13, lineHeight: "18px", margin: 0 },
  button: {
    minHeight: 52,
    borderRadius: 999,
    border: 0,
    backgroundColor: "#eb7825",
    cursor: "pointer",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 900,
    padding: "0 24px",
  },
};
