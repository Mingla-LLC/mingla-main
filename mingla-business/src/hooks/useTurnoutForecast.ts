/** Issue #1008 — metered, imperative turnout forecast state machine. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessibilityInfo } from "react-native";

import { postHogService } from "../services/postHogService";
import {
  GrowthToolsAppError,
  mintClientRef,
  readRunByClientRef,
  runGrowthTool,
  type GrowthToolRunResult,
} from "../services/growthToolsService";
import type { TurnoutReport } from "../types/growthTools";
import {
  buildTurnoutInput,
  turnoutInputHash,
  turnoutInputKey,
  turnoutMaterialKey,
  TurnoutRunBudget,
  type TurnoutBlockReason,
  type TurnoutEngineInput,
  type TurnoutInputSource,
} from "../utils/turnoutInput";
import { useShareNetworkState } from "../components/ui/useShareNetworkState";
import { growthToolsKeys } from "./growthToolsKeys";

export type TurnoutRunTrigger = "auto" | "gate" | "update";
export type TurnoutForecastState =
  | "idle"
  | "eligible"
  | "running"
  | "result"
  | "stale"
  | "error-hidden"
  | "rate_limited"
  | "offline";
export type TurnoutWizard = "event" | "rsvp";
export type TurnoutSurface =
  "when" | "where" | "tickets" | "rsvp_setup" | "preview";

export interface TurnoutCachedResult extends GrowthToolRunResult<TurnoutReport> {
  inputKey: string;
  inputHash: string;
  materialKey: string;
  trigger: TurnoutRunTrigger;
}

export interface UseTurnoutForecastArgs {
  brandId: string;
  source: TurnoutInputSource;
  wizard: TurnoutWizard;
  surface: TurnoutSurface;
  previewActive: boolean;
}

export interface TurnoutForecastController {
  state: TurnoutForecastState;
  report: TurnoutReport | null;
  result: TurnoutCachedResult | null;
  blockReason: TurnoutBlockReason | null;
  input: TurnoutEngineInput | null;
  inputKey: string | null;
  inputHash: string | null;
  run: (trigger: TurnoutRunTrigger) => Promise<void>;
  trackReportOpened: () => void;
  updateFailureCount: number;
}

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1_000;
const RESUME_POLL_MS = 5_000;
const RESUME_DEADLINE_MS = 130_000;

const isFresh = (result: TurnoutCachedResult, key: string): boolean => {
  const generatedAt = result.report.meta?.generated_at;
  if (result.inputKey !== key || generatedAt === undefined) return false;
  const timestamp = Date.parse(generatedAt);
  return (
    Number.isFinite(timestamp) && Date.now() - timestamp <= FRESH_WINDOW_MS
  );
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const resumeSubjectlessRun = async (
  brandId: string,
  clientRef: string,
  original: GrowthToolsAppError,
): Promise<GrowthToolRunResult<TurnoutReport>> => {
  const deadline = Date.now() + RESUME_DEADLINE_MS;
  while (Date.now() < deadline) {
    await wait(RESUME_POLL_MS);
    try {
      const read = await readRunByClientRef<TurnoutReport>(brandId, clientRef);
      if (read.status === "report_ready") {
        return {
          runId: read.runId,
          report: read.report,
          cached: false,
        };
      }
      if (read.status === "failed") {
        throw new GrowthToolsAppError("generation_failed", {
          reason: read.reason,
        });
      }
    } catch (error) {
      if (
        error instanceof GrowthToolsAppError &&
        error.code !== "network" &&
        error.code !== "not_found"
      ) {
        throw error;
      }
      console.error("[#1008] turnout resume poll failed", error);
    }
  }
  throw original;
};

export const useTurnoutForecast = (
  args: UseTurnoutForecastArgs,
): TurnoutForecastController => {
  const queryClient = useQueryClient();
  const online = useShareNetworkState();
  const built = useMemo(() => buildTurnoutInput(args.source), [args.source]);
  const input = built.ok ? built.input : null;
  const inputKey = useMemo(
    () => (input === null ? null : turnoutInputKey(input)),
    [input],
  );
  const inputHash = useMemo(
    () => (input === null ? null : turnoutInputHash(input)),
    [input],
  );
  const materialKey = useMemo(
    () => (input === null ? null : turnoutMaterialKey(input)),
    [input],
  );
  // The query is observation-only. Runs are always imperative and metered;
  // mounting or changing an input key can never ask React Query to fetch.
  useQuery<TurnoutCachedResult>({
    queryKey: growthToolsKeys.run(
      args.brandId,
      "events",
      inputKey ?? "ineligible",
    ),
    enabled: false,
    queryFn: async () => {
      throw new Error(
        "Turnout forecast queries run through the metered imperative path.",
      );
    },
  });
  const [state, setState] = useState<TurnoutForecastState>(
    built.ok ? "eligible" : "idle",
  );
  const [result, setResult] = useState<TurnoutCachedResult | null>(null);
  const [updateFailureCount, setUpdateFailureCount] = useState(0);
  const runBudget = useRef(new TurnoutRunBudget());
  const latestAttempt = useRef(0);
  const followedResultRef = useRef<string | null>(null);

  const analyticsProps = useCallback(
    (trigger: TurnoutRunTrigger, completed?: TurnoutCachedResult) => ({
      tool: "events",
      wizard: args.wizard,
      surface: args.surface,
      trigger,
      input_hash: inputHash,
      band_low: completed?.report.forecast?.total_low ?? null,
      band_high: completed?.report.forecast?.total_high ?? null,
      capacity: completed?.report.forecast?.capacity ?? input?.capacity ?? null,
      confidence: completed?.report.forecast?.confidence ?? null,
      research_source: completed?.report.meta?.research_source ?? null,
      cached: completed?.cached ?? false,
    }),
    [args.surface, args.wizard, input?.capacity, inputHash],
  );

  const run = useCallback(
    async (trigger: TurnoutRunTrigger): Promise<void> => {
      if (
        input === null ||
        inputKey === null ||
        inputHash === null ||
        materialKey === null
      ) {
        return;
      }
      if (!online) {
        setState("offline");
        return;
      }
      const attempt = latestAttempt.current + 1;
      latestAttempt.current = attempt;
      setState("running");
      postHogService.capture("intel_run_started", analyticsProps(trigger));
      try {
        const cached = queryClient.getQueryData<TurnoutCachedResult>(
          growthToolsKeys.run(args.brandId, "events", inputKey),
        );
        const outcome =
          cached !== undefined &&
          trigger !== "update" &&
          isFresh(cached, inputKey)
            ? cached
            : await queryClient.fetchQuery<TurnoutCachedResult>({
                queryKey: growthToolsKeys.run(args.brandId, "events", inputKey),
                staleTime: trigger === "update" ? 0 : Infinity,
                gcTime: 60 * 60 * 1_000,
                queryFn: async () => {
                  const clientRef = mintClientRef();
                  let response: GrowthToolRunResult<TurnoutReport>;
                  try {
                    response = await runGrowthTool<TurnoutReport>(
                      "events",
                      args.brandId,
                      input,
                      { clientRef },
                    );
                  } catch (error) {
                    if (
                      error instanceof GrowthToolsAppError &&
                      error.code === "network"
                    ) {
                      response = await resumeSubjectlessRun(
                        args.brandId,
                        clientRef,
                        error,
                      );
                    } else {
                      throw error;
                    }
                  }
                  return {
                    ...response,
                    inputKey,
                    inputHash,
                    materialKey,
                    trigger,
                  };
                },
              });
        if (attempt < latestAttempt.current) return;
        setResult(outcome);
        setState("result");
        setUpdateFailureCount(0);
        postHogService.capture(
          "intel_run_completed",
          analyticsProps(trigger, outcome),
        );
        postHogService.capture(
          "intel_card_shown",
          analyticsProps(trigger, outcome),
        );
        const low = outcome.report.forecast?.total_low;
        const high = outcome.report.forecast?.total_high;
        const capacity = outcome.report.forecast?.capacity;
        if (
          typeof low === "number" &&
          typeof high === "number" &&
          typeof capacity === "number"
        ) {
          AccessibilityInfo.announceForAccessibility(
            `Forecast ready: ${low} to ${high} of ${capacity} expected.`,
          );
        }
      } catch (error) {
        if (attempt < latestAttempt.current) return;
        const typed =
          error instanceof GrowthToolsAppError
            ? error
            : new GrowthToolsAppError("server", { reason: String(error) });
        postHogService.capture("intel_run_failed", analyticsProps(trigger));
        if (typed.code === "rate_limited") {
          setState("rate_limited");
          return;
        }
        if (trigger === "update") {
          setUpdateFailureCount((count) => {
            const next = count + 1;
            if (next >= 2) setState("error-hidden");
            return next;
          });
          setState("error-hidden");
          return;
        }
        setState("error-hidden");
      }
    },
    [
      analyticsProps,
      args.brandId,
      input,
      inputHash,
      inputKey,
      materialKey,
      online,
      queryClient,
    ],
  );

  // I-PROPOSED-1008-TURNOUT-AUTO-RUN-METERED: set the ref BEFORE issuing
  // the request so StrictMode/effect replays cannot spend twice.
  useEffect(() => {
    if (!built.ok) {
      setState("idle");
      return;
    }
    if (!args.previewActive && runBudget.current.spendAuto()) {
      void run("auto");
    }
  }, [args.previewActive, built.ok, run]);

  useEffect(() => {
    if (inputKey === null || materialKey === null || result === null) return;
    if (updateFailureCount > 0) return;
    if (result.inputKey === inputKey) {
      if (state !== "running") setState("result");
      return;
    }
    if (result.materialKey !== materialKey) {
      setState("stale");
      if (followedResultRef.current !== result.runId) {
        followedResultRef.current = result.runId;
        postHogService.capture(
          "intel_reco_followed",
          analyticsProps(result.trigger, result),
        );
      }
    }
  }, [
    analyticsProps,
    inputKey,
    materialKey,
    result,
    state,
    updateFailureCount,
  ]);

  // Preview owns the sanctioned gate refresh. A fresh key is free; each
  // changed key is attempted at most once per provider session.
  useEffect(() => {
    if (!args.previewActive || inputKey === null) return;
    const cached = queryClient.getQueryData<TurnoutCachedResult>(
      growthToolsKeys.run(args.brandId, "events", inputKey),
    );
    if (cached !== undefined && isFresh(cached, inputKey)) {
      setResult(cached);
      setState("result");
      return;
    }
    if (runBudget.current.spendPreview(inputKey)) {
      void run("gate");
    }
  }, [args.brandId, args.previewActive, inputKey, queryClient, run]);

  const trackReportOpened = useCallback((): void => {
    if (result === null) return;
    postHogService.capture(
      "intel_report_opened",
      analyticsProps(result.trigger, result),
    );
  }, [analyticsProps, result]);

  return {
    state,
    report: result?.report ?? null,
    result,
    blockReason: built.ok ? null : built.reason,
    input,
    inputKey,
    inputHash,
    run,
    trackReportOpened,
    updateFailureCount,
  };
};
