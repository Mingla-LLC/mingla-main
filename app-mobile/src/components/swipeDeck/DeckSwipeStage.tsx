import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  AccessibilityInfo,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { posterPhotoBoxOverride } from './deckPosterGeometry';
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
  heroHoleHeight: number | null;
  children: (controller: DeckSwipeController) => React.ReactNode;
}

/**
 * The isolated gesture owner. Nominal phase transitions stay ref-only, so
 * neither this boundary nor the native handler subtree re-renders for
 * DRAGGING → EXITING → COMMITTING → IDLE. Only delayed-anomaly UI is stateful.
 */
export const DeckSwipeStage = memo(forwardRef<DeckSwipeStageHandle, DeckSwipeStageProps>(
  function DeckSwipeStage(props, ref) {
    const controller = useDeckSwipeController(props);
    const delayedAnnouncementSentRef = useRef(false);

    // #1593 — single-source the poster photo box off the face tree's own measured
    // hero hole. Role-scoped on purpose; see deckPosterGeometry.ts.
    const posterPhotoBox = useMemo(() => ({
      current: posterPhotoBoxOverride('current', props.heroHoleHeight),
      behind: posterPhotoBoxOverride('behind', props.heroHoleHeight),
    }), [props.heroHoleHeight]);

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
                ? [controller.previewCardStyle, {
                    zIndex: 0,
                    elevation: 0,
                  }]
                : [controller.currentCardStyle, {
                    zIndex: 2,
                    elevation: 2,
                  }],
            ]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={props.cardInnerStyle}>
              <View style={[props.imageContainerStyle, posterPhotoBox[card.role]]}>{card.poster}</View>
            </View>
          </Animated.View>
        ))}
        {props.children(controller)}
      </>
    );
  },
));
