/**
 * #1672 / #3281 1d — open a saved pool-card payload as the right ExpansionTarget.
 * Brand experiences → businessEvent (Book /exp path); everything else → nightOut
 * via the canonical mapper.
 */
import type { ExpansionTarget } from "../types/expansion";
import { savedCardToExpandedCardData } from "../components/utils/savedCardToExpandedCardData";
import { isBrandExperiencePayload } from "./isBrandExperiencePayload";
import { experienceRecToBusinessEventCard } from "./experienceRecToBusinessEventCard";

export function expansionTargetFromSavedPayload(
  payload: Record<string, unknown>,
): ExpansionTarget | null {
  if (isBrandExperiencePayload(payload)) {
    return {
      kind: "businessEvent",
      data: experienceRecToBusinessEventCard(payload),
    };
  }
  const expanded = savedCardToExpandedCardData(payload);
  return expanded ? { kind: "nightOut", data: expanded } : null;
}
