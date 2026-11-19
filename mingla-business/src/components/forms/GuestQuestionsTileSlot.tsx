import React from "react";

import { ActionTile } from "../event/ActionTile";
import type { GuestQuestionsPageKind } from "../../utils/guestQuestionsModel";

// #4514 — the manage pages mount the "Guest questions" tile through this tiny
// slot. The tile, its data hook and the attach sheet load on demand, so the
// eager Host web bundle gains only this declaration. While the chunk loads the
// cell shows the labelled, disabled tile (a moment, never a dead tap).
const LazyGuestQuestionsTile = React.lazy(async () => {
  const mod = await import("./GuestQuestionsTile");
  return { default: mod.GuestQuestionsTile };
});

const noop = (): void => undefined;

export interface GuestQuestionsTileSlotProps {
  eventId: string;
  brandId: string;
  kind: GuestQuestionsPageKind;
  testID?: string;
}

export const GuestQuestionsTileSlot: React.FC<GuestQuestionsTileSlotProps> = (props) => (
  <React.Suspense
    fallback={<ActionTile fill disabled icon="list" label="Guest questions" sub="Loading…" onPress={noop} />}
  >
    <LazyGuestQuestionsTile {...props} />
  </React.Suspense>
);

export default GuestQuestionsTileSlot;
