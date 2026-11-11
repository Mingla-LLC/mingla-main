/**
 * #4389 (decision S-11) — the native secure setup kill switch as one value.
 *
 *   iPhone / Android: the server's `iphone` / `android` answer from
 *   biz_native_connect_onboarding (default off).
 *
 * Loading, an error, web or no brand all read as OFF, so the host gets the
 * browser sheet unless the server has positively said "native". The only other
 * way on is `extra.nativeConnectDevForce`, which app.config.js writes for a
 * LOCAL build only and refuses for every EAS build.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  nativeConnectFlagLive,
  type NativeConnectReleaseAnswer,
} from "../components/stripe/nativeConnectOnboarding";

export const nativeConnectOnboardingKeys = {
  all: ["native-connect-onboarding"] as const,
  byBrand: (brandId: string) =>
    [...nativeConnectOnboardingKeys.all, brandId] as const,
};

const ONE_MINUTE_MS = 60 * 1000;

export const fetchNativeConnectOnboardingRelease = async (
  brandId: string,
): Promise<NativeConnectReleaseAnswer> => {
  const { data, error } = await supabase.rpc("biz_native_connect_onboarding", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  const answer = data as Partial<NativeConnectReleaseAnswer> | null;
  return { iphone: answer?.iphone === true, android: answer?.android === true };
};

/** The local dev override baked into this binary's config (never EAS). */
export const readNativeConnectDevForce = (
  extra: Record<string, unknown> | null | undefined,
): boolean => extra?.nativeConnectDevForce === true;

export const useNativeConnectOnboardingRelease = (
  brandId: string | null,
): { flagLive: boolean; devForce: boolean } => {
  const { isAuthReady } = useAuth();
  const os = Platform.OS;
  const query = useQuery({
    queryKey: nativeConnectOnboardingKeys.byBrand(brandId ?? ""),
    queryFn: () => fetchNativeConnectOnboardingRelease(brandId as string),
    enabled:
      isAuthReady &&
      brandId !== null &&
      brandId.length > 0 &&
      (os === "ios" || os === "android"),
    staleTime: ONE_MINUTE_MS,
  });
  useEffect(() => {
    if (!query.isError) return;
    console.warn(
      "[useNativeConnectOnboardingRelease] switch unread; using the browser sheet",
      query.error,
    );
  }, [query.isError, query.error]);
  return {
    flagLive: nativeConnectFlagLive(os, query.isError ? null : query.data),
    devForce: readNativeConnectDevForce(
      Constants.expoConfig?.extra as Record<string, unknown> | undefined,
    ),
  };
};
