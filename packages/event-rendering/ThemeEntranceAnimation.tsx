import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import LottieView from "lottie-react-native";
import { LOTTIE_BY_SLUG } from "@mingla/theme-animations";

import type { ResolvedTheme } from "./designTokens";

interface ThemeEntranceAnimationProps {
  theme: ResolvedTheme;
  sessionKey: string;
  replayOnMount?: boolean;
}

const playedSessionKeys = new Set<string>();

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = ({
  theme,
  sessionKey,
  replayOnMount = false,
}) => {
  const mountIdRef = useRef<string>(`${Date.now()}:${Math.random()}`);
  const mountedKey = replayOnMount
    ? `${sessionKey}:${theme.animation}:${mountIdRef.current}`
    : `${sessionKey}:${theme.animation}`;
  const [shouldPlay, setShouldPlay] = useState<boolean>(() => {
    return theme.animation !== "none" && !playedSessionKeys.has(mountedKey);
  });
  const animationRef = useRef<LottieView>(null);

  useEffect(() => {
    if (theme.animation === "none" || playedSessionKeys.has(mountedKey)) {
      setShouldPlay(false);
      return;
    }
    playedSessionKeys.add(mountedKey);
    setShouldPlay(true);
  }, [mountedKey, theme.animation]);

  if (!shouldPlay || theme.animation === "none") return null;

  return (
    <View
      pointerEvents="none"
      style={styles.wrap}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LottieView
        ref={animationRef}
        source={LOTTIE_BY_SLUG[theme.animation]}
        autoPlay
        loop={false}
        resizeMode="cover"
        colorFilters={[{ keypath: "**", color: theme.color }]}
        style={styles.animation}
        onAnimationFinish={() => setShouldPlay(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  animation: {
    width: "100%",
    height: "100%",
  },
});
