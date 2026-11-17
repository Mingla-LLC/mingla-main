/**
 * #4382 Wave 4 — screenshots in Host support: the picked-image strip used by
 * the new-request form and the composer, and the full-size viewer used in
 * the thread (signed links that last one hour).
 */

import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  color,
  radius,
  scrim,
  space,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { MAX_SUPPORT_IMAGES, supportCopy, type SupportPickedImage } from "./supportRequestModel";

export interface SupportImageStripProps {
  images: readonly SupportPickedImage[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export const SupportImageStrip: React.FC<SupportImageStripProps> = ({
  images,
  onAdd,
  onRemove,
  disabled = false,
}) => (
  <View style={styles.strip}>
    {images.map((image, index) => (
      <View key={`${image.uri}-${index}`} style={styles.thumb}>
        <Image source={{ uri: image.uri }} style={styles.thumbImage} resizeMode="cover" />
        {!disabled ? (
          <Pressable
            onPress={() => onRemove(index)}
            accessibilityRole="button"
            accessibilityLabel={supportCopy("form.remove_image", { index: index + 1 })}
            hitSlop={8}
            style={styles.thumbRemove}
          >
            <Icon name="close" size={12} color={color.text1} />
          </Pressable>
        ) : null}
      </View>
    ))}
    {images.length < MAX_SUPPORT_IMAGES ? (
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={supportCopy("form.add_images")}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.addTile, pressed && styles.pressed, disabled && styles.disabled]}
      >
        <Icon name="plus" size={20} color={color.text2} />
      </Pressable>
    ) : null}
  </View>
);

export interface SupportImageViewerProps {
  url: string | null;
  onClose: () => void;
}

/** Full-size view of one screenshot. `url` null hides the viewer. */
export const SupportImageViewer: React.FC<SupportImageViewerProps> = ({ url, onClose }) => {
  const [failed, setFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    setFailed(false);
    setLoading(true);
  }, [url]);
  return (
    <Modal visible={url !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={supportCopy("thread.image_close")}
          style={styles.viewerClose}
          hitSlop={12}
        >
          <Icon name="close" size={22} color={color.text1} />
        </Pressable>
        {url !== null && !failed ? (
          <Image
            source={{ uri: url }}
            style={styles.viewerImage}
            resizeMode="contain"
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
        ) : null}
        {loading && !failed ? <ActivityIndicator style={styles.viewerSpinner} color={color.text1} /> : null}
        {failed ? <Text style={styles.viewerError}>{supportCopy("thread.image_failed")}</Text> : null}
      </View>
    </Modal>
  );
};

const THUMB = 64;

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.xs,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.modal,
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  viewer: {
    flex: 1,
    backgroundColor: color.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerClose: {
    position: "absolute",
    top: 48,
    right: 20,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.step,
  },
  viewerImage: {
    width: "100%",
    height: "80%",
  },
  viewerSpinner: {
    position: "absolute",
  },
  viewerError: {
    color: color.text1,
    paddingHorizontal: space[6],
    textAlign: "center",
  },
});
