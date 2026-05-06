/**
 * /brand/[id]/payments/onboard — Stripe Connect embedded onboarding (B2 / issue #47).
 *
 * Live brands (UUID ids): loads `brand-stripe-connect-session`, renders Connect.js in WebView.
 * Stub brands (dev ids): falls back to BrandOnboardView simulated flow.
 */

import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BrandOnboardView,
  type BrandOnboardSession,
} from "../../../../src/components/brand/BrandOnboardView";
import { canvas } from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { brandKeys } from "../../../../src/hooks/useBrands";
import { brandPaymentKeys } from "../../../../src/hooks/useBrandPayments";
import { getBrand } from "../../../../src/services/brandsService";
import { supabase } from "../../../../src/services/supabase";
import {
  useBrandList,
  useCurrentBrandStore,
} from "../../../../src/store/currentBrandStore";
import { BRAND_ID_UUID_RE } from "../../../../src/utils/stripeConnectStatus";

export default function BrandOnboardRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const [embeddedSession, setEmbeddedSession] = useState<BrandOnboardSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionNonce, setSessionNonce] = useState(0);

  const isLiveBrand = brand !== null && BRAND_ID_UUID_RE.test(brand.id);

  useEffect(() => {
    if (brand === null || !isLiveBrand) {
      setEmbeddedSession(null);
      setSessionLoading(false);
      setSessionError(null);
      return;
    }

    let cancelled = false;
    setSessionLoading(true);
    setSessionError(null);
    setEmbeddedSession(null);

    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "brand-stripe-connect-session",
          { body: { brandId: brand.id } },
        );
        if (cancelled) return;
        if (error !== null) {
          setSessionError(error.message);
          return;
        }
        const d = data as { clientSecret?: string; publishableKey?: string } | null;
        if (
          d !== null &&
          typeof d.clientSecret === "string" &&
          d.clientSecret.length > 0 &&
          typeof d.publishableKey === "string" &&
          d.publishableKey.length > 0
        ) {
          setEmbeddedSession({
            clientSecret: d.clientSecret,
            publishableKey: d.publishableKey,
          });
        } else {
          setSessionError("Invalid response from server");
        }
      } catch (e) {
        if (!cancelled) {
          setSessionError(e instanceof Error ? e.message : "Request failed");
        }
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brand, isLiveBrand, sessionNonce]);

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (brand !== null) {
      router.replace(`/brand/${brand.id}/payments` as never);
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleAfterDone = async (): Promise<void> => {
    if (brand === null || user === null || user.id === undefined) {
      handleBack();
      return;
    }

    if (isLiveBrand) {
      try {
        const { error } = await supabase.functions.invoke("brand-stripe-refresh-status", {
          body: { brandId: brand.id },
        });
        if (error !== null && __DEV__) {
          console.error("[BrandOnboardRoute] refresh-status:", error.message);
        }
      } catch (e) {
        if (__DEV__) {
          console.error("[BrandOnboardRoute] refresh-status:", e);
        }
      }

      await queryClient.invalidateQueries({ queryKey: brandKeys.detail(brand.id) });
      await queryClient.invalidateQueries({ queryKey: brandKeys.list(user.id) });
      await queryClient.invalidateQueries({ queryKey: brandPaymentKeys.all });

      const fresh = await getBrand(brand.id);
      if (
        fresh !== null &&
        currentBrand !== null &&
        currentBrand.id === fresh.id
      ) {
        setCurrentBrand({ ...fresh, role: currentBrand.role });
      }
    }

    handleBack();
  };

  const onRetrySession = useCallback((): void => {
    setSessionNonce((n) => n + 1);
  }, []);

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover,
      }}
    >
      <BrandOnboardView
        brand={brand}
        onCancel={handleBack}
        onAfterDone={handleAfterDone}
        embeddedSession={isLiveBrand ? embeddedSession : null}
        sessionLoading={isLiveBrand && sessionLoading}
        sessionError={isLiveBrand ? sessionError : null}
        onRetrySession={isLiveBrand ? onRetrySession : undefined}
      />
    </View>
  );
}
