/**
 * /brand/[id]/ — founder view of a brand profile (J-A7).
 *
 * Reads the dynamic `id` segment, resolves the brand from `useBrandList()`,
 * and renders BrandProfileView. When `id` doesn't match any brand in the
 * list, BrandProfileView's not-found state takes over.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * DO NOT add normalization logic; the find() handles all ID shapes
 * (stub `lm`, user-created `b_<ts36>`, future UUIDs).
 *
 * Per spec §3.3.
 */

import React, { useCallback, useState } from "react";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../../src/components/brand/BrandDeleteSheet";
import { BrandProfileView } from "../../../src/components/brand/BrandProfileView";
import { canvas } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";

export default function BrandProfileRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  // Cycle 17e-A — BrandDeleteSheet state
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const handleRequestDelete = useCallback((_brand: Brand): void => {
    setDeleteSheetVisible(true);
  }, []);
  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
  }, []);
  const handleBrandDeleted = useCallback(
    (deletedBrandId: string): void => {
      const current = useCurrentBrandStore.getState().currentBrand;
      if (current !== null && current.id === deletedBrandId) {
        setCurrentBrand(null);
      }
      setDeleteSheetVisible(false);
      router.replace("/(tabs)/account" as never);
    },
    [router, setCurrentBrand],
  );

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleOpenEdit = (brandId: string): void => {
    router.push(`/brand/${brandId}/edit` as never);
  };

  const handleOpenTeam = (brandId: string): void => {
    router.push(`/brand/${brandId}/team` as never);
  };

  // Both Stripe banner tap AND Operations row tap go to the dashboard.
  // Banner taps INSIDE the dashboard handle onboarding routing — this
  // avoids deep-linking straight to onboarding without context.
  const handleOpenStripe = (brandId: string): void => {
    router.push(`/brand/${brandId}/payments` as never);
  };

  const handleOpenPayments = (brandId: string): void => {
    router.push(`/brand/${brandId}/payments` as never);
  };

  const handleOpenReports = (brandId: string): void => {
    router.push(`/brand/${brandId}/payments/reports` as never);
  };

  // Cycle 13a (SPEC §4.14): brand-admin+ menu row → audit log viewer.
  const handleOpenAuditLog = (brandId: string): void => {
    router.push(`/brand/${brandId}/audit-log` as never);
  };

  // Cycle 7 FX1 — retired BrandProfileView TRANSITIONAL Toasts.
  const handleViewPublic = (brandSlug: string): void => {
    router.push(`/b/${brandSlug}` as never);
  };

  const handleCreateEvent = (): void => {
    router.push("/event/create" as never);
  };

  const handleOpenLink = (url: string): void => {
    // Linking.openURL is async + user-cancellable. We swallow rejections
    // because there's no useful surface — most failures (no app installed,
    // malformed URL) are best handled by native dialogs that fire from
    // openURL itself before resolving.
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <BrandProfileView
        brand={brand}
        onBack={handleBack}
        onEdit={handleOpenEdit}
        onTeam={handleOpenTeam}
        onStripe={handleOpenStripe}
        onPayments={handleOpenPayments}
        onReports={handleOpenReports}
        onAuditLog={handleOpenAuditLog}
        onViewPublic={handleViewPublic}
        onCreateEvent={handleCreateEvent}
        onOpenLink={handleOpenLink}
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
