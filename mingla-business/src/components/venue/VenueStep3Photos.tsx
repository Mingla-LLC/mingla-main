/**
 * Ve1 wizard — Step 3: Photos (local URIs; first image becomes cover after create).
 */

import React, { useCallback, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export interface VenueStep3PhotosProps {
  showErrors: boolean;
}

export const VenueStep3Photos: React.FC<VenueStep3PhotosProps> = ({
  showErrors,
}) => {
  const photoUris = useDraftVenueStore((s) => s.photoUris);
  const patch = useDraftVenueStore((s) => s.patch);
  const [busy, setBusy] = useState(false);

  const pickPhotos = useCallback(async (): Promise<void> => {
    if (busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: Platform.OS !== "web",
        selectionLimit: 8,
        quality: 0.9,
      });
      if (result.canceled || result.assets.length === 0) return;
      const next = result.assets.map((a) => a.uri);
      patch({ photoUris: [...photoUris, ...next] });
    } finally {
      setBusy(false);
    }
  }, [busy, photoUris, patch]);

  const err =
    showErrors && photoUris.length < 1
      ? "Add at least one photo."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Photos</Text>
      <Text style={styles.helper}>
        Add at least one image. The first photo becomes your profile cover.
      </Text>
      <Button
        label={busy ? "Opening…" : "Add photos"}
        onPress={() => void pickPhotos()}
        variant="secondary"
        size="md"
        leadingIcon="upload"
        disabled={busy}
      />
      {err !== undefined ? <Text style={styles.err}>{err}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {photoUris.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable
                style={styles.remove}
                onPress={() =>
                  patch({ photoUris: photoUris.filter((u) => u !== uri) })
                }
                accessibilityLabel="Remove photo"
                hitSlop={8}
              >
                <Icon name="x" size={16} color="#FFF" />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  thumbWrap: {
    position: "relative",
  },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
  },
  remove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default VenueStep3Photos;
