/**
 * useMinglaToSAcceptance — query + mutation pair for the Mingla Business
 * platform ToS acceptance gate.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-U.
 *
 * Query: state per (brandId, userId). `staleTime: Infinity` because acceptance
 * is one-way (once accepted, only operator-side reset can null it back) and
 * version-bumps are coordinated by orchestrator deploys.
 *
 * Mutation: invalidates the query on success.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  acceptMinglaToS,
  fetchMinglaToSAcceptance,
  type AcceptMinglaToSResult,
  type MinglaToSAcceptanceState,
} from "../services/brandMinglaToSService";

export const minglaToSAcceptanceKeys = {
  all: ["mingla-tos-acceptance"] as const,
  detail: (
    brandId: string,
    userId: string,
  ): readonly ["mingla-tos-acceptance", string, string] =>
    [...minglaToSAcceptanceKeys.all, brandId, userId] as const,
};

const DISABLED_KEY = ["mingla-tos-acceptance-disabled"] as const;

export function useMinglaToSAcceptance(
  brandId: string | null,
  userId: string | null,
): UseQueryResult<MinglaToSAcceptanceState> {
  const enabled = brandId !== null && userId !== null;

  return useQuery<MinglaToSAcceptanceState>({
    queryKey: enabled
      ? minglaToSAcceptanceKeys.detail(brandId, userId)
      : DISABLED_KEY,
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<MinglaToSAcceptanceState> => {
      if (brandId === null || userId === null) {
        throw new Error("useMinglaToSAcceptance: enabled but ids null");
      }
      return fetchMinglaToSAcceptance(brandId, userId);
    },
  });
}

export interface UseAcceptMinglaToSInput {
  brandId: string;
  userId: string;
  version: string;
}

export function useAcceptMinglaToS(): UseMutationResult<
  AcceptMinglaToSResult,
  Error,
  UseAcceptMinglaToSInput
> {
  const queryClient = useQueryClient();
  return useMutation<AcceptMinglaToSResult, Error, UseAcceptMinglaToSInput>({
    mutationFn: async ({ brandId, version }) =>
      acceptMinglaToS(brandId, version),
    onSuccess: (_data, { brandId, userId }) => {
      queryClient.invalidateQueries({
        queryKey: minglaToSAcceptanceKeys.detail(brandId, userId),
      });
    },
    onError: (error, { brandId, userId }) => {
      // eslint-disable-next-line no-console
      console.error("[useAcceptMinglaToS] failed", {
        message: error.message,
        brandId,
        userId,
      });
    },
  });
}

/**
 * The current Mingla Business platform ToS version the gate enforces.
 * Operator/legal swaps the placeholder copy and bumps this version when ToS
 * materially changes (forces re-acceptance). Sub-A migration grandfathered
 * existing rows with `pre-v3-grandfathered` — bumping to a real version
 * here will require a coordinated UI nudge for grandfathered users to re-accept.
 *
 * [TRANSITIONAL] placeholder version — exit when legal signs off the V3 ToS
 * copy and operator bumps to the live version (e.g., "v1.0.0").
 */
export const CURRENT_MINGLA_TOS_VERSION = "v3-pre-launch-placeholder" as const;
