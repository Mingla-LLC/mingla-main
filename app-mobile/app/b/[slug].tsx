import React from "react";
import { useLocalSearchParams } from "expo-router";

import ConsumerBrandProfileScreen from "../../src/screens/ConsumerBrandProfileScreen";
import { useCanonicalShareArrival } from "../../src/hooks/useCanonicalShareArrival";

/**
 * /b/{slug} — the brand profile. #3187: a shared brand link now opens here
 * directly (`host.usemingla.com/b/{slug}?ms=…`) instead of via `/s/`, so the
 * share's installed-app attribution is recorded here.
 */
export default function BrandDeepLinkRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ ms?: string | string[] }>();
  useCanonicalShareArrival(params.ms);
  return <ConsumerBrandProfileScreen />;
}
