import { createContext, useContext } from "react";

import type { TurnoutForecastController } from "../../hooks/useTurnoutForecast";

export type TurnoutEstimateState =
  | { kind: "unanswered" }
  | { kind: "answered"; value: number }
  | { kind: "skipped" };

export interface TurnoutIntelSessionController {
  estimate: TurnoutEstimateState;
  setEstimate: (value: number) => void;
  skipEstimate: () => void;
  claimGate: (inputKey: string) => "claimed" | "active" | "seen";
  dismissGate: (inputKey: string) => void;
}

export class TurnoutGateSessionClaims {
  private readonly shown = new Set<string>();
  private active: string | null = null;

  claim(inputKey: string): "claimed" | "active" | "seen" {
    if (this.active === inputKey) return "active";
    if (this.shown.has(inputKey)) return "seen";
    this.active = inputKey;
    return "claimed";
  }

  dismiss(inputKey: string): void {
    this.shown.add(inputKey);
    if (this.active === inputKey) this.active = null;
  }
}

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
  estimate: TurnoutEstimateState;
  setEstimate: (value: number) => void;
  skipEstimate: () => void;
  sessionHonesty: string | null;
}

export const TurnoutIntelContext =
  createContext<TurnoutIntelContextValue | null>(null);

export const useTurnoutIntel = (): TurnoutIntelContextValue | null =>
  useContext(TurnoutIntelContext);
