import type { TurnoutInputSource } from "./turnoutInput";

/** Provider-only, model-input overlay. Never writes the Experience draft. */
export const withExperienceModelEstimate = (
  source: TurnoutInputSource,
  estimate: number | null,
): TurnoutInputSource => {
  if (
    source.kind !== "experience" ||
    !source.unlimited ||
    estimate === null ||
    !Number.isInteger(estimate) ||
    estimate < 1
  ) {
    return source;
  }
  return { ...source, capacity: String(estimate), unlimited: false };
};
