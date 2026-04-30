/**
 * /brand/[id]/team/[memberId] — member detail (J-A9 §5.3.11).
 *
 * Resolves brand + member from nested dynamic segments. When either is
 * missing or doesn't match, BrandMemberDetailView's not-found state takes
 * over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11 — same pattern as
 * J-A7/J-A8 routes, extended to nested segments. DO NOT add normalization
 * logic; the find() handles all ID shapes for both `id` and `memberId`.
 *
 * Host-bg cascade per Cycle 2 invariant I-12.
 *
 * isCurrentUserSelf is a [TRANSITIONAL] heuristic for J-A9 — replaced when
 * B1 wires `auth.users.id` comparison to `member.userId`. Until then: any
 * member with `role === 'owner'` is treated as the current user (founder
 * owns all 4 stub brands).
 *
 * Save handlers:
 *   - onChangeRole → store update; stay on screen (refreshed state shows new role)
 *   - onRemove → store update; router.back() (member is gone)
 *
 * Per spec §3.4.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMemberDetailView } from "../../../../src/components/brand/BrandMemberDetailView";
import { canvas } from "../../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
  type BrandMemberRole,
} from "../../../../src/store/currentBrandStore";

export default function BrandMemberDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    memberId: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const memberIdParam = Array.isArray(params.memberId)
    ? params.memberId[0]
    : params.memberId;

  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);

  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const member =
    brand !== null &&
    typeof memberIdParam === "string" &&
    memberIdParam.length > 0
      ? (brand.members ?? []).find((m) => m.id === memberIdParam) ?? null
      : null;

  // [TRANSITIONAL] isCurrentUserSelf heuristic — replaced at B1 when
  // `auth.users.id` is compared to `member.userId`. Founder owns all 4
  // stub brands, so any member with role 'owner' is treated as the
  // current user. When B1 lands, replace with: isCurrentUserSelf =
  // (member?.userId === currentSession.user.id).
  const isCurrentUserSelf = member?.role === "owner";

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (brand !== null) {
      router.replace(`/brand/${brand.id}/team` as never);
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

  const handleChangeRole = (
    memberId: string,
    nextRole: BrandMemberRole,
  ): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      members: (brand.members ?? []).map((m) =>
        m.id === memberId ? { ...m, role: nextRole } : m,
      ),
    };
    persistBrand(next);
  };

  const handleRemove = (memberId: string): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      members: (brand.members ?? []).filter((m) => m.id !== memberId),
    };
    persistBrand(next);
    // Member is gone — return to team list.
    handleBack();
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandMemberDetailView
        brand={brand}
        member={member}
        isCurrentUserSelf={isCurrentUserSelf}
        onBack={handleBack}
        onChangeRole={handleChangeRole}
        onRemove={handleRemove}
      />
    </View>
  );
}
