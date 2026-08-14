import { createContext, useContext } from "react";

import type { TurnoutForecastController } from "../../hooks/useTurnoutForecast";

export interface TurnoutIntelContextValue extends TurnoutForecastController {
  openReport: () => void;
}

export const TurnoutIntelContext =
  createContext<TurnoutIntelContextValue | null>(null);

export const useTurnoutIntel = (): TurnoutIntelContextValue | null =>
  useContext(TurnoutIntelContext);
