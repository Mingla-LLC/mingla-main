/**
 * /account/tap-to-pay — #4271 Tap to Pay in Settings: enable it, see that it's on,
 * and re-find how to take a tap. ?brandId= is optional, else the current brand.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — the screen component applies useSafeAreaInsets (paddingTop: insets.top).
import React, { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyTapToPaySetupScreen } from "../../src/components/door/LazyDoorSaleScreens";
import { useBrand } from "../../src/hooks/useBrands";
import { setTapToPayScope } from "../../src/services/terminal/tapToPaySession";
import { useCurrentBrandId } from "../../src/store/currentBrandStore";

export default function TapToPaySettingsRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ brandId?: string | string[] }>();
  const currentBrandId = useCurrentBrandId();
  const fromParams = Array.isArray(params.brandId) ? (params.brandId[0] ?? null) : (params.brandId ?? null);
  const brandId = fromParams ?? currentBrandId;
  const brandQuery = useBrand(brandId);
  const merchantDisplayName = brandQuery.data?.displayName ?? null;
  useEffect(() => {
    setTapToPayScope({ brandId, eventId: null, merchantDisplayName });
    return () => setTapToPayScope(null);
  }, [brandId, merchantDisplayName]);
  return <LazyTapToPaySetupScreen brandId={brandId} eventId={null} rawDraft={null} />;
}
