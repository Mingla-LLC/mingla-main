import React, {
  Suspense,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DraftEvent } from "../../store/draftEventStore";
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
  draft: DraftEvent;
  brandId: string;
  brandDefaultCurrency: string | null;
  wizard: TurnoutWizard;
  surface: TurnoutSurface;
  previewActive: boolean;
  keyboardVisible: boolean;
}

export const TurnoutIntelProvider: React.FC<TurnoutIntelProviderProps> = ({
  children,
  draft,
  brandId,
  brandDefaultCurrency,
  wizard,
  surface,
  previewActive,
  keyboardVisible,
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
  const value = useMemo<TurnoutIntelContextValue | null>(
    () =>
      display === null || controller === null
        ? null
        : ({
            ...display,
            run: controller.run,
            openReport: () => {
              controller.trackReportOpened();
              setReportOpen(true);
            },
          } satisfies TurnoutIntelContextValue),
    [controller, display],
  );
  return (
    <TurnoutIntelContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <LazyTurnoutIntelObserver
          brandId={brandId}
          source={{ kind: wizard, draft, brandDefaultCurrency }}
          wizard={wizard}
          surface={surface}
          previewActive={previewActive}
          onController={setController}
        />
        {reportOpen && controller !== null ? (
          <LazyIntelReportSheet
            visible
            report={controller.report}
            onClose={() => setReportOpen(false)}
          />
        ) : null}
      </Suspense>
    </TurnoutIntelContext.Provider>
  );
};
