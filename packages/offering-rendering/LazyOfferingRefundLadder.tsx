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
 * its first frame. On native the ladder is in the same bundle and the import
 * resolves at once.
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

import type { OfferingRefundLadderProps } from "./OfferingRefundLadder";

type OfferingRefundLadderModule = typeof import("./OfferingRefundLadder");

let loadedLadder: OfferingRefundLadderModule | undefined;
let pendingLadder: Promise<OfferingRefundLadderModule> | undefined;

/** Load the ladder chunk once. A failed load is forgotten, so the next call retries. */
export const loadOfferingRefundLadder = (): Promise<OfferingRefundLadderModule> => {
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

/**
 * The height OfferingRefundLadder takes for these props, from its own styles:
 * section margin 24; title 20px (line 24) + 12; a strip is 14 + 12×2 padding +
 * one 18px line (19 when its 15px check glyph shows); rows 8 + (7×2 + one 13px
 * line) each, with a 1px rule between rows; the closing note 12 + 18. A default
 * line is 1.2× its font size, and every text is taken as one line.
 */
export function reservedLadderHeight({
  policy,
  bookingDeadline = null,
  offeringType = "trip",
  isPaid = true,
}: OfferingRefundLadderProps): number {
  const isTrip = offeringType === "trip";
  const tiers = policy?.tiers ?? [];
  const final = !isTrip && tiers.length > 0 && tiers.every((t) => t.refund_pct === 0);
  const disclosure = !isTrip && policy === null && isPaid;
  const deadline = isTrip && Number.isFinite(Date.parse(bookingDeadline ?? ""));
  if (policy === null && !deadline && !disclosure) return 0;
  return (
    60 +
    (policy === null ? 0 : final ? 56 : 57) +
    (disclosure ? 56 : 0) +
    (tiers.length > 0 && !final ? 7 + tiers.length * 30.6 : 0) +
    (!isTrip && policy !== null && !final ? 30 : 0) +
    (deadline ? 57 : 0)
  );
}

export const LazyOfferingRefundLadder: React.FC<OfferingRefundLadderProps> = (props) => {
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
