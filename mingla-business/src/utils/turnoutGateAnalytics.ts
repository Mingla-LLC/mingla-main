export type TurnoutGateAnalyticsState =
  | "fresh"
  | "ran"
  | "running"
  | "failed"
  | "rate_limited"
  | "blocked"
  | "demand_read";

export const shouldTrackGatePublishedAnyway = (
  state: TurnoutGateAnalyticsState,
): boolean =>
  state === "running" ||
  state === "failed" ||
  state === "rate_limited" ||
  state === "blocked";
