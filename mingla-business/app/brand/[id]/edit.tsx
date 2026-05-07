/**
 * /brand/[id]/edit — founder-facing brand edit form (J-A8).
 *
 * Reads the dynamic `id` segment, resolves the brand from `useBrandList()`,
 * and renders BrandEditView. When `id` doesn't match any brand in the list,
 * BrandEditView's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * DO NOT add normalization logic; the find() handles all ID shapes
 * (stub `lm`, user-created `b_<ts36>`, future UUIDs).
 *
 * Host-bg cascade per Cycle 2 invariant I-12.
 * Routes outside (tabs)/ do not inherit canvas.discover from the tabs
 * layout — each non-tab route MUST set it on the host View.
 * Established after D-IMPL-A7-6 regression on /brand/[id]/.
 *
 * Per spec §3.3.
 */

import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../../src/components/brand/BrandDeleteSheet";
import { BrandEditView } from "../../../src/components/brand/BrandEditView";
import { canvas } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";
import { useUpdateBrand } from "../../../src/hooks/useBrands";
import { joinBrandDescription } from "../../../src/services/brandMapping";
import { computeDirtyFieldsPatch } from "../../../src/utils/brandPatch";

export default function BrandEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const updateBrandMutation = useUpdateBrand();
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

  const handleSave = async (next: Brand): Promise<void> => {
    // Cycle 17e-A: Server state via React Query — useUpdateBrand mutation
    // owns persistence + cache invalidation. Replaces phone-only setBrands.
    if (brand === null) return; // shouldn't happen — BrandEditView's not-found state guards
    if (user === null || user.id === undefined) return;
    const patch = computeDirtyFieldsPatch(next, brand);
    if (Object.keys(patch).length === 0) return; // no-op
    try {
      // Cycle 2 / ORCH-0742: useUpdateBrand.onSuccess writes the fresh Brand
      // back into the React Query detail + list caches. useCurrentBrand()
      // (the wrapper hook) re-renders with the new fields automatically —
      // no Zustand mirror-write needed.
      await updateBrandMutation.mutateAsync({
        brandId: next.id,
        patch,
        existingDescription: joinBrandDescription(brand.tagline, brand.bio),
        accountId: user.id,
      });
    } catch (error) {
      // Caller (BrandEditView) handles toast surfacing per error contract;
      // re-throw so its handleSave catches.
      throw error;
    }
  };

  // Cycle 17e-A — BrandDeleteSheet wiring
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const handleRequestDelete = useCallback((_b: Brand): void => {
    setDeleteSheetVisible(true);
  }, []);
  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
  }, []);
  const handleBrandDeleted = useCallback(
    (deletedBrandId: string): void => {
      const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
      if (currentBrandId === deletedBrandId) {
        setCurrentBrand(null);
      }
      setDeleteSheetVisible(false);
      router.replace("/(tabs)/account" as never);
    },
    [router, setCurrentBrand],
  );

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandEditView
        brand={brand}
        onCancel={handleBack}
        onSave={handleSave}
        onAfterSave={handleBack}
        onRequestDelete={handleRequestDelete}
      />
      <BrandDeleteSheet
        visible={deleteSheetVisible}
        brand={brand}
        accountId={user?.id ?? null}
        onClose={handleCloseDeleteSheet}
        onDeleted={handleBrandDeleted}
      />
    </View>
  );
}
