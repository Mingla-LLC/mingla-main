import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  AccessibilityInfo,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
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
  /**
   * #1609 — the poster photo box. MUST be an axis-free absolute fill
   * (`StyleSheet.absoluteFillObject`), never a `flex: <ratio>` style.
   *
   * #1593's defect was one flex-axis style (`flex: 0.88`) shared by this poster
   * box and the face tree's hero hole under two different sibling sets, so Yoga
   * resolved them to 689.00pt and 667.67pt and the 21.33pt overhang bled through
   * the face tray. #1593 repaired it by MEASURING the face hole and copying the
   * number over here via a `heroHoleHeight` prop.
   *
   * That plumbing is deleted. A full-bleed hero has no flex axis to disagree
   * about: `cardInner` is `flex: 1` with a definite height in both trees, so an
   * absolute fill resolves to exactly `cardInner`'s box in both, independent of
   * siblings, with no measurement and no runtime coupling at all.
   * See I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE.
   */
  posterHeroStyle: StyleProp<ViewStyle>;
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
              <View style={props.posterHeroStyle}>{card.poster}</View>
            </View>
          </Animated.View>
        ))}
        {props.children(controller)}
      </>
    );
  },
));
