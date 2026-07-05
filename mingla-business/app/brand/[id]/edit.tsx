/**
 * /brand/[id]/edit — founder-facing brand edit form (J-A8).
 *
 * Reads the dynamic `id` segment, FETCHES the brand via `useBrand(id)`, and
 * renders BrandEditView. ORCH-1309: this used to `useBrandList().find(id)` from
 * the in-memory store, which is EMPTY on a cold deep-link/refresh — so every
 * direct load flashed "Brand not found". Now it fetches by id and shows a
 * spinner during the cold-load resolving window (isBrandRouteResolving, mirrors
 * the /brand/[id] hub); a genuinely-missing brand still shows not-found.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * DO NOT add normalization logic; useBrand(id) handles all ID shapes
 * (stub `lm`, user-created `b_<ts36>`, future UUIDs).
 *
 * Host-bg cascade per Cycle 2 invariant I-12.
 * Routes outside (tabs)/ do not inherit canvas.discover from the tabs
 * layout — each non-tab route MUST set it on the host View.
 * Established after D-IMPL-A7-6 regression on /brand/[id]/.
 *
 * Per spec §3.3.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../../src/components/brand/BrandDeleteSheet";
import {
  BrandEditView,
  type BrandEditSection,
} from "../../../src/components/brand/BrandEditView";
import { canvas } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";
import { useBrand, useUpdateBrand } from "../../../src/hooks/useBrands";
import {
  BRAND_RESOLVE_AUTH_CEILING_MS,
  isBrandRouteResolving,
} from "../../../src/utils/coldLoadAuthGates";
import { joinBrandDescription } from "../../../src/services/brandMapping";
import { computeDirtyFieldsPatch } from "../../../src/utils/brandPatch";

// ORCH-1256 — validate the `?section=` deep-link param against the closed
// BrandEditSection set. Anything else (bogus values, casing drift) →
// undefined: the page renders normally at the top, no crash, no scroll.
const isBrandEditSection = (
  value: string | undefined,
): value is BrandEditSection =>
  value === "photo" ||
  value === "about" ||
  value === "cover" ||
  value === "address" ||
  value === "contact" ||
  value === "social";

export default function BrandEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthReady } = useAuth();
  const params = useLocalSearchParams<{
    id: string | string[];
    section?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  // ORCH-1256 — normalize the array form (house pattern: listing.tsx focus
  // param), then validate against the closed section set.
  const sectionParam = Array.isArray(params.section)
    ? params.section[0]
    : params.section;
  const initialSection: BrandEditSection | undefined = isBrandEditSection(
    sectionParam,
  )
    ? sectionParam
    : undefined;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const updateBrandMutation = useUpdateBrand();
  // ORCH-1309 — resolve the brand by FETCHING it (useBrand), not by finding it
  // in the in-memory useBrandList(). On a cold deep-link / refresh / bookmark of
  // /brand/{id}/edit that list is EMPTY (it is only populated after the app warms
  // through home), so the old `brands.find(...)` returned null and the page
  // flashed "Brand not found" for every direct load. useBrand fetches by id.
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  // ORCH-1309 — cold-direct-load auth-readiness guard (mirrors the /brand/[id]
  // hub, ORCH-1100 Wave 3 + ORCH-1292). While the session is warming and the
  // single-brand query has not settled, treat a null brand as RESOLVING so the
  // view shows a spinner instead of the not-found empty state. Once auth is ready
  // AND the query has settled (fetched, not fetching), a still-null brand is a
  // genuine not-found. Time-bounded by BRAND_RESOLVE_AUTH_CEILING_MS so a warm
  // window that never becomes ready still degrades to not-found.
  const mountedAtRef = useRef<number>(Date.now());
  const [, forceResolveTick] = useState(0);
  const isBrandResolving = isBrandRouteResolving({
    hasBrandId: brandId !== null,
    brandIsNull: brand === null,
    isAuthReady,
    queryIsFetched: brandQuery.isFetched,
    queryIsLoading: brandQuery.isLoading,
    elapsedMs: Date.now() - mountedAtRef.current,
  });
  useEffect(() => {
    if (!isBrandResolving) return;
    const remaining =
      BRAND_RESOLVE_AUTH_CEILING_MS - (Date.now() - mountedAtRef.current);
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => forceResolveTick((n) => n + 1),
      remaining + 50,
    );
    return () => clearTimeout(timer);
  }, [isBrandResolving]);

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
        isResolving={isBrandResolving}
        accountId={user?.id ?? null}
        onCancel={handleBack}
        onSave={handleSave}
        onAfterSave={handleBack}
        onRequestDelete={handleRequestDelete}
        initialSection={initialSection}
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
