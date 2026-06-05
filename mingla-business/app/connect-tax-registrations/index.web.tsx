/**
 * /connect-tax-registrations — embedded Stripe Tax registrations + settings page.
 *
 * ORCH-1083: the heavy body (Stripe Connect web SDK + embedded tax components) is
 * code-split out of the initial web bundle via React.lazy. The body lives in
 * src/components/stripe/connect-pages/ConnectTaxRegistrationsBody.web.tsx — it is
 * the ONLY place that statically imports @stripe/*. DO NOT re-add a static
 * @stripe/connect-js / @stripe/react-connect-js import here (this route file is
 * one level deeper than the others — note the ../../ import path). See SPEC §C-1.
 */

import React, { Suspense } from "react";

import ConnectLoadingFallback from "../../src/components/stripe/connect-pages/ConnectLoadingFallback.web";

const ConnectTaxRegistrationsBody = React.lazy(
  () =>
    import(
      "../../src/components/stripe/connect-pages/ConnectTaxRegistrationsBody.web"
    ),
);

export default function ConnectTaxRegistrationsPage(): React.ReactElement {
  return (
    <Suspense fallback={<ConnectLoadingFallback />}>
      <ConnectTaxRegistrationsBody />
    </Suspense>
  );
}
