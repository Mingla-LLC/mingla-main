import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripePaymentElement,
} from "@stripe/stripe-js";

import type { TripBalanceStart } from "../../services/tripBalancePayService";
import { color } from "../../theme/surfaceTokens";

export function TripBalanceStripePayment({
  session,
  returnUrl,
  onComplete,
}: {
  session: Extract<TripBalanceStart, { kind: "stripe" }>;
  returnUrl: string;
  onComplete: () => void;
}): React.ReactElement {
  const stripePromise = useMemo(
    () =>
      loadStripe(session.publishableKey, {
        stripeAccount: session.stripeAccountId,
      }),
    [session.publishableKey, session.stripeAccountId],
  );
  const mount = useRef<HTMLDivElement | null>(null);
  const stripe = useRef<Stripe | null>(null);
  const elements = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let payment: StripePaymentElement | null = null;
    void stripePromise.then((client) => {
      if (disposed || client === null || mount.current === null) return;
      const nextElements = client.elements({
        clientSecret: session.clientSecret,
        appearance: {
          theme: "night",
          variables: { colorPrimary: color.accent, borderRadius: "12px" },
        },
      });
      payment = nextElements.create("payment");
      payment.on("ready", () => !disposed && setReady(true));
      payment.on(
        "loaderror",
        () => !disposed && setError("Secure payment could not be loaded."),
      );
      payment.mount(mount.current);
      stripe.current = client;
      elements.current = nextElements;
    }).catch(() => setError("Secure payment could not be loaded."));
    return () => {
      disposed = true;
      payment?.destroy();
    };
  }, [session.clientSecret, stripePromise]);
  const pay = async (): Promise<void> => {
    if (!stripe.current || !elements.current || busy) return;
    setBusy(true);
    setError(null);
    const result = await stripe.current.confirmPayment({
      elements: elements.current,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Payment could not be completed.");
      setBusy(false);
      return;
    }
    onComplete();
  };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div ref={mount} />
      {error
        ? (
          <p role="alert" style={{ color: color.errorText, margin: 0 }}>
            {error}
          </p>
        )
        : null}
      <button
        disabled={!ready || busy}
        onClick={() => void pay()}
        style={{
          minHeight: 52,
          border: 0,
          borderRadius: 999,
          background: color.accent,
          color: color.text1,
          fontWeight: 900,
          opacity: !ready || busy ? 0.55 : 1,
        }}
        type="button"
      >
        {busy ? "Processing securely…" : "Pay securely"}
      </button>
    </div>
  );
}
