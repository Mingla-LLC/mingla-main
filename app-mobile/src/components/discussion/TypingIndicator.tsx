import React, { useEffect, useRef } from "react";
import {
  Text,
  View,
  Animated,
  LayoutAnimation,
  StyleSheet,
} from "react-native";
import { colors, typography } from "../../constants/designSystem";

interface TypingIndicatorProps {
  userNames: string[];
}

function TypingIndicator({ userNames }: TypingIndicatorProps) {
  const prevLengthRef = useRef(userNames.length);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (userNames.length !== prevLengthRef.current) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      prevLengthRef.current = userNames.length;
    }
  }, [userNames.length]);

  useEffect(() => {
    if (userNames.length === 0) return;

    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );

    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);

    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [userNames.length, dot1, dot2, dot3]);

  if (userNames.length === 0) return null;

  let label: string;
  if (userNames.length === 1) {
    label = `${userNames[0]} is typing`;
  } else if (userNames.length === 2) {
    label = `${userNames[0]} and ${userNames[1]} are typing`;
  } else {
    label = "Several people are typing";
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
      <Animated.Text style={[styles.dot, { opacity: dot1 }]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, { opacity: dot2 }]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, { opacity: dot3 }]}>.</Animated.Text>
    </View>
  );
}

export default TypingIndicator;

const styles = StyleSheet.create({
  container: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  text: {
    ...typography.xs,
    color: colors.gray[500],
  },
  dot: {
    ...typography.xs,
    color: colors.gray[500],
    fontWeight: "700",
  },
});
