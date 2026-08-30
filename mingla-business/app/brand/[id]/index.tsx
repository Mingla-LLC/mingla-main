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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../../src/components/brand/BrandDeleteSheet";
import { BrandProfileView } from "../../../src/components/brand/BrandProfileView";
import { canvas } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useBrandStripeStatus } from "../../../src/hooks/useBrandStripeStatus";
import { useBrand } from "../../../src/hooks/useBrands";
import {
  BRAND_RESOLVE_AUTH_CEILING_MS,
  isBrandRouteResolving,
} from "../../../src/utils/coldLoadAuthGates";
import { routeForEventRowDefensive } from "../../../src/utils/routeForEventRow";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";
import { getEffectiveBrandStripeStatus } from "../../../src/utils/stripeOnboardingOutcome";

export default function BrandProfileRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthReady } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;

  // ORCH-1100 Wave 3 — cold-direct-load auth-readiness flash fix.
  // On a refresh/bookmark of /brand/{id} the session is still warming and the
  // brand query has not fetched, so `brand` is null for a beat. Treat that
  // window as RESOLVING so BrandProfileView shows a spinner instead of flashing
  // "Brand not found". Once auth is ready AND the query has settled (fetched,
  // not fetching), a still-null brand is a genuine not-found. A valid `brandId`
  // is required — a missing id segment is an immediate not-found, not loading.
  //
  // ORCH-1292 (Apple 2.1a) — feed a LIVE wall-clock elapsed-since-mount so the
  // `!isAuthReady` warm-window term is TIME-BOUNDED: if auth never becomes ready
  // (Apple's throttled review network) a brand read that has already settled to
  // null can no longer spin forever. The wakeup timer below forces one re-render
  // at the ceiling so this render-time bound actually flips to not-found.
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
  // Wakeup for a QUIET stall (no other re-render before the ceiling): if we are
  // still spinning on the auth-warm window, force a single re-render just past
  // the ceiling so the render-time bound above re-evaluates and can degrade a
  // settled-null brand to the not-found UI. Cleared once no longer resolving.
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
  const stripeStatusQuery = useBrandStripeStatus(brandId);
  const effectiveStripeStatus = getEffectiveBrandStripeStatus({
    liveStatus: stripeStatusQuery.data?.status,
    cachedStatus: brand?.stripeStatus,
  });

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
      const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
      if (currentBrandId === deletedBrandId) {
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

  // ORCH-1006 — Surface 2: brand-level all-in pricing defaults.
  const handleOpenPricingDefaults = (brandId: string): void => {
    router.push(`/brand/${brandId}/pricing-defaults` as never);
  };

  // Cycle 13a (SPEC §4.14): brand-admin+ menu row → audit log viewer.
  const handleOpenAuditLog = (brandId: string): void => {
    router.push(`/brand/${brandId}/audit-log` as never);
  };

  // #2830 — route-lazy Website workspace. No editor/server dependency enters
  // this profile bundle; the route imports its own Sites modules on navigation.
  const handleOpenWebsite = (brandId: string): void => {
    router.push(`/brand/${brandId}/website` as never);
  };

  // ORCH-0815-A2-ui (DEC-149): "Blasts" Operations row → brand-rollup
  // buyer list with "Blast these N customers →" CTA pre-filling the
  // marketing composer audience (composer ships in sub-ORCH-B).
  // Renamed "Customers" → "Blasts" + route `/customers` → `/blasts`
  // 2026-05-12 for consistency with the bottom-nav "Blast" tab.
  const handleOpenBlasts = (brandId: string): void => {
    router.push(`/brand/${brandId}/blasts` as never);
  };

  // Cycle 7 FX1 — retired BrandProfileView TRANSITIONAL Toasts.
  const handleViewPublic = (brandSlug: string): void => {
    router.push(`/b/${brandSlug}` as never);
  };

  // ORCH-1145 — the "Venue listing" Operations row + its onListing handler were
  // removed; venue listing now lives in the Hub "Venue" tab. The
  // /brand/{id}/listing route survives as a thin redirect (kept for to-do rows,
  // push deep-links, and global search).

  const handleCreateEvent = (): void => {
    router.push("/event/create" as never);
  };

  // ORCH-1121 — Recent-Events row tap. Routes through the canonical
  // routeForEventRowDefensive helper (NEVER a hardcoded `/event/${id}` —
  // strict-grep `route-by-event-type` bans that outside the helper). The
  // helper dispatches by event_type: event → /event/{id}, experience →
  // /experience/{id}. Status drives draft-vs-live; Recent Events surfaces
  // published rows only, so the non-edit destination is the norm.
  const handleOpenEvent = (
    eventId: string,
    eventType?: string,
    status?: string,
  ): void => {
    const route = routeForEventRowDefensive({
      id: eventId,
      eventType,
      status,
    });
    router.push(route as never);
  };

  // ORCH-1121 — "See all" header link → the canonical owner events list (the
  // Hub events tab), matching app/(tabs)/home.tsx's existing navigation.
  const handleSeeAllEvents = (): void => {
    router.push("/(tabs)/hub/events" as never);
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
        isResolving={isBrandResolving}
        isError={brandQuery.isError}
        onRetry={() => {
          void brandQuery.refetch();
        }}
        effectiveStripeStatus={effectiveStripeStatus}
        onBack={handleBack}
        onEdit={handleOpenEdit}
        onTeam={handleOpenTeam}
        onStripe={handleOpenStripe}
        onPayments={handleOpenPayments}
        onPricingDefaults={handleOpenPricingDefaults}
        onReports={handleOpenReports}
        onAuditLog={handleOpenAuditLog}
        onWebsite={handleOpenWebsite}
        onBlasts={handleOpenBlasts}
        onViewPublic={handleViewPublic}
        onCreateEvent={handleCreateEvent}
        onOpenEvent={handleOpenEvent}
        onSeeAllEvents={handleSeeAllEvents}
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
