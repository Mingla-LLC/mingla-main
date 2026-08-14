import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  withExperienceModelEstimate,
  type TurnoutInputSource,
} from "../../utils/turnoutInput";
import type {
  TurnoutForecastController,
  TurnoutSurface,
  TurnoutWizard,
} from "../../hooks/useTurnoutForecast";
import {
  TurnoutIntelContext,
  type TurnoutIntelContextValue,
  type TurnoutEstimateState,
  TurnoutGateSessionClaims,
  type TurnoutIntelSessionController,
} from "./TurnoutIntelContext";

export { useTurnoutIntel } from "./TurnoutIntelContext";

const LazyIntelReportSheet = React.lazy(async () => {
  const module = await import("./IntelReportSheet");
  return { default: module.IntelReportSheet };
});

// Keep React Query, network-state, and growth-tool services out of every
// wizard's boot graph. Children stay interactive while this ambient observer
// initializes beside them.
const LazyTurnoutIntelObserver = React.lazy(
  () => import("./TurnoutIntelObserver"),
);

export interface TurnoutIntelProviderProps {
  children: React.ReactNode;
  source: TurnoutInputSource;
  brandId: string;
  wizard: TurnoutWizard;
  surface: TurnoutSurface;
  previewActive: boolean;
  keyboardVisible: boolean;
  autoRunEnabled?: boolean;
  controllerRef?: React.MutableRefObject<TurnoutForecastController | null>;
  sessionRef?: React.MutableRefObject<TurnoutIntelSessionController | null>;
  navigateTo?: (
    step: number,
    focus: "name" | "date" | "city" | "price" | "capacity",
  ) => void;
}

export const TurnoutIntelProvider: React.FC<TurnoutIntelProviderProps> = ({
  children,
  source,
  brandId,
  wizard,
  surface,
  previewActive,
  keyboardVisible,
  autoRunEnabled,
  controllerRef,
  sessionRef,
  navigateTo,
}) => {
  const [controller, setController] =
    useState<TurnoutForecastController | null>(null);
  // R-6 — freeze the card's displayed state while the keyboard is visible.
  // Network truth may finish in the background, but it is painted only after
  // dismissal so a focused field never moves under the user's fingers.
  const displayedController = useRef<TurnoutForecastController | null>(
    controller,
  );
  if (!keyboardVisible && controller !== null) {
    displayedController.current = controller;
  }
  const display = keyboardVisible ? displayedController.current : controller;
  const [reportOpen, setReportOpen] = useState(false);
  const [focusHint, setFocusHint] = useState<
    "name" | "date" | "city" | "price" | "capacity" | null
  >(null);
  const [reportContext, setReportContext] = useState<string | undefined>();
  const [estimate, setEstimateState] = useState<TurnoutEstimateState>({
    kind: "unanswered",
  });
  const estimateSourceCompatible =
    source.kind === "experience" && source.unlimited;
  const effectiveEstimate = useMemo<TurnoutEstimateState>(
    () =>
      estimateSourceCompatible ? estimate : { kind: "unanswered" },
    [estimate, estimateSourceCompatible],
  );
  const estimateApplied = effectiveEstimate.kind === "answered";
  useEffect(() => {
    if (!estimateSourceCompatible && estimate.kind !== "unanswered") {
      setEstimateState({ kind: "unanswered" });
    }
  }, [estimate.kind, estimateSourceCompatible]);
  const gateClaims = useRef(new TurnoutGateSessionClaims());
  const setEstimate = useCallback((value: number): void => {
    if (Number.isInteger(value) && value > 0) {
      setEstimateState({ kind: "answered", value });
    }
  }, []);
  const skipEstimate = useCallback((): void => {
    setEstimateState({ kind: "skipped" });
  }, []);
  const claimGate = useCallback(
    (inputKey: string): "claimed" | "active" | "seen" => {
      return gateClaims.current.claim(inputKey);
    },
    [],
  );
  const dismissGate = useCallback((inputKey: string): void => {
    gateClaims.current.dismiss(inputKey);
  }, []);
  const modeledSource = useMemo<TurnoutInputSource>(() => {
    return withExperienceModelEstimate(
      source,
      estimateApplied && effectiveEstimate.kind === "answered"
        ? effectiveEstimate.value
        : null,
    );
  }, [effectiveEstimate, estimateApplied, source]);
  const sessionHonesty = useMemo((): string | null => {
    if (controller?.input?.date === undefined) return null;
    if (source.kind === "experience") {
      return source.when.whenMode === "single"
        ? null
        : `Modeled for your next session — ${controller.input.date}`;
    }
    return source.draft.whenMode === "single"
      ? null
      : `Modeled for your next date — ${controller.input.date}`;
  }, [controller?.input?.date, source]);
  if (controllerRef !== undefined) controllerRef.current = controller;
  if (sessionRef !== undefined) {
    sessionRef.current = {
      estimate: effectiveEstimate,
      estimateApplied,
      setEstimate,
      skipEstimate,
      claimGate,
      dismissGate,
    };
  }
  const value = useMemo<TurnoutIntelContextValue | null>(
    () =>
      display === null || controller === null
        ? null
        : ({
            ...display,
            wizard,
            navigateTo:
              navigateTo === undefined
                ? undefined
                : (step, focus) => {
                    setFocusHint(focus);
                    navigateTo(step, focus);
                  },
            focusHint,
            consumeFocusHint: (focus) => {
              if (focusHint !== focus) return false;
              setFocusHint(null);
              return true;
            },
            estimate: effectiveEstimate,
            estimateApplied,
            setEstimate,
            skipEstimate,
            sessionHonesty,
            run: controller.run,
            openReport: (contextLabel?: string, door = "ambient") => {
              controller.trackReportOpened(door);
              setReportContext(contextLabel);
              setReportOpen(true);
            },
          } satisfies TurnoutIntelContextValue),
    [
      controller,
      display,
      effectiveEstimate,
      estimateApplied,
      focusHint,
      navigateTo,
      sessionHonesty,
      setEstimate,
      skipEstimate,
      wizard,
    ],
  );
  return (
    <TurnoutIntelContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <LazyTurnoutIntelObserver
          brandId={brandId}
          source={modeledSource}
          wizard={wizard}
          surface={surface}
          previewActive={previewActive}
          autoRunEnabled={autoRunEnabled}
          onController={setController}
        />
        {reportOpen && controller !== null ? (
          <LazyIntelReportSheet
            visible
            report={controller.report}
            onClose={() => setReportOpen(false)}
            contextLabel={reportContext}
          />
        ) : null}
      </Suspense>
    </TurnoutIntelContext.Provider>
  );
};
