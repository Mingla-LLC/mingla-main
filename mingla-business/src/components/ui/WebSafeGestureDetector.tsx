/**
 * WebSafeGestureDetector — native passthrough to react-native-gesture-handler's
 * `GestureDetector` (ORCH-1098 Stage 6).
 *
 * # Why this wrapper exists
 * `react-native-reanimated@4` REMOVED the legacy `Reanimated.useEvent` export.
 * `react-native-gesture-handler@2.28`'s `<GestureDetector>` still calls
 * `useAnimatedGesture()` internally, which on its first render does
 * `Reanimated.useEvent(...)` (see
 * `node_modules/react-native-gesture-handler/.../GestureDetector/useAnimatedGesture.js:135`).
 * On the WEB build, the reanimated web shim does NOT provide `useEvent`, so the
 * call throws `TypeError: Reanimated.useEvent is not a function` the instant a
 * `<GestureDetector>` mounts — which crashed the whole route into the app error
 * boundary ("Something broke") on phone web (proven on the create-flow:
 * `UniversalCreatorSheet` → `TopSheet` → `<GestureDetector>`).
 *
 * This is the THIRD reanimated-on-web crash in this app (after BottomNav and
 * the Templates drawer), so reanimated-driven gesture/animation primitives are
 * treated as fragile on web and web-gated, exactly like `BottomNav.web.tsx`
 * and `TemplatePreviewDrawer.web.tsx`.
 *
 * # Contract
 * - NATIVE (iOS/Android): this file. Renders the REAL `<GestureDetector>`
 *   byte-for-byte (same gesture, same single child). Swipe-to-dismiss behaves
 *   identically to before.
 * - WEB: `WebSafeGestureDetector.web.tsx` renders `children` directly with no
 *   gesture wrapper, so the reanimated `useEvent` code path never runs. The
 *   swipe-to-dismiss affordance is dropped on web (it is a native nicety);
 *   scrim-tap, the explicit close button, and Android back already dismiss
 *   every sheet/toast on web, so no dismiss capability is lost.
 *
 * Consumers: `TopSheet.tsx`, `SheetMobile.tsx`, `Toast.tsx`. Any future sheet/
 * overlay that wants a swipe gesture should route through this wrapper rather
 * than importing `GestureDetector` directly, so the web-crash class stays closed.
 */

import React from "react";
import {
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from "react-native-gesture-handler";

export interface WebSafeGestureDetectorProps {
  /** Gesture built via `Gesture.Pan()` etc. Used on native only. */
  gesture: ComposedGesture | GestureType;
  /** Exactly one React element child (gesture-handler requirement). */
  children: React.ReactElement;
}

/**
 * Native: delegates to the real `<GestureDetector>`. The reanimated `useEvent`
 * path it triggers exists on native, so this is safe and behaviourally
 * unchanged from a bare `<GestureDetector>`.
 */
export const WebSafeGestureDetector = ({
  gesture,
  children,
}: WebSafeGestureDetectorProps): React.ReactElement => {
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
};

export default WebSafeGestureDetector;
