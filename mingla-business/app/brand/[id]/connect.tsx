/**
 * Native compatibility route for /brand/[id]/connect.
 *
 * Wave 2 changes only the web one-hop surface. Native redirects to the
 * established payments/onboard route until the founder-gated Wave 4 build.
 * Keeping this as navigation instead of a module re-export prevents Expo's web
 * route graph from making the full legacy onboarding screen eager.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect-only route (<Redirect>), no visible surface
import React from "react";
import { Redirect, useLocalSearchParams, type Href } from "expo-router";

import {
  sanitizeBankSetupReturnPath,
  withBankSetupReturn,
} from "../../../src/utils/bankSetupReturn";

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim().length > 0 ? first : null;
}

export default function BrandBankConnectNativeAlias(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    from?: string | string[];
    country?: string | string[];
    resume?: string | string[];
  }>();
  const brandId = firstParam(params.id);
  // #3645 — where a creator sent the host from; validated, then carried on.
  const resumePath = sanitizeBankSetupReturnPath(params.resume);
  // #3645 — carry the payout country chosen during brand creation through.
  const country = firstParam(params.country);
  const countryQuery = country !== null && /^[A-Za-z]{2}$/.test(country)
    ? `&country=${country.toUpperCase()}`
    : "";

  if (brandId === null) {
    return <Redirect href="/(tabs)/account" />;
  }

  const onboardHref = (
    params.from === "brand-create"
      ? `/brand/${encodeURIComponent(brandId)}/payments/onboard?from=brand-create${countryQuery}`
      : withBankSetupReturn(
        `/brand/${encodeURIComponent(brandId)}/payments/onboard`,
        resumePath,
      )
  ) as Href;
  return <Redirect href={onboardHref} />;
}
