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
import { Redirect, useLocalSearchParams } from "expo-router";

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim().length > 0 ? first : null;
}

export default function BrandBankConnectNativeAlias(): React.ReactElement {
  const params = useLocalSearchParams<{
    id?: string | string[];
    from?: string | string[];
  }>();
  const brandId = firstParam(params.id);

  if (brandId === null) {
    return <Redirect href="/(tabs)/account" />;
  }

  const onboardHref = params.from === "brand-create"
    ? `/brand/${encodeURIComponent(brandId)}/payments/onboard?from=brand-create`
    : `/brand/${encodeURIComponent(brandId)}/payments/onboard`;
  return <Redirect href={onboardHref} />;
}
