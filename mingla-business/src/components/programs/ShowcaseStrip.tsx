/**
 * #3872 — creator showcase thumbnails. Tapping one plays it full screen
 * through the public showcase link (verified creators only).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FullScreenVideoViewer } from "../ui/FullScreenVideoViewer";
import { Icon } from "../ui/Icon";
import { showcasePlayback } from "../../services/creatorGigsService";
import { accent, radius, spacing, text as textTokens } from "../../constants/designSystem";

const TILE_TONES = ["#5b3a22", "#2c4b55", "#4a2f45"];

export function ShowcaseStrip({
  items,
  creatorName,
  size = "row",
}: {
  items: ReadonlyArray<{ media_id: string; thumb?: string | null }>;
  creatorName: string;
  size?: "row" | "large";
}): React.ReactElement | null {
  const [uri, setUri] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  if (items.length === 0) return null;
  const play = async (id: string) => {
    setLoadingId(id);
    setFailedId(null);
    try {
      setUri(await showcasePlayback(id));
    } catch {
      setFailedId(id);
    } finally {
      setLoadingId(null);
    }
  };
  const shown = items.slice(0, size === "large" ? 4 : 3);
  return (
    <View>
      <View style={styles.row}>
        {shown.map((item, index) => (
          <Pressable
            key={item.media_id}
            onPress={() => void play(item.media_id)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${creatorName}'s showcase video ${index + 1}`}
            style={[styles.tile, size === "large" ? styles.tileLarge : styles.tileRow, { backgroundColor: TILE_TONES[index % TILE_TONES.length] }]}
          >
            {loadingId === item.media_id ? <ActivityIndicator color={textTokens.primary} /> : <Icon name="play" size={size === "large" ? 26 : 18} color={textTokens.primary} />}
          </Pressable>
        ))}
      </View>
      {failedId ? <Text style={styles.failed}>This video isn't available right now.</Text> : null}
      <FullScreenVideoViewer uri={uri} title={`${creatorName}'s showcase`} onClose={() => setUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  tile: { borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: accent.tint },
  tileRow: { width: 64, aspectRatio: 9 / 13 },
  tileLarge: { flex: 1, aspectRatio: 9 / 14 },
  failed: { color: textTokens.tertiary, fontSize: 12, marginTop: spacing.xs },
});
