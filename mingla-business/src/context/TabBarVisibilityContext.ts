/**
 * #4579/#4572 — whether the (tabs) shell actually renders the phone tab bar.
 *
 * ONE owner: the (tabs) layout computes `hideBottomNav` (focused authoring
 * routes, and #4420 B5: fewer than 2 destinations, e.g. a first-run host) and
 * provides the inverse here. Screens that reserve room for the floating
 * capsule (the Ari composer's resting clearance) read this instead of
 * re-deriving the rule, so they never keep an 80pt band for a bar that is not
 * there.
 *
 * The default is `true`: a screen rendered outside the tabs layout (or in a
 * test) keeps the clearance it always had.
 */

import React from "react";

export const TabBarVisibilityContext = React.createContext<boolean>(true);

export const useShellTabBarVisible = (): boolean => React.useContext(TabBarVisibilityContext);
