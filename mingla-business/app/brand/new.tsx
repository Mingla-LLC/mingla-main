/**
 * /brand/new — full-screen brand-creation route (ORCH-1332
 * [partner-brand-fixes]).
 *
 * Before ORCH-1332 no `/brand/new` route file existed, so expo-router fell
 * through to the dynamic `app/brand/[id]` segment with `id="new"`, resolved a
 * null brand, and rendered the brand-profile "Brand not found" screen — a dead
 * tap for both `/partner/brands` and `/partner/earnings` CTAs, which push
 * `/brand/new?partner_mode=client`.
 *
 * This thin wrapper mounts the existing full-screen `BrandCreationFlow`
 * (mirroring how `app/event/create.tsx` launches its wizard as a flat route).
 * The `partner_mode=client` query param is read by BrandCreationFlow itself via
 * `useLocalSearchParams` — the route does NOT need to read or forward it. The
 * flow renders its own header + `canvas.discover` host, so this wrapper only
 * supplies the top safe-area inset (matching `app/brand/[id]/index.tsx`) and
 * pops the route on complete/cancel (mirroring the BrandSwitcherSheet
 * `onComplete={() => onClose()}` semantics).
 */

import React, { useCallback } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandCreationFlow } from "../../src/components/brand/BrandCreationFlow";
import { canvas } from "../../src/constants/designSystem";

export default function BrandNewRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Leave the wizard (pop this route) when the flow completes — client-mode
  // step 5 relies on this to exit after the invite; self-mode's own
  // `router.push(offeringRoute)` runs after and resolves with `/brand/new`
  // already popped, matching the sheet mount's net UX.
  const handleComplete = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleCancel = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  return (
    <View
      style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}
    >
      <BrandCreationFlow onComplete={handleComplete} onCancel={handleCancel} />
    </View>
  );
}
