import React from "react";

import type {
  NativeCheckoutInput,
  NativeCheckoutOutcome,
} from "./nativeCheckoutFlow";

export type NativeCheckoutExecutor = (
  input: NativeCheckoutInput,
) => Promise<NativeCheckoutOutcome>;

export interface NativeCheckoutPaymentBoundaryProps {
  children: (nativeCheckout: NativeCheckoutExecutor) => React.ReactElement;
}

const webNativeCheckout: NativeCheckoutExecutor = async () => ({
  outcome: "failed",
  message:
    "Native PaymentSheet is not available on web. Use the hosted checkout branch instead.",
});

export default function NativeCheckoutPaymentBoundary({
  children,
}: NativeCheckoutPaymentBoundaryProps): React.ReactElement {
  return <>{children(webNativeCheckout)}</>;
}
