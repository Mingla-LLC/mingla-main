/**
 * useMinglaToSAcceptance — query + mutation pair for the Mingla Host
 * Organiser Terms acceptance gate.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-U + #3645 PR11c.
 *
 * Query: state per (brandId, userId). `staleTime: Infinity` because acceptance
 * is one-way for a given version (operator bumps CURRENT_MINGLA_TOS_VERSION to
 * force re-acceptance).
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
import { useAuth } from "../context/AuthContext";

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
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && userId !== null;

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
 * Current Organiser Terms version the gate enforces.
 * MUST stay equal to `ORGANISER_TERMS_VERSION` in
 * `mingla-marketing/lib/organiserTermsContent.ts` (pinned by unit test).
 * Bump both together when legal ships a material update.
 */
export const CURRENT_MINGLA_TOS_VERSION = "1.0" as const;

/** Canonical public Organiser Terms URL (search-visible since #3743). */
export const ORGANISER_TERMS_URL =
  "https://usemingla.com/organiser-terms" as const;

/** True when the member has accepted the currently enforced version. */
export function isCurrentMinglaToSAccepted(
  state: MinglaToSAcceptanceState | null | undefined,
): boolean {
  if (state == null) return false;
  return (
    state.acceptedAt != null &&
    state.versionAccepted === CURRENT_MINGLA_TOS_VERSION
  );
}
