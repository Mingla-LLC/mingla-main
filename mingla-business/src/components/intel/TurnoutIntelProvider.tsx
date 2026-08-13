import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DraftEvent } from "../../store/draftEventStore";
import {
  useTurnoutForecast,
  type TurnoutForecastController,
  type TurnoutSurface,
  type TurnoutWizard,
} from "../../hooks/useTurnoutForecast";
import { postHogService } from "../../services/postHogService";
import { IntelReportSheet } from "./IntelReportSheet";

interface TurnoutIntelContextValue extends TurnoutForecastController {
  openReport: () => void;
}

const TurnoutIntelContext = createContext<TurnoutIntelContextValue | null>(
  null,
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
  const controller = useTurnoutForecast({
    brandId,
    source: { kind: wizard, draft, brandDefaultCurrency },
    wizard,
    surface,
    previewActive,
  });
  // R-6 — freeze the card's displayed state while the keyboard is visible.
  // Network truth may finish in the background, but it is painted only after
  // dismissal so a focused field never moves under the user's fingers.
  const displayedController = useRef(controller);
  if (!keyboardVisible) displayedController.current = controller;
  const display = keyboardVisible ? displayedController.current : controller;
  const [reportOpen, setReportOpen] = useState(false);
  const value = useMemo<TurnoutIntelContextValue>(
    () => ({
      ...display,
      run: controller.run,
      openReport: () => {
        if (controller.result !== null) {
          postHogService.capture("intel_report_opened", {
            tool: "events",
            wizard,
            surface,
            trigger: controller.result.trigger,
            input_hash: controller.inputHash,
            band_low: controller.report?.forecast?.total_low ?? null,
            band_high: controller.report?.forecast?.total_high ?? null,
            capacity:
              controller.report?.forecast?.capacity ??
              controller.input?.capacity ??
              null,
            confidence: controller.report?.forecast?.confidence ?? null,
            research_source: controller.report?.meta?.research_source ?? null,
            cached: controller.result.cached,
          });
        }
        setReportOpen(true);
      },
    }),
    [controller, display, surface, wizard],
  );
  return (
    <TurnoutIntelContext.Provider value={value}>
      {children}
      <IntelReportSheet
        visible={reportOpen}
        report={controller.report}
        onClose={() => setReportOpen(false)}
      />
    </TurnoutIntelContext.Provider>
  );
};

export const useTurnoutIntel = (): TurnoutIntelContextValue | null =>
  useContext(TurnoutIntelContext);
