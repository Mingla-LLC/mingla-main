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
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "../context/AuthContext";
import { INSIGHT_INSTRUMENTS } from "../components/venue/insights/insightsInstruments";
import {
  GrowthToolsAppError,
  listCompetitors,
  mintClientRef,
  readLatestBySubject,
  readRunByClientRef,
  removeCompetitor,
  runGrowthTool,
  addCompetitor,
  type CompetitorWatchRow,
  type GrowthToolRunResult,
  type GrowthToolRunSubject,
  type SubjectLatestResult,
} from "../services/growthToolsService";
import {
  fetchBrandPlaceAuthoringContext,
} from "../services/businessPlaceAuthoringService";
import { brandPlacePipelineKeys } from "./useBrandPlacePipelineState";
import { growthToolsKeys, type GrowthToolName } from "./growthToolsKeys";

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

// ── Standing latest-read (G-4 / P-43) ────────────────────────────────────────

export function useIntelSubjectLatest(
  brandId: string | null,
  tool: GrowthToolName,
  subjectRef: string | null,
  options?: { includePrevious?: boolean; enabled?: boolean },
): UseQueryResult<SubjectLatestResult> {
  const { loading, session } = useAuth();
  const includePrevious = options?.includePrevious === true;
  const enabled = !loading &&
    session !== null &&
    brandId !== null &&
    brandId.length > 0 &&
    subjectRef !== null &&
    subjectRef.length > 0 &&
    (options?.enabled ?? true);

  return useQuery<SubjectLatestResult>({
    queryKey: enabled && brandId !== null && subjectRef !== null
      ? growthToolsKeys.subjectRead(brandId, tool, subjectRef, includePrevious)
      : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null || subjectRef === null) {
        throw new Error("subject read disabled");
      }
      return readLatestBySubject(brandId, tool, subjectRef, includePrevious);
    },
  });
}

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
  { name: string; city: string; website: string; placePoolId?: string | null }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competitor) => {
      if (brandId === null || venueListingId === null) {
        throw new GrowthToolsAppError("validation");
      }
      return addCompetitor(brandId, venueListingId, competitor);
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

export function useRemoveCompetitor(
  brandId: string | null,
  venueListingId: string | null,
): UseMutationResult<void, GrowthToolsAppError, { competitorId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ competitorId }) => {
      if (brandId === null) throw new GrowthToolsAppError("validation");
      return removeCompetitor(brandId, competitorId);
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

// ── To-do nudge fan-out (G-15) ───────────────────────────────────────────────

export interface InsightsNudgeVenueInput {
  venueId: string;
  venueName: string;
  placePoolId: string | null;
}

export interface InsightsNudgeState {
  venueId: string;
  venueName: string;
  /** true when the on-file website exists AND the venues latest-read is "none". */
  needsSiteCheck: boolean;
  /** true when pricing is a registered instrument AND its latest-read is "none". */
  needsPricingCheck: boolean;
}

const NUDGE_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * G-15 — per-venue reads feeding the to-do band. The caller passes ONLY
 * verified, non-stay venues (don't nag pre-approval). Reads are unmetered
 * (P-43 is a read, no quota). The authoring-context read reuses the module's
 * exact key (`brandPlacePipelineKeys.context`) so a visited venue costs
 * nothing extra; the latest-reads reuse `growthToolsKeys.subjectRead`.
 * The pricing read + row are BOTH gated on the pricing instrument being
 * registered in `INSIGHT_INSTRUMENTS` (#1737 flips it) — a to-do row must
 * never deep-link to a surface that doesn't render, and an ungated read for
 * an unrendered surface would be pure waste.
 */
export function useInsightsNudgeInputs(
  brandId: string | null,
  venues: readonly InsightsNudgeVenueInput[],
): InsightsNudgeState[] {
  const { loading, session } = useAuth();
  const pricingRegistered = (INSIGHT_INSTRUMENTS as readonly string[]).includes(
    "pricing",
  );
  const baseEnabled = !loading &&
    session !== null &&
    brandId !== null &&
    brandId.length > 0 &&
    venues.length > 0;

  const contextQueries = useQueries({
    queries: venues.map((v) => {
      const enabled = baseEnabled && v.placePoolId !== null;
      return {
        queryKey: enabled && brandId !== null && v.placePoolId !== null
          ? brandPlacePipelineKeys.context(brandId, v.placePoolId, v.venueId)
          : ([...DISABLED_KEY, "ctx", v.venueId] as const),
        enabled,
        staleTime: 15_000,
        queryFn: async () => {
          if (brandId === null || v.placePoolId === null) {
            throw new Error("nudge ctx disabled");
          }
          return fetchBrandPlaceAuthoringContext({
            brandId,
            placePoolId: v.placePoolId,
            venueId: v.venueId,
          });
        },
      };
    }),
  });

  const siteQueries = useQueries({
    queries: venues.map((v) => ({
      queryKey: baseEnabled && brandId !== null
        ? growthToolsKeys.subjectRead(
          brandId,
          "venues",
          `venue:${v.venueId}`,
          false,
        )
        : ([...DISABLED_KEY, "site", v.venueId] as const),
      enabled: baseEnabled,
      staleTime: NUDGE_STALE_TIME_MS,
      queryFn: async () => {
        if (brandId === null) throw new Error("nudge site read disabled");
        return readLatestBySubject(brandId, "venues", `venue:${v.venueId}`, false);
      },
    })),
  });

  const pricingQueries = useQueries({
    queries: venues.map((v) => ({
      queryKey: baseEnabled && pricingRegistered && brandId !== null
        ? growthToolsKeys.subjectRead(
          brandId,
          "experiences",
          `venue:${v.venueId}`,
          false,
        )
        : ([...DISABLED_KEY, "pricing", v.venueId] as const),
      enabled: baseEnabled && pricingRegistered,
      staleTime: NUDGE_STALE_TIME_MS,
      queryFn: async () => {
        if (brandId === null) throw new Error("nudge pricing read disabled");
        return readLatestBySubject(
          brandId,
          "experiences",
          `venue:${v.venueId}`,
          false,
        );
      },
    })),
  });

  return useMemo(() => {
    return venues.map((v, i) => {
      const ctx = contextQueries[i];
      const site = siteQueries[i];
      const pricing = pricingQueries[i];
      const website = ctx?.data?.website ?? null;
      const hasWebsite = typeof website === "string" && website.trim().length > 0;
      // A nudge NEVER renders on unresolved/errored reads — a to-do row must
      // be a true statement, not a guess (Constitution #9).
      const needsSiteCheck = hasWebsite &&
        site?.data?.status === "none";
      const needsPricingCheck = pricingRegistered &&
        pricing?.data?.status === "none";
      return {
        venueId: v.venueId,
        venueName: v.venueName,
        needsSiteCheck,
        needsPricingCheck,
      };
    });
  }, [venues, contextQueries, siteQueries, pricingQueries, pricingRegistered]);
}
