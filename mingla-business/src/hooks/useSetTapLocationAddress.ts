/**
 * #4389 (T1) — save the Tap to Pay on iPhone location address. Only the
 * address route's chunk loads this module.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import type { TapLocationAddressInput } from "../services/brandSetupService";
import { invalidateBrand } from "./useBrandSetupChecklist";

export function useSetTapLocationAddress(
  brandId: string | null,
): UseMutationResult<void, Error, TapLocationAddressInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (address) => {
      if (brandId === null) throw new Error("useSetTapLocationAddress: no brand");
      const { setTapLocationAddress } = await import("../services/brandSetupService");
      await setTapLocationAddress(brandId, address);
    },
    onSettled: () => {
      if (brandId !== null) invalidateBrand(queryClient, brandId);
    },
  });
}
