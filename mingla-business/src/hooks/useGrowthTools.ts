/**
 * Issue #1735 (umbrella #1734) — growth-tools hook family (G-4).
 *
 * `useIntelSubjectLatest` — the standing latest-read (P-43), keyed
 * `growthToolsKeys.subjectRead(...)`, `enabled` on the
 * `useVenueIntelligence.ts` idiom (`!loading && session !== null` +
 * DISABLED_KEY), staleTime 60s.
 * `useIntelRun` — the explicit-run mutation (G-7): mints a `client_ref` per
 * attempt, and on a SOCKET DROP (typed `network` failure after the request
 * left) falls back to the P-27 poll (≥5s interval, give up at the tool's
 * P-24 budget + 30s) instead of re-running — an identical re-run would spend
 * quota if the original died pre-insert, while the poll never can.
 * `useCompetitorWatch` / `useAddCompetitor` / `useRemoveCompetitor` — the
 * P-46 watch CRUD, invalidating the `watch` leaf.
 * `useInsightsNudgeInputs` — the G-15 per-venue fan-out feeding the to-do
 * band (2 reads/venue, staleTime 10 min, RQ-deduped with the module).
 *
 * State ownership (P-35, COMMS-0136): every result lives in the React Query
 * cache ONLY — never a persisted zustand store (CI gate
 * `issue-1734-tool-results-not-persisted.mjs`).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  GrowthToolsAppError,
  listCompetitors,
  mintClientRef,
  readRunByClientRef,
  removeCompetitor,
  runGrowthTool,
  addCompetitor,
  type CompetitorWatchRow,
  type CompetitorSourceInput,
  getCompetitorBrief,
  refreshCompetitor,
  updateCompetitor,
  type GrowthToolRunResult,
  type GrowthToolRunSubject,
} from "../services/growthToolsService";
import { growthToolsKeys, type GrowthToolName } from "./growthToolsKeys";

// Issue #1735 CI rework — the eager read slice lives in
// `useGrowthToolsReads.ts` (boot path; see its header). Re-exported here so
// the lazy side keeps one import surface.
export {
  useInsightsNudgeInputs,
  useIntelSubjectLatest,
} from "./useGrowthToolsReads";
export type {
  InsightsNudgeState,
  InsightsNudgeVenueInput,
} from "./useGrowthToolsReads";

const DISABLED_KEY = ["growth-tools-disabled"] as const;

/** P-24 per-run wall-clock budgets (ms) — the poll gives up at budget + 30s. */
const RUN_BUDGET_MS: Record<GrowthToolName, number> = {
  venues: 120_000,
  events: 100_000,
  trips: 130_000,
  experiences: 80_000,
};
const RESUME_POLL_INTERVAL_MS = 5_000;
const RESUME_GRACE_MS = 30_000;

// ── Explicit run (G-7 / P-27) ────────────────────────────────────────────────

export interface IntelRunVariables {
  tool: GrowthToolName;
  brandId: string;
  input: Record<string, unknown>;
  subject: GrowthToolRunSubject;
  /** When set, a successful run also invalidates this venue's watch leaf. */
  venueListingId?: string | null;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The P-27 resume poll after a socket drop. Only reachable when the run
 * request failed at the NETWORK layer (never on a typed engine error — those
 * are real answers). Give-up rethrows the original failure so the surface
 * shows the honest error state (G-5), never a fabricated partial (P-25).
 */
async function resumeByClientRef(
  tool: GrowthToolName,
  brandId: string,
  clientRef: string,
  original: GrowthToolsAppError,
): Promise<GrowthToolRunResult> {
  const deadline = Date.now() + RUN_BUDGET_MS[tool] + RESUME_GRACE_MS;
  while (Date.now() < deadline) {
    await delay(RESUME_POLL_INTERVAL_MS);
    let read;
    try {
      read = await readRunByClientRef(brandId, clientRef);
    } catch (pollError) {
      // Still offline / row not visible yet (404 while the insert races the
      // drop) — keep polling until the deadline; never swallow silently.
      console.error("[useGrowthTools] resume poll attempt failed", pollError);
      continue;
    }
    if (read.status === "report_ready") {
      return { runId: read.runId, report: read.report, cached: false };
    }
    if (read.status === "failed") {
      throw new GrowthToolsAppError("generation_failed", {
        reason: read.reason,
      });
    }
    // status "created" — still generating; keep polling.
  }
  throw original;
}

export function useIntelRun(): UseMutationResult<
  GrowthToolRunResult,
  GrowthToolsAppError,
  IntelRunVariables
> {
  const queryClient = useQueryClient();
  return useMutation<GrowthToolRunResult, GrowthToolsAppError, IntelRunVariables>({
    mutationFn: async (variables) => {
      const clientRef = mintClientRef();
      try {
        return await runGrowthTool(variables.tool, variables.brandId, variables.input, {
          clientRef,
          subject: variables.subject,
        });
      } catch (error) {
        if (error instanceof GrowthToolsAppError && error.code === "network") {
          // Socket drop — surfaced to the UI as the running state persisting
          // (the mutation stays pending through the poll), then result/error.
          return resumeByClientRef(
            variables.tool,
            variables.brandId,
            clientRef,
            error,
          );
        }
        throw error;
      }
    },
    onSuccess: (_result, variables) => {
      // G-4 — invalidate the subject leaf (prefix: hits both the `latest` and
      // `with-previous` reads) + the watch leaf (a competitor grade changes
      // the list row's `latest` badge).
      const subjectRef =
        `${variables.subject.type}:${variables.subject.id}` as const;
      void queryClient.invalidateQueries({
        queryKey: growthToolsKeys.subject(
          variables.brandId,
          variables.tool,
          subjectRef,
        ),
      });
      if (
        variables.venueListingId !== undefined &&
        variables.venueListingId !== null
      ) {
        void queryClient.invalidateQueries({
          queryKey: growthToolsKeys.watch(
            variables.brandId,
            variables.venueListingId,
          ),
        });
      }
    },
  });
}

// ── Competitor watch (G-9..G-13 / P-46) ──────────────────────────────────────

export function useCompetitorWatch(
  brandId: string | null,
  venueListingId: string | null,
): UseQueryResult<CompetitorWatchRow[]> {
  const { loading, session } = useAuth();
  const enabled = !loading &&
    session !== null &&
    brandId !== null &&
    brandId.length > 0 &&
    venueListingId !== null &&
    venueListingId.length > 0;
  return useQuery<CompetitorWatchRow[]>({
    queryKey: enabled && brandId !== null && venueListingId !== null
      ? growthToolsKeys.watch(brandId, venueListingId)
      : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.some((row) => row.activeJob != null) ? 15_000 : 5 * 60_000;
    },
    queryFn: async () => {
      if (brandId === null || venueListingId === null) {
        throw new Error("watch read disabled");
      }
      return listCompetitors(brandId, venueListingId);
    },
  });
}

