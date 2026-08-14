import { createContext, useContext } from "react";

import type { TurnoutForecastController } from "../../hooks/useTurnoutForecast";

export interface TurnoutIntelContextValue extends TurnoutForecastController {
  openReport: (contextLabel?: string, door?: "ambient" | "gate") => void;
  wizard: "event" | "rsvp" | "experience";
  navigateTo?: (
    step: number,
    focus: "name" | "date" | "city" | "price" | "capacity",
  ) => void;
  focusHint: "name" | "date" | "city" | "price" | "capacity" | null;
  consumeFocusHint: (
    focus: "name" | "date" | "city" | "price" | "capacity",
  ) => boolean;
}

export const TurnoutIntelContext =
  createContext<TurnoutIntelContextValue | null>(null);

export const useTurnoutIntel = (): TurnoutIntelContextValue | null =>
  useContext(TurnoutIntelContext);
