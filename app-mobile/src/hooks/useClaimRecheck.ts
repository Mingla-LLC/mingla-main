import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  runClaimSweep,
  subscribeToClaimSweepResults,
  type ClaimRecheckReason,
  type ClaimSweepResult,
} from "../services/claimSweep";

type UseClaimRecheckOptions = {
  userId: string | null | undefined;
  onboardingActive?: boolean;
  monitor?: boolean;
};

export function useClaimRecheck({
  userId,
  onboardingActive = false,
  monitor = true,
}: UseClaimRecheckOptions): {
  recheck: (reason: ClaimRecheckReason, showBanner?: boolean) => Promise<ClaimSweepResult | null>;
  bannerResult: ClaimSweepResult | null;
  dismissBanner: () => void;
} {
  const [bannerResult, setBannerResult] = useState<ClaimSweepResult | null>(null);
  const sweptForUserRef = useRef<string | null>(null);
  const liveUserIdRef = useRef(userId ?? null);
  const onboardingRef = useRef(onboardingActive);
  liveUserIdRef.current = userId ?? null;
  onboardingRef.current = onboardingActive;

  const recheck = useCallback(async (
    reason: ClaimRecheckReason,
    showBanner = !onboardingRef.current,
  ): Promise<ClaimSweepResult | null> => {
    const currentUserId = liveUserIdRef.current;
    if (!currentUserId) return null;
    return runClaimSweep(currentUserId, reason, { showBanner });
  }, []);

  useEffect(() => subscribeToClaimSweepResults(setBannerResult), []);

  useEffect(() => {
    if (!monitor) return;
    const currentUserId = userId ?? null;
    if (!currentUserId) {
      sweptForUserRef.current = null;
      return;
    }
    if (sweptForUserRef.current === currentUserId) return;
    sweptForUserRef.current = currentUserId;
    void runClaimSweep(currentUserId, "sign_in", {
      showBanner: !onboardingActive,
    });
  }, [monitor, onboardingActive, userId]);

  useEffect(() => {
    if (!monitor) return;
    const subscription = AppState.addEventListener("change", (state) => {
      const currentUserId = liveUserIdRef.current;
      if (state !== "active" || !currentUserId || onboardingRef.current) return;
      void runClaimSweep(currentUserId, "foreground");
    });
    return () => subscription.remove();
  }, [monitor]);

  const dismissBanner = useCallback(() => setBannerResult(null), []);

  return { recheck, bannerResult, dismissBanner };
}
