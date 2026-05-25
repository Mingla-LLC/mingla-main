import React from "react";

import { NativeConnectWebOnlyFallback } from "../src/components/stripe/NativeConnectWebOnlyFallback";

export default function ConnectAccountManagementNativeRoute(): React.ReactElement {
  return (
    <NativeConnectWebOnlyFallback
      title="Open payout tools in the browser"
      body="Stripe payout and tax tools run in Mingla's hosted web page. Return to payments and open Manage payouts and tax again."
    />
  );
}
