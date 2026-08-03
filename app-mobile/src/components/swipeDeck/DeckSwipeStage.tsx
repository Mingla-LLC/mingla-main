import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import type { DeckSwipeDirection } from './deckSwipeLifecycle';
import {
  useDeckSwipeController,
  type DeckSwipeController,
  type UseDeckSwipeControllerOptions,
} from './useDeckSwipeController';

export interface DeckSwipeStageHandle {
  invalidate: (reason: string) => void;
  requestSwipe: (direction: DeckSwipeDirection) => boolean;
  requestTapExpand: () => boolean;
}

interface DeckSwipeStageProps extends UseDeckSwipeControllerOptions {
  transitionDelayAnnouncement: string;
  children: (controller: DeckSwipeController) => React.ReactNode;
}

/**
 * The only React owner of gesture phase. Parent deck/provider/history consumers
 * do not render for DRAGGING → EXITING → COMMITTING → IDLE transitions.
 */
export const DeckSwipeStage = memo(forwardRef<DeckSwipeStageHandle, DeckSwipeStageProps>(
  function DeckSwipeStage(props, ref) {
    const controller = useDeckSwipeController(props);
    const synchronizeActiveCardLayout = controller.synchronizeActiveCardLayout;
    const delayedAnnouncementSentRef = useRef(false);

    useImperativeHandle(ref, () => ({
      invalidate: controller.invalidate,
      requestSwipe: controller.requestSwipe,
      requestTapExpand: controller.requestTapExpand,
    }), [controller.invalidate, controller.requestSwipe, controller.requestTapExpand]);

    useEffect(() => {
      if (!controller.isTransitionDelayed) {
        delayedAnnouncementSentRef.current = false;
        return;
      }
      if (delayedAnnouncementSentRef.current) return;
      delayedAnnouncementSentRef.current = true;
      AccessibilityInfo.announceForAccessibility(props.transitionDelayAnnouncement);
    }, [controller.isTransitionDelayed, props.transitionDelayAnnouncement]);

    useLayoutEffect(() => {
      if (props.activeCardId) {
        synchronizeActiveCardLayout(props.activeCardId);
      }
    }, [props.activeCardId, synchronizeActiveCardLayout]);

    return props.children(controller);
  },
));
