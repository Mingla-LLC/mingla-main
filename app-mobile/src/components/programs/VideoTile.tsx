import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../ui/Icon';
import { creatorMediaStatus, publicCreatorMedia } from '../../services/creatorMediaService';
import { programErrorText } from '../../services/programResult';

/** Play a reviewed public video (showcase, Local review) through the signed playback edge. */
export async function playPublicVideo(jobId: string): Promise<void> {
  try {
    const media = await publicCreatorMedia(jobId);
    await WebBrowser.openBrowserAsync(media.playback.url);
  } catch (error) {
    Alert.alert('Video unavailable', programErrorText(error));
  }
}

/** Play one of your own videos (delivery, showcase) once it has processed. */
export async function playOwnVideo(jobId: string): Promise<void> {
  try {
    const media = await creatorMediaStatus(jobId);
    if (!media.playback?.url) { Alert.alert('Still processing', 'Your video is still processing. Try again in a minute.'); return; }
    await WebBrowser.openBrowserAsync(media.playback.url);
  } catch (error) {
    Alert.alert('Video unavailable', programErrorText(error));
  }
}

const GRADIENTS: Array<[string, string]> = [
  ['#7a3b16', '#2a1710'],
  ['#2c4a63', '#121c26'],
  ['#4b2c73', '#1b1229'],
  ['#2f5a45', '#10201a'],
];

/**
 * #3872 — a vertical video tile: the real thumbnail when the server has one,
 * otherwise a calm gradient. Tapping plays through the signed playback edge
 * (the caller owns that call).
 */
export function VideoTile({ label, thumbnail, onPress, index = 0, style, accessibilityLabel }: {
  label?: string | null; thumbnail?: string | null; onPress?: () => void; index?: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}): React.ReactElement {
  const colors = GRADIENTS[index % GRADIENTS.length];
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (label ? `Play ${label}` : 'Play video')} disabled={!onPress} onPress={onPress}
    style={({ pressed }) => [styles.tile, style, pressed && styles.pressed]}>
    {thumbnail ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      : <LinearGradient colors={colors} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} />}
    <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.shade} />
    <View style={styles.play}><Icon name="play" size={20} color="#ffffff" /></View>
    {label ? <Text style={styles.label} numberOfLines={2}>{label}</Text> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  tile: { flex: 1, aspectRatio: 9 / 16, maxHeight: 190, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d1a19', justifyContent: 'center', alignItems: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  label: { position: 'absolute', left: 8, right: 8, bottom: 8, color: '#ffffff', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.85 },
});
