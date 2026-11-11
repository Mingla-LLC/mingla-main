/**
 * #4389 addendum 2 — an offering row's silent looping clip (expo-video).
 *
 *   - muted, looped, no audio session (it never interrupts the host's music);
 *   - plays only while the screen is focused and the app is in the
 *     foreground (`active`); paused otherwise;
 *   - the poster frame under Reduce Motion, before the first frame, or if the
 *     clip fails to load or play.
 */
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Image, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  isVideoPlayerReleasedForReload,
  registerVideoPlayerForReload,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";

import type { OfferingClipProps } from "./OfferingClip";

export const OfferingClip: React.FC<OfferingClipProps> = ({ video, poster, active }) => {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(video, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.audioMixingMode = "mixWithOthers";
  });

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setReduceMotion(on))
      .catch(() => alive && setReduceMotion(true));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // #2107 — an in-app restart releases the player before reloadAsync.
  useEffect(() => registerVideoPlayerForReload(player), [player]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "error") {
        setFailed(true);
        console.warn("[offering-clip] playback failed; showing the poster");
      } else if (status === "readyToPlay") {
        setReady(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  const play = active && reduceMotion === false && !failed;
  useEffect(() => {
    if (isVideoPlayerReleasedForReload(player)) return;
    try {
      if (play) player.play();
      else player.pause();
    } catch (error) {
      setFailed(true);
      console.warn("[offering-clip] could not control playback", error);
    }
  }, [play, player]);

  return (
    <>
      <Image source={poster} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      {play && ready ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          accessible={false}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
};
