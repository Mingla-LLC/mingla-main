/**
 * /brand/[id]/connect — bank-first partner setup entry (web).
 *
 * The product body is kept behind a lazy boundary so the existing Stripe
 * onboarding screen and its shared dependencies stay out of the eager web
 * bundle. Keep this route shell free of bank-connect body imports.
 */

import React, { Suspense } from "react";

import ConnectLoadingFallback from "../../../src/components/stripe/connect-pages/ConnectLoadingFallback.web";

const BrandBankConnectBody = React.lazy(
  () => import("../../../src/components/brand/BrandBankConnectBody.web"),
);

export default function BrandBankConnectWebRoute(): React.ReactElement {
  return (
    <Suspense fallback={<ConnectLoadingFallback />}>
      <BrandBankConnectBody />
    </Suspense>
  );
}
