import React from "react";

import { useNativeCheckoutFlow } from "./nativeCheckoutFlow";
import { StripeProviderWrapper } from "./StripeProviderWrapper";
import type { NativeCheckoutPaymentBoundaryProps } from "./NativeCheckoutPaymentBoundary";

export default function NativeCheckoutPaymentBoundary({
  children,
}: NativeCheckoutPaymentBoundaryProps): React.ReactElement {
  const nativeCheckout = useNativeCheckoutFlow();

  return (
    <StripeProviderWrapper>
      {children(nativeCheckout)}
    </StripeProviderWrapper>
  );
}
