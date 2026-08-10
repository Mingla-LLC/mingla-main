/**
 * Issue #1735 CI rework — the EAGER growth-tools hook slice: the standing
 * latest-read (`useIntelSubjectLatest`) and the to-do nudge fan-out
 * (`useInsightsNudgeInputs`). These sit on the BOOT path (Home/Hub to-dos,
 * venue Overview tile), so they import ONLY the read slice of the service
 * (`growthToolsReads`) — never the full run/watch service, which loads
 * behind the shell's lazy Insights boundary (ORCH-1083 web budget).
 * `useGrowthTools.ts` re-exports both so the lazy side keeps one import
 * surface. Same G-4 gating (the `!loading && session !== null` template) and
 * the same P-35/COMMS-0136 state ownership: RQ cache ONLY.
 */

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "../context/AuthContext";
import { INSIGHT_INSTRUMENTS } from "../components/venue/insights/insightsInstruments";
import {
  readLatestBySubject,
  type SubjectLatestResult,
} from "../services/growthToolsReads";
import {
  fetchBrandPlaceAuthoringContext,
} from "../services/businessPlaceAuthoringService";
import { brandPlacePipelineKeys } from "./useBrandPlacePipelineState";
import { growthToolsKeys, type GrowthToolName } from "./growthToolsKeys";

const DISABLED_KEY = ["growth-tools-disabled"] as const;

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
