import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { useBusinessMediaTranslation } from "../../i18n";
import type { BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatFileSize } from "../../utils/formatMediaDuration";

interface Props {
  item: BrandGroupMediaRow;
  name: string;
  sizeBytes: number | null;
  mine: boolean;
  renderThumbnail: (item: BrandGroupMediaRow, style?: StyleProp<ViewStyle>, bubble?: boolean) => React.ReactNode;
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
  renderThumbnail,
  thumbStyle,
  footerStyle,
  mineFooterStyle,
}: Props): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  return (
    <>
      {renderThumbnail(item, thumbStyle, true)}
      <Text style={[styles.footer, footerStyle, mine && mineFooterStyle]} numberOfLines={1}>
        {name} · {formatFileSize(sizeBytes, (key, variables) => t(key, variables))}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  footer: { fontSize: 11, paddingHorizontal: 10, paddingVertical: 7 },
});
