/**
 * LazyOfferingRefundLadder — issue #3284 [bundle budget]. The cancellation-policy
 * ladder in its own chunk.
 *
 * The three public offering bodies (event, experience, trip) show the ladder. On
 * business web those bodies sit in `__common`, the boot payload every visitor
 * downloads (ORCH-1083), and the ladder grew with #3284's event and experience
 * copy. So the bodies import this owner and the ladder loads through a dynamic
 * `import()`.
 *
 * The load starts when a body first mounts the ladder, never when this module is
 * evaluated: on business web the offering bodies are evaluated at boot on every
 * route, so a module-level load would fetch the ladder for visitors who never see
 * it. Once the chunk is in memory, every later mount renders the real ladder on
 * its first frame. Metro resolves `LazyOfferingRefundLadder.native.tsx` for
 * iOS/Android so native never crosses this web-only chunk boundary.
 *
 * Until then the section reserves the ladder's height (`reservedLadderHeight`),
 * built from the ladder's own metrics and from the props it will render, so the
 * content below it (the experience price card, the trip payment choice) does not
 * move when the ladder arrives. When the ladder would render nothing, nothing is
 * reserved. A chunk that fails to load gives the space back and the next mount
 * tries again. This file adds no copy.
 */

import React, { useEffect, useState } from "react";
import { View } from "react-native";

import type { FollowerCountLineProps } from "./FollowerCountLine";
import type { OfferingRefundLadderProps } from "./OfferingRefundLadder";
import type { SaleAvailabilityTextProps } from "./SaleAvailabilityText";
import { reservedLadderHeight } from "./offeringRefundLadderReservation";

export { reservedLadderHeight } from "./offeringRefundLadderReservation";

type OfferingRefundLadderModule = typeof import("./OfferingRefundLadder");

let loadedLadder: OfferingRefundLadderModule | undefined;
let pendingLadder: Promise<OfferingRefundLadderModule> | undefined;

const DeferredFollowerCountLine = React.lazy(async () => {
  const module = await import("./FollowerCountLine");
  return { default: module.FollowerCountLine };
});

const DeferredSaleAvailabilityText = React.lazy(async () => {
  const module = await import("./SaleAvailabilityText");
  return { default: module.SaleAvailabilityText };
});

/** Load the ladder chunk once. A failed load is forgotten, so the next call retries. */
export const loadOfferingRefundLadder =
  (): Promise<OfferingRefundLadderModule> => {
    if (loadedLadder !== undefined) return Promise.resolve(loadedLadder);
    pendingLadder ??= import("./OfferingRefundLadder").then(
      (module) => (loadedLadder = module),
      (error: unknown) => {
        pendingLadder = undefined;
        throw error;
      },
    );
    return pendingLadder;
  };

export const LazyOfferingRefundLadder = (props: OfferingRefundLadderProps) => {
  const [ladderModule, setLadderModule] = useState(loadedLadder);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ladderModule !== undefined) return undefined;
    let live = true;
    loadOfferingRefundLadder().then(
      (module) => {
        if (live) setLadderModule(module);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return (): void => {
      live = false;
    };
  }, [ladderModule]);

  if (ladderModule !== undefined) {
    const { OfferingRefundLadder } = ladderModule;
    return <OfferingRefundLadder {...props} />;
  }
  const height = failed ? 0 : reservedLadderHeight(props);
  return height > 0 ? <View style={{ height }} /> : null;
};

/** Keep secondary social proof out of the eager public-page payload. */
export function LazyFollowerCountLine(props: FollowerCountLineProps) {
  return (
    <React.Suspense fallback={null}>
      <DeferredFollowerCountLine {...props} />
    </React.Suspense>
  );
}

/** Keep secondary sale urgency copy out of the eager public-page payload. */
export function LazySaleAvailabilityText(props: SaleAvailabilityTextProps) {
  return (
    <React.Suspense fallback={null}>
      <DeferredSaleAvailabilityText {...props} />
    </React.Suspense>
  );
}
