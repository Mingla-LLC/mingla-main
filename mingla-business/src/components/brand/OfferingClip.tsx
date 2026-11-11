/**
 * #4389 — an offering row's backdrop on web (and in node test runs): the
 * poster frame only. The iPhone and Android build (`OfferingClip.native.tsx`)
 * plays the looping clip.
 */
import React from "react";
import { Image, StyleSheet } from "react-native";

export interface OfferingClipProps {
  video: number;
  poster: number;
  /** The screen is focused and the app is in the foreground. */
  active: boolean;
}

export const OfferingClip: React.FC<OfferingClipProps> = ({ poster }) => (
  <Image source={poster} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
);
