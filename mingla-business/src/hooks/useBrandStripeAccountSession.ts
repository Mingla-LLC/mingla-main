/**
 * useBrandStripeAccountSession — creates short-lived embedded Connect sessions.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import {
  type BrandStripeAccountSessionResult,
  type BrandStripeAccountSessionSurface,
  fetchBrandStripeAccountSession,
} from "../services/brandStripeAccountSessionService";

export interface UseBrandStripeAccountSessionInput {
  brandId: string;
  surface: BrandStripeAccountSessionSurface;
}

export const useBrandStripeAccountSession = (): UseMutationResult<
  BrandStripeAccountSessionResult,
  Error,
  UseBrandStripeAccountSessionInput
> => {
  return useMutation<
    BrandStripeAccountSessionResult,
    Error,
    UseBrandStripeAccountSessionInput
  >({
    mutationFn: async ({ brandId, surface }) =>
      fetchBrandStripeAccountSession(brandId, surface),
    onError: (error, { brandId, surface }) => {
      console.error("[useBrandStripeAccountSession] failed", {
        message: error.message,
        brandId,
        surface,
      });
    },
  });
};
