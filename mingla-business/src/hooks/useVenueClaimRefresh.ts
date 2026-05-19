/**
 * Ve3 — refresh brand claim_status when app returns to foreground.
 */

import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandKeys } from "./useBrands";
import { useCurrentBrandStore } from "../store/currentBrandStore";

export function useVenueClaimRefresh(): void {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next !== "active") return;
        if (user?.id) {
          void queryClient.invalidateQueries({
            queryKey: brandKeys.list(user.id),
          });
        }
        if (currentBrandId) {
          void queryClient.invalidateQueries({
            queryKey: brandKeys.detail(currentBrandId),
          });
        }
      },
    );
    return () => sub.remove();
  }, [queryClient, user?.id, currentBrandId]);
}
