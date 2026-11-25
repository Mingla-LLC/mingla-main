/**
 * #4490 - the touch-target floor for a phone-width browser.
 *
 * `hitSlop` does nothing on react-native-web, so a 36 px control is really 36 px
 * in a phone browser. This returns 44 (the kit's `size.btn.md`, the Apple and
 * Material floor) when the app runs on web below the wide-desktop layout (1024; tablets and phones are touch), and 0 elsewhere
 * (native already extends targets with hitSlop). Use it as a `minHeight` /
 * `minWidth` on a control that is smaller than 44 by design on desktop.
 */
import { Platform, useWindowDimensions } from "react-native";

import { size } from "../constants/designSystem";

/** Below this width a browser is treated as a phone for touch targets. */
export const TOUCH_FLOOR_BELOW = 1024;

/** Pure rule, so it can be tested without a renderer. */
export function touchFloorFor(platform: string, width: number): number {
  return platform === "web" && width > 0 && width < TOUCH_FLOOR_BELOW ? size.btn.md : 0;
}

export function useTouchFloor(): number {
  // A test that mocks `react-native` without this hook gets 0 (no floor). The branch
  // is fixed for the life of a process, so the hook order never changes.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const width = typeof useWindowDimensions === "function" ? useWindowDimensions().width : 0;
  return touchFloorFor(Platform?.OS ?? "ios", width);
}
