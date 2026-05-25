import React from "react";

import { NativeConnectWebOnlyFallback } from "../src/components/stripe/NativeConnectWebOnlyFallback";

export default function ConnectOnboardingNativeRoute(): React.ReactElement {
  return (
    <NativeConnectWebOnlyFallback
      title="Open onboarding in the browser"
      body="Stripe onboarding runs in Mingla's hosted web page. Return to payments and open Set up payments again."
    />
  );
}
