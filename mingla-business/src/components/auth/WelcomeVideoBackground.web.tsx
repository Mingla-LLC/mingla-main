import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image,
  StyleSheet,
  View,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

const LANDSCAPE_VIDEO = require("../../../assets/welcome/mingla-welcome-landscape.mp4");
const LANDSCAPE_POSTER = require("../../../assets/welcome/mingla-welcome-landscape-poster.jpg");

type NetworkInformation = {
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export function WelcomeVideoBackground() {
  const motionQuery = useRef(
    typeof window === "undefined"
      ? null
      : window.matchMedia("(prefers-reduced-motion: reduce)"),
  ).current;
  const connection =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { connection?: NetworkInformation }).connection;
  const [accessibilityReduceMotion, setAccessibilityReduceMotion] =
    useState<boolean | null>(null);
  const [browserReduceMotion, setBrowserReduceMotion] = useState(
    motionQuery?.matches ?? true,
  );
  const [saveData, setSaveData] = useState(Boolean(connection?.saveData));
  const reduceMotion = accessibilityReduceMotion !== false || browserReduceMotion;
  const [isActive, setIsActive] = useState(AppState.currentState === "active");
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);
  const loadedRef = useRef(false);
  const eligibleRef = useRef(false);
  const warnedRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  const failSafely = useCallback(
    (reason: "load" | "playback") => {
      if (!mountedRef.current) return;
      eligibleRef.current = false;
      setFailed(true);
      opacity.stopAnimation();
      opacity.setValue(0);
      try { player.pause(); } catch { /* poster remains available */ }
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[welcome-video][host-web] ${reason}`);
      }
    },
    [opacity, player],
  );

  useEffect(() => {
    mountedRef.current = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mountedRef.current && setAccessibilityReduceMotion(enabled))
      .catch(() => mountedRef.current && setAccessibilityReduceMotion(false));
    const accessibilitySubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setAccessibilityReduceMotion,
    );
    const onMotionChange = (event: MediaQueryListEvent) => setBrowserReduceMotion(event.matches);
    const onConnectionChange = () => setSaveData(Boolean(connection?.saveData));
    motionQuery?.addEventListener("change", onMotionChange);
    connection?.addEventListener?.("change", onConnectionChange);
    const appSubscription = AppState.addEventListener("change", (next) => {
      setIsActive(next === "active");
    });
    return () => {
      mountedRef.current = false;
      accessibilitySubscription.remove();
      motionQuery?.removeEventListener("change", onMotionChange);
      connection?.removeEventListener?.("change", onConnectionChange);
      appSubscription.remove();
      opacity.stopAnimation();
    };
  }, [connection, motionQuery, opacity]);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") failSafely("playback");
    });
    return () => subscription.remove();
  }, [failSafely, player]);

  useEffect(() => {
    eligibleRef.current = !reduceMotion && !saveData && isActive && !failed;
    if (!eligibleRef.current) {
      opacity.stopAnimation();
      opacity.setValue(0);
      try { player.pause(); } catch { /* poster remains available */ }
      return;
    }
    if (loadedRef.current) {
      try { player.play(); } catch { failSafely("playback"); }
      return;
    }
    loadedRef.current = true;
    void player.replaceAsync(LANDSCAPE_VIDEO).then(() => {
      if (!mountedRef.current || !eligibleRef.current) return;
      try { player.play(); } catch { failSafely("playback"); }
    }).catch(() => failSafely("load"));
  }, [failed, failSafely, isActive, opacity, player, reduceMotion, saveData]);

  const revealVideo = useCallback(() => {
    if (!eligibleRef.current) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Image source={LANDSCAPE_POSTER} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          playsInline
          onFirstFrameRender={revealVideo}
          accessible={false}
        />
      </Animated.View>
    </View>
  );
}
