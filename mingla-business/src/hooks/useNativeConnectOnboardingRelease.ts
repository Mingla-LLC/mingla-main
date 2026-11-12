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

/**
 * The binary's `extra` config, read only on a phone and only when asked. A
 * module-scope `expo-constants` import breaks every render suite that mounts
 * the bank setup screen (expo-modules-core is not linked there); failing to
 * read it means no override, which is the safe answer.
 */
let extraReadFailed = false;
const nativeExtra = (os: string): Record<string, unknown> | undefined => {
  if ((os !== "ios" && os !== "android") || extraReadFailed) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constants = require("expo-constants") as {
      default?: { expoConfig?: { extra?: Record<string, unknown> } | null };
    };
    return constants.default?.expoConfig?.extra ?? undefined;
  } catch (error: unknown) {
    extraReadFailed = true;
    console.warn("[useNativeConnectOnboardingRelease] app config unread; no dev override", error);
    return undefined;
  }
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
    devForce: readNativeConnectDevForce(nativeExtra(os)),
  };
};
