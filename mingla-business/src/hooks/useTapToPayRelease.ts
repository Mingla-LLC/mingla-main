/**
 * #4271 — the release gate as one value: may this phone show Tap to Pay for this
 * brand right now?
 *
 *   iPhone:  entitled binary (Info.plist) AND the server's `iphone` answer.
 *   Android: the server's `android` answer.
 *
 * Loading, an error, web or no brand all read as not live, so a surface can
 * only ever appear late, never flash and vanish. A binary without the
 * entitlement never asks the server at all. __DEV__ does not bypass this.
 */
import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";

import { useAuth } from "../context/AuthContext";
import { isTapToPayIphoneEntitled } from "../services/terminal/howToTap";
import { supabase } from "../services/supabase";

export interface TapToPayReleaseAnswer {
  iphone: boolean;
  android: boolean;
}

export const tapToPayReleaseKeys = {
  all: ["tap-to-pay-release"] as const,
  byBrand: (brandId: string) => [...tapToPayReleaseKeys.all, brandId] as const,
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Pure: the single "live" decision every Tap to Pay surface reads. */
export const tapToPayLive = (
  os: string,
  entitled: boolean,
  answer: TapToPayReleaseAnswer | null | undefined,
): boolean => {
  if (os === "ios") return entitled && answer?.iphone === true;
  if (os === "android") return answer?.android === true;
  return false;
};

export const fetchTapToPayRelease = async (brandId: string): Promise<TapToPayReleaseAnswer> => {
  const { data, error } = await supabase.rpc("biz_tap_to_pay_release", { p_brand_id: brandId });
  if (error) throw error;
  const answer = data as Partial<TapToPayReleaseAnswer> | null;
  return { iphone: answer?.iphone === true, android: answer?.android === true };
};

export const useTapToPayRelease = (brandId: string | null): { live: boolean } => {
  const { isAuthReady } = useAuth();
  const os = Platform.OS;
  const entitled = isTapToPayIphoneEntitled();
  const query = useQuery({
    queryKey: tapToPayReleaseKeys.byBrand(brandId ?? ""),
    queryFn: () => fetchTapToPayRelease(brandId as string),
    enabled:
      isAuthReady &&
      brandId !== null &&
      brandId.length > 0 &&
      (os === "android" || (os === "ios" && entitled)),
    staleTime: FIVE_MINUTES_MS,
  });
  return { live: tapToPayLive(os, entitled, query.isError ? null : query.data) };
};
