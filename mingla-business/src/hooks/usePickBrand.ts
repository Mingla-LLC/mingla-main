/**
 * #4389 — shared by the brand switcher and Ari's held switch (R-16).
 */
import { useCallback } from "react";

import { useAuth } from "../context/AuthContext";
import { useCurrentBrandStore, type Brand } from "../store/currentBrandStore";
import { useUpdateCreatorAccount } from "./useCreatorAccount";

/**
 * #4389 — the one way to make a brand current from a switcher: select it now
 * and save it as the default brand in the background.
 */
export function usePickBrand(
  onDefaultBrandSaveError?: (message: string) => void,
): (brand: Brand) => void {
  const { user } = useAuth();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const updateCreatorAccountMutation = useUpdateCreatorAccount();
  const { mutateAsync } = updateCreatorAccountMutation;
  return useCallback(
    (brand: Brand): void => {
      setCurrentBrand(brand);
      if (user === null) return;
      void mutateAsync({ default_brand_id: brand.id }).catch(() => {
        onDefaultBrandSaveError?.(
          "Brand selected for now. Couldn't save it as your default.",
        );
      });
    },
    [mutateAsync, onDefaultBrandSaveError, setCurrentBrand, user],
  );
}

