/**
 * /brand/[id]/team — team list (J-A9 §5.3.9).
 *
 * Reads the dynamic `id` segment, resolves the brand from `useBrandList()`,
 * and renders BrandTeamView. When `id` doesn't match any brand, the view's
 * not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11. DO NOT add
 * normalization logic; the find() handles all ID shapes (stub `lm`,
 * user-created `b_<ts36>`, future UUIDs).
 *
 * Host-bg cascade per Cycle 2 invariant I-12. Routes outside (tabs)/ do
 * not inherit canvas.discover from the tabs layout — each non-tab route
 * MUST set it on the host View. Established after D-IMPL-A7-6 regression.
 *
 * Save handlers (onSendInvite, onCancelInvite) mutate the brand list +
 * mirror to currentBrand if active. Same pattern as J-A8 edit route.
 *
 * Per spec §3.3.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandTeamView } from "../../../../src/components/brand/BrandTeamView";
import { canvas } from "../../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
  type BrandInvitation,
} from "../../../../src/store/currentBrandStore";

export default function BrandTeamRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const persistBrand = (next: Brand): void => {
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
  };

  const handleSendInvite = (invitation: BrandInvitation): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      pendingInvitations: [...(brand.pendingInvitations ?? []), invitation],
    };
    persistBrand(next);
  };

  const handleCancelInvite = (invitationId: string): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      pendingInvitations: (brand.pendingInvitations ?? []).filter(
        (i) => i.id !== invitationId,
      ),
    };
    persistBrand(next);
  };

  const handleOpenMember = (memberId: string): void => {
    if (brand === null) return;
    router.push(`/brand/${brand.id}/team/${memberId}` as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandTeamView
        brand={brand}
        onBack={handleBack}
        onSendInvite={handleSendInvite}
        onCancelInvite={handleCancelInvite}
        onOpenMember={handleOpenMember}
      />
    </View>
  );
}
