// #4270: when a sheet has really gone. Shared by the bottom sheet and the wide web card.
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * Report when a sheet has really gone, for a caller that opens something else
 * next (W4 retest P0-1, P2-A). iOS shows one native modal at a time and drops a
 * second one presented while the first is still up, so a timer is not enough
 * on a busy phone. On iOS the sheet's Modal stays in the tree with
 * visible=false until UIKit has dismissed it; React Native's Modal waits for
 * that and then calls onDismiss (`onModalDismiss` here). Elsewhere the sheet
 * has gone once it has unmounted. A sheet without `onDismissed` keeps its old
 * path exactly: `waiting` stays false and nothing is called.
 */
export const useSheetGone = (
  mounted: boolean,
  onDismissed: (() => void) | undefined,
): { waiting: boolean; onModalDismiss: (() => void) | undefined } => {
  const callback = useRef(onDismissed);
  callback.current = onDismissed;
  const waitForModal = Platform.OS === "ios" && onDismissed !== undefined;
  // True until the sheet has been open once, and again once iOS has dismissed it.
  const [dismissed, setDismissed] = useState(true);
  const told = useRef(true);
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (mounted) {
      told.current = false;
      // Only a sheet that waits for iOS keeps this state, so no other sheet re-renders.
      if (waitForModal) setDismissed(false);
    } else if (wasMounted.current && !waitForModal) callback.current?.();
    wasMounted.current = mounted;
  }, [mounted, waitForModal]);
  return {
    waiting: waitForModal && !mounted && !dismissed,
    onModalDismiss: waitForModal
      ? (): void => {
          if (told.current) return;
          told.current = true;
          setDismissed(true);
          callback.current?.();
        }
      : undefined,
  };
};
