/**
 * #4304 part 2 — native bubble gestures, ported from the Explorer chats
 * (app-mobile components/chat/SwipeableMessage.tsx + DoubleTapHeart.tsx):
 * swipe right to reply, double-tap to heart. Web and the node render proofs
 * use BrandGroupBubbleGestures.tsx, which adds neither (web uses the "⋯" menu
 * and right-click instead).
 */
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { Icon } from "../ui/Icon";

const TRIGGER = 60;
const MAX_TRANSLATE = 80;

export function BrandGroupBubbleGestures({
  children,
  onReply,
  onDoubleTap,
  enabled = true,
}: {
  children: React.ReactNode;
  onReply: () => void;
  onDoubleTap: () => void;
  enabled?: boolean;
}): React.ReactElement {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const reply = useCallback((): void => {
    HapticFeedback.buttonPress();
    onReply();
  }, [onReply]);
  const thresholdHaptic = useCallback((): void => HapticFeedback.selectionEnter(), []);
  const heart = useCallback((): void => {
    HapticFeedback.success();
    onDoubleTap();
  }, [onDoubleTap]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-1000, 12])
    .failOffsetY([-15, 15])
    .onUpdate((event) => {
      const clamped = Math.min(Math.max(event.translationX, 0), MAX_TRANSLATE);
      translateX.value = clamped;
      if (clamped >= TRIGGER && !triggered.value) {
        triggered.value = true;
        runOnJS(thresholdHaptic)();
      } else if (clamped < TRIGGER) {
        triggered.value = false;
      }
    })
    .onEnd(() => {
      if (translateX.value >= TRIGGER) runOnJS(reply)();
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      triggered.value = false;
    });

  const doubleTap = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      heartOpacity.value = 1;
      heartScale.value = withSpring(1.2, { damping: 12, stiffness: 180 });
      heartOpacity.value = withDelay(400, withTiming(0, { duration: 300 }));
      heartScale.value = withDelay(400, withTiming(1.4, { duration: 300 }));
      heartScale.value = withDelay(700, withTiming(0, { duration: 0 }));
      runOnJS(heart)();
    });

  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, 40], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(translateX.value, [0, TRIGGER, MAX_TRANSLATE], [0.5, 1, 1.15], Extrapolation.CLAMP) }],
  }));
  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }],
  }));

  if (!enabled) return <>{children}</>;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.replyIcon, replyIconStyle]} pointerEvents="none">
        <View style={styles.replyCircle}>
          <Icon name="reply" size={16} color={brandGroupChat.textSecondary} />
        </View>
      </Animated.View>
      <GestureDetector gesture={Gesture.Simultaneous(pan, doubleTap)}>
        <Animated.View style={bubbleStyle}>
          {children}
          <Animated.View style={[styles.heart, heartStyle]} pointerEvents="none">
            <Icon name="heart" size={44} color={brandGroupChat.accent} />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative" },
  replyIcon: { position: "absolute", left: -40, top: 0, bottom: 0, justifyContent: "center" },
  replyCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.surfaceRaised },
  heart: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 10 },
});
