import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
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
  posterCards: {
    id: string;
    role: 'current' | 'behind';
    poster: React.ReactNode;
  }[];
  cardStyle: StyleProp<ViewStyle>;
  nextCardStyle: StyleProp<ViewStyle>;
  cardInnerStyle: StyleProp<ViewStyle>;
  imageContainerStyle: StyleProp<ViewStyle>;
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

    return (
      <>
        {/* Same keyed host/image subtree survives behind -> current promotion. */}
        {props.posterCards.map((card) => (
          <Animated.View
            key={card.id}
            testID={`deck-poster-resource-${card.id}`}
            style={[
              props.cardStyle,
              card.role === 'behind' ? props.nextCardStyle : null,
              card.role === 'behind'
                ? {
                    zIndex: 0,
                    elevation: 0,
                    opacity: controller.previewOpacity,
                    transform: [{ scale: controller.previewScale }],
                  }
                : {
                    zIndex: 2,
                    elevation: 2,
                    transform: [
                      { translateX: controller.positionX },
                      { translateY: controller.positionY },
                      { rotate: controller.rotate },
                    ],
                  },
            ]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={props.cardInnerStyle}>
              <View style={props.imageContainerStyle}>{card.poster}</View>
            </View>
          </Animated.View>
        ))}
        {props.children(controller)}
      </>
    );
  },
));
