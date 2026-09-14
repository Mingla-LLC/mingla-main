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
 * Until the chunk is in memory this renders nothing, exactly like a body that has
 * no terms to show (Rule 9: missing is hidden, never faked). If the chunk cannot
 * load, the next mount tries again. Props, output and accessibility are the
 * ladder's own: this file adds no copy.
 */

import React, { useEffect, useState } from "react";

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

export const LazyOfferingRefundLadder: React.FC<OfferingRefundLadderProps> = (props) => {
  const [ladderModule, setLadderModule] = useState(loadedLadder);

  useEffect(() => {
    if (ladderModule !== undefined) return undefined;
    let live = true;
    loadOfferingRefundLadder().then(
      (module) => {
        if (live) setLadderModule(module);
      },
      () => undefined,
    );
    return (): void => {
      live = false;
    };
  }, [ladderModule]);

  if (ladderModule === undefined) return null;
  const { OfferingRefundLadder } = ladderModule;
  return <OfferingRefundLadder {...props} />;
};
