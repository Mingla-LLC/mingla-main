/**
 * #4304 part 3 — the first-run stage, computed ONCE by the (tabs) layout
 * (`useFirstRunStage`) and read by the screens inside it (Ari's greeting and
 * top bar). One owner, no second set of queries per screen.
 *
 * The default is `pending`: a screen rendered outside the tabs layout (or in a
 * test) behaves exactly as it did before #4304.
 */

import React from "react";

import type { FirstRunStage } from "../utils/firstRunState";

export interface FirstRunStageContextValue {
  stage: FirstRunStage;
  userId: string | null;
  /** creator_accounts.display_name, for "Hi <first name>." */
  displayName: string | null;
}

export const FirstRunStageContext =
  React.createContext<FirstRunStageContextValue>({
    stage: "pending",
    userId: null,
    displayName: null,
  });

export const useFirstRunStageContext = (): FirstRunStageContextValue =>
  React.useContext(FirstRunStageContext);
