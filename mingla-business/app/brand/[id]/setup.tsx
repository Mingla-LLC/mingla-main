/**
 * /brand/[id]/setup?step=name|country|pay|done — resume brand setup (#4389).
 *
 * The second (and last) mount of BrandCreationFlow. The step in the URL is a
 * request: the flow clamps it to the first unfinished item of
 * brand_readiness(brand_setup), so "done" is never shown early (SC-2).
 * Readiness handoffs, Home, Ari and the switcher push this route; nothing
 * embeds the flow.
 */
import React, { Suspense, useCallback } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyBrandCreationFlow } from "../../../src/components/brand/LazyBrandCreationFlow";
import { canvas } from "../../../src/constants/designSystem";
import { isSetupFlowHop, parseSetupStep } from "../../../src/services/brandSetupCore";

export default function BrandSetupRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; step?: string | string[]; from?: string | string[]; k1?: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const step = parseSetupStep(Array.isArray(params.step) ? params.step[0] : params.step);
  const leave = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as never);
  }, [router]);
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <Suspense fallback={null}>
        <LazyBrandCreationFlow
          brandId={typeof brandId === "string" && brandId.length > 0 ? brandId : null}
          requestedStep={step}
          // R1 — a cold open from a resume entry (Home, Ari, switcher,
          // N1 Continue, a deep link); a hop inside the setup is not one.
          resumed={!isSetupFlowHop(params.from)}
          // #4389 S-11 — the native secure setup was closed early.
          openK1={params.k1 === "1"}
          onExit={leave}
        />
      </Suspense>
    </View>
  );
}
