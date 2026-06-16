/**
 * ORCH-0881 — pending menu-snap experience proposals for a brand.
 */

import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  confirmExperienceProposal,
  fetchPendingExperiencesForBrand,
  parseRestaurantMenu,
  rejectExperienceProposal,
  type HubPendingExperienceRow,
  parsePlayActivities,
  type ExperienceFilePayload,
  type ParseExperienceResponse,
} from "../services/experienceGenerationService";
import { useAuth } from "../context/AuthContext";
import { experienceKeys } from "./useExperiencesByBrand";
import { brandKeys } from "./useBrands";

export const pendingExperienceKeys = {
  all: ["pendingExperiences"] as const,
  byBrand: (brandId: string) => [...pendingExperienceKeys.all, brandId] as const,
};

export type ExperienceParseMode = "menu" | "activities";

export function usePendingExperiences(
  brandId: string | null,
  parseMode: ExperienceParseMode = "menu",
) {
  const qc = useQueryClient();
  // ORCH-1004 — pending proposals are RLS auth.uid()-scoped; gate on auth
  // readiness so a pre-auth fire can't cache an empty list as success.
  const { isAuthReady } = useAuth();

  const pendingQuery = useQuery<HubPendingExperienceRow[]>({
    queryKey: pendingExperienceKeys.byBrand(brandId ?? ""),
    queryFn: () => fetchPendingExperiencesForBrand(brandId!),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 10_000,
  });

  const parseMutation = useMutation({
    mutationFn: (files: ExperienceFilePayload[]) =>
      parseMode === "activities"
        ? parsePlayActivities({ brand_id: brandId!, files })
        : parseRestaurantMenu({ brand_id: brandId!, files }),
    onSuccess: (response) => {
      if (response.kind === "ok" && brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (args: { id: string; edited_args?: Record<string, unknown> }) =>
      confirmExperienceProposal(args.id, args.edited_args),
    onSuccess: () => {
      if (brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
        qc.invalidateQueries({ queryKey: experienceKeys.listByBrand(brandId) });
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectExperienceProposal(id),
    onSuccess: () => {
      if (brandId) {
        qc.invalidateQueries({ queryKey: pendingExperienceKeys.byBrand(brandId) });
      }
    },
  });

  const parseFiles = useCallback(
    async (files: ExperienceFilePayload[]): Promise<ParseExperienceResponse> =>
      parseMutation.mutateAsync(files),
    [parseMutation],
  );

  // ORCH-1150 — track the auto-draft-all loop so the snap route can render an
  // honest "Creating your experiences…" state distinct from a single confirm.
  const [isConfirmingAll, setIsConfirmingAll] = useState(false);

  /**
   * ORCH-1150 — auto-draft-all. Confirms an array of pending-proposal ids
   * SEQUENTIALLY through the existing, tested per-proposal confirm path
   * (`confirmMutation.mutateAsync` → `agent-confirm-action` → the shared
   * `create_experience` executor → one `status:"draft"` event). Each success
   * fires the existing onSuccess invalidation of both the pending list and
   * `experienceKeys.listByBrand`. Returns an honest tally; a `kind:"error"`
   * response, an `expired_regenerate` response (DISC-1150-2 — generic-message
   * failure, no regenerate CTA in this flow), or a thrown error all count as
   * `failed` (first failure's message captured as `firstError`). Server-side
   * idempotency (the atomic pending→executing flip) means a replayed id 409s
   * and is tallied as a failure, never a duplicate draft (SC-7).
   */
  const confirmAll = useCallback(
    async (
      ids: string[],
    ): Promise<{ created: number; failed: number; firstError: string | null }> => {
      let created = 0;
      let failed = 0;
      let firstError: string | null = null;
      setIsConfirmingAll(true);
      try {
        for (const id of ids) {
          try {
            const response = await confirmMutation.mutateAsync({ id });
            if (response.kind === "executed") {
              created += 1;
            } else if (response.kind === "error") {
              failed += 1;
              if (firstError === null) firstError = response.message;
            } else {
              // cancelled / expired_regenerate — not a created draft. Generic
              // message; no regenerate CTA in the auto-draft flow (DISC-1150-2).
              failed += 1;
              if (firstError === null) {
                firstError = "Some experiences couldn't be created.";
              }
            }
          } catch (e) {
            failed += 1;
            if (firstError === null) {
              firstError =
                e instanceof Error ? e.message : "Some experiences couldn't be created.";
            }
          }
        }
      } finally {
        setIsConfirmingAll(false);
      }
      return { created, failed, firstError };
    },
    [confirmMutation],
  );

  // ORCH-1150 §4.6 — belt-and-braces invalidation the snap route awaits BEFORE
  // navigating to the drafts tab, so the destination refetches and the new
  // drafts are present on arrival (the per-item invalidations may be deduped /
  // still in-flight).
  const invalidateExperienceList = useCallback(
    async (): Promise<void> => {
      if (brandId) {
        await qc.invalidateQueries({ queryKey: experienceKeys.listByBrand(brandId) });
        // ORCH-1150 A.6 (DISC-1150-A) — also invalidate the offering-counts
        // query so the freshly-created drafts raise experiences_draft and the
        // Hub "Experiences" tab is present ON ARRIVAL (not one navigation
        // later). snap.tsx already awaits this before router.replace, so by the
        // time the nav-lock effect evaluates visibleTabs the tab exists and the
        // redirect does NOT fire. Same key useDiscardOfferingDrafts invalidates.
        await qc.invalidateQueries({ queryKey: brandKeys.offeringCounts(brandId) });
      }
    },
    [qc, brandId],
  );

  return {
    pending: pendingQuery.data ?? [],
    isLoadingPending: pendingQuery.isLoading,
    parseFiles,
    /** @deprecated Use parseFiles */
    parseMenu: parseFiles,
    isParsing: parseMutation.isPending,
    confirm: confirmMutation.mutateAsync,
    confirmAll,
    invalidateExperienceList,
    reject: rejectMutation.mutateAsync,
    isConfirming: confirmMutation.isPending || rejectMutation.isPending,
    isConfirmingAll,
  };
}
