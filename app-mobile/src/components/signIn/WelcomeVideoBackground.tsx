import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

const PORTRAIT_VIDEO = require("../../../assets/welcome/mingla-welcome-portrait.mp4");
const PORTRAIT_POSTER = require("../../../assets/welcome/mingla-welcome-portrait-poster.jpg");
const FIRST_FRAME_FADE_MS = 200;

export function WelcomeVideoBackground() {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [isActive, setIsActive] = useState(AppState.currentState === "active");
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);
  const loadedRef = useRef(false);
  const eligibleRef = useRef(false);
  const warnedRef = useRef(false);
  const videoOpacity = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  const failSafely = useCallback(
    (reason: "load" | "playback") => {
      if (!mountedRef.current) return;
      eligibleRef.current = false;
      setFailed(true);
      videoOpacity.stopAnimation();
      videoOpacity.setValue(0);
      try {
        player.pause();
      } catch {
        // The fixed warning below is the bounded observable failure signal.
      }
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[welcome-video][explorer-${Platform.OS}] ${reason}`);
      }
    },
    [player, videoOpacity],
  );

  useEffect(() => {
    mountedRef.current = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mountedRef.current && setReduceMotion(enabled))
      .catch(() => mountedRef.current && setReduceMotion(false));
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mountedRef.current = false;
      subscription.remove();
      videoOpacity.stopAnimation();
    };
  }, [videoOpacity]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setIsActive(nextState === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") failSafely("playback");
    });
    return () => subscription.remove();
  }, [failSafely, player]);

  useEffect(() => {
    eligibleRef.current = reduceMotion === false && isActive && !failed;
    if (!eligibleRef.current) {
      videoOpacity.stopAnimation();
      videoOpacity.setValue(0);
      try {
        player.pause();
      } catch {
        // A disposed or unavailable decorative player stays on the poster.
      }
      return;
    }
    if (reduceMotion !== false) return;

    if (loadedRef.current) {
      try {
        player.play();
      } catch {
        failSafely("playback");
      }
      return;
    }

    loadedRef.current = true;
    void player
      .replaceAsync(PORTRAIT_VIDEO)
      .then(() => {
        if (!mountedRef.current || !eligibleRef.current) return;
        try {
          player.play();
        } catch {
          failSafely("playback");
        }
      })
      .catch(() => failSafely("load"));
  }, [failed, failSafely, isActive, player, reduceMotion, videoOpacity]);

  const revealVideo = useCallback(() => {
    if (failed || reduceMotion || !isActive) return;
    Animated.timing(videoOpacity, {
      toValue: 1,
      duration: FIRST_FRAME_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [failed, isActive, reduceMotion, videoOpacity]);

  const shouldRenderVideo = reduceMotion === false && isActive && !failed;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image
        source={PORTRAIT_POSTER}
        resizeMode="cover"
        accessible={false}
        style={StyleSheet.absoluteFill}
      />
      {shouldRenderVideo ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoOpacity }]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            surfaceType={Platform.OS === "android" ? "textureView" : undefined}
            onFirstFrameRender={revealVideo}
            accessible={false}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
