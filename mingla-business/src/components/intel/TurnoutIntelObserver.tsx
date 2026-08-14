import { useEffect, useRef } from "react";

import {
  useTurnoutForecast,
  type TurnoutForecastController,
  type TurnoutSurface,
  type TurnoutWizard,
} from "../../hooks/useTurnoutForecast";
import type { TurnoutInputSource } from "../../utils/turnoutInput";

interface TurnoutIntelObserverProps {
  brandId: string;
  source: TurnoutInputSource;
  wizard: TurnoutWizard;
  surface: TurnoutSurface;
  previewActive: boolean;
  onController: (controller: TurnoutForecastController) => void;
}

const TurnoutIntelObserver = ({
  onController,
  ...args
}: TurnoutIntelObserverProps): null => {
  const controller = useTurnoutForecast(args);
  const published = useRef<TurnoutForecastController | null>(null);

  useEffect(() => {
    const previous = published.current;
    if (
      previous !== null &&
      previous.state === controller.state &&
      previous.report === controller.report &&
      previous.result === controller.result &&
      previous.blockReason === controller.blockReason &&
      previous.input === controller.input &&
      previous.inputKey === controller.inputKey &&
      previous.inputHash === controller.inputHash &&
      previous.run === controller.run &&
      previous.trackReportOpened === controller.trackReportOpened &&
      previous.updateFailureCount === controller.updateFailureCount
    ) {
      return;
    }
    published.current = controller;
    onController(controller);
  }, [controller, onController]);

  return null;
};

export default TurnoutIntelObserver;
