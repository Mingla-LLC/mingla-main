import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import type { BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatFileSize } from "../../utils/formatMediaDuration";
import { MediaThumb } from "../media/MediaThumb";

interface Props {
  item: BrandGroupMediaRow;
  name: string;
  sizeBytes: number | null;
  mine: boolean;
  thumbStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<TextStyle>;
  mineFooterStyle?: StyleProp<TextStyle>;
}

/** The real media-message body shared by the thread and its render proof. */
export function BrandGroupMediaBubble({
  item,
  name,
  sizeBytes,
  mine,
  thumbStyle,
  footerStyle,
  mineFooterStyle,
}: Props): React.ReactElement {
  const { t } = useTranslation("brandGroupMedia");
  return (
    <>
      <MediaThumb item={item} bubble style={thumbStyle} />
      <Text style={[styles.footer, footerStyle, mine && mineFooterStyle]} numberOfLines={1}>
        {name} · {formatFileSize(sizeBytes, (key, variables) => t(key, variables))}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  footer: { fontSize: 11, paddingHorizontal: 10, paddingVertical: 7 },
});