export function useAddCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<
  CompetitorWatchRow,
  GrowthToolsAppError,
  { name: string; city: string; sources: CompetitorSourceInput[]; placePoolId?: string | null; competitorId?: string; expectedUpdatedAt?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competitor) => {
      if (brandId === null || venueListingId === null) {
        throw new GrowthToolsAppError("validation");
      }
      if (competitor.competitorId !== undefined) {
        if (competitor.expectedUpdatedAt === undefined) throw new GrowthToolsAppError("validation");
        return updateCompetitor(brandId, competitor.competitorId, competitor.expectedUpdatedAt, competitor);
      }
      return addCompetitor(brandId, venueListingId, competitor);
    },
    onSuccess: (row) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({
          queryKey: growthToolsKeys.watch(brandId, venueListingId),
        });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, row.id) });
      }
    },
  });
}

export function useUpdateCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<CompetitorWatchRow, GrowthToolsAppError, { competitorId: string; expectedUpdatedAt: string; name: string; city: string; sources: CompetitorSourceInput[] }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId, expectedUpdatedAt, name, city, sources }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return updateCompetitor(brandId, competitorId, expectedUpdatedAt, { name, city, sources });
    },
    onSuccess: (row) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.watch(brandId, venueListingId) });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, row.id) });
      }
    },
  });
}

export function useRefreshCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<"cached" | "joined" | "queued", GrowthToolsAppError, { competitorId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return refreshCompetitor(brandId, competitorId);
    },
    onSuccess: (_result, { competitorId }) => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.watch(brandId, venueListingId) });
        void queryClient.invalidateQueries({ queryKey: growthToolsKeys.brief(brandId, competitorId) });
      }
    },
  });
}

export function useCompetitorBrief(brandId: string | null, watchId: string | null, enabled = true) {
  const { loading, session } = useAuth();
  const active = enabled && !loading && session !== null && brandId !== null && watchId !== null;
  return useQuery({
    queryKey: active && brandId !== null && watchId !== null ? growthToolsKeys.brief(brandId, watchId) : DISABLED_KEY,
    enabled: active,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data as Awaited<ReturnType<typeof getCompetitorBrief>> | undefined;
      return data?.freshness === "refreshing" ? 15_000 : false;
    },
    queryFn: async () => {
      if (brandId === null || watchId === null) throw new Error("brief read disabled");
      return getCompetitorBrief(brandId, watchId);
    },
  });
}

export function useRemoveCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<void, GrowthToolsAppError, { competitorId: string; expectedUpdatedAt: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId, expectedUpdatedAt }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return removeCompetitor(brandId, competitorId, expectedUpdatedAt);
    },
    onSuccess: () => {
      if (brandId !== null && venueListingId !== null) {
        void queryClient.invalidateQueries({
          queryKey: growthToolsKeys.watch(brandId, venueListingId),
        });
      }
    },
  });
}
