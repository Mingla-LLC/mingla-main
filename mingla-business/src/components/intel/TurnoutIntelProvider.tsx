import React, { Suspense, useMemo, useRef, useState } from "react";

import type { TurnoutInputSource } from "../../utils/turnoutInput";
import type {
  TurnoutForecastController,
  TurnoutSurface,
  TurnoutWizard,
} from "../../hooks/useTurnoutForecast";
import {
  TurnoutIntelContext,
  type TurnoutIntelContextValue,
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
  if (controllerRef !== undefined) controllerRef.current = controller;
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
            run: controller.run,
            openReport: (contextLabel?: string, door = "ambient") => {
              controller.trackReportOpened(door);
              setReportContext(contextLabel);
              setReportOpen(true);
            },
          } satisfies TurnoutIntelContextValue),
    [controller, display, focusHint, navigateTo, wizard],
  );
  return (
    <TurnoutIntelContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <LazyTurnoutIntelObserver
          brandId={brandId}
          source={source}
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
