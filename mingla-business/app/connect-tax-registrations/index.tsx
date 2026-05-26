import React from "react";

import { NativeConnectWebOnlyFallback } from "../../src/components/stripe/NativeConnectWebOnlyFallback";

export default function ConnectTaxRegistrationsNativeRoute(): React.ReactElement {
  return (
    <NativeConnectWebOnlyFallback
      title="Open tax tools in the browser"
      body="Stripe tax tools run in Mingla's hosted web page. Return to payments and open Tax tools again."
    />
  );
}
