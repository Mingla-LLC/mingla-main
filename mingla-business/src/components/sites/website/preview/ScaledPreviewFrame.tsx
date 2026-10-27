import React, { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { WebView } from "react-native-webview";
import {
  previewCornerRadius,
  previewDimensions,
  previewScale,
  PREVIEW_DEVICE_LABELS,
  type PreviewDevicePreference,
} from "../../../../sites/previewDevice";

/*
 * #2829 W9r — the draft at a simulated device size on iOS/Android: a WebView
 * laid out at the device's CSS width and scaled to fit (native only; web
 * uses the iframe in ScaledPreviewFrame.web.tsx). Unsaved colour changes show
 * after Save on native (the web frame previews them live).
 */
export type ScaledPreviewFrameProps = {
  url: string;
  preference: PreviewDevicePreference;
  maxHeight?: number;
  fill?: boolean;
  tokenDeclarations?: readonly string[] | null;
  onLoad?: () => void;
};

export function ScaledPreviewFrame({ url, preference, maxHeight = 560, fill = false, onLoad }: ScaledPreviewFrameProps): React.ReactElement {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const { width, height } = previewDimensions(preference);
  const scale = previewScale({ paneWidth: box.width, maxHeight: fill ? box.height : maxHeight, width, height });
  const left = Math.max(0, (box.width - width * scale) / 2);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setBox((previous) => (previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height }));
  };
  return (
    <View onLayout={onLayout} style={[styles.stage, fill ? styles.fill : { height: Math.ceil(height * scale) || maxHeight }]} testID="preview-stage">
      <View
        style={[styles.viewport, {
          width,
          height,
          borderRadius: previewCornerRadius(preference.device),
          transform: [{ translateX: left - (width - width * scale) / 2 }, { translateY: -(height - height * scale) / 2 }, { scale }],
        }]}
        testID="preview-viewport"
      >
        <WebView
          source={{ uri: url }}
          style={styles.web}
          onLoadEnd={onLoad}
          sharedCookiesEnabled={false}
          setSupportMultipleWindows={false}
          accessibilityLabel={`Draft preview of your website at ${PREVIEW_DEVICE_LABELS[preference.device].toLowerCase()} size`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { position: "relative", overflow: "hidden", width: "100%", borderRadius: 12, backgroundColor: "rgba(255,255,255,0.02)" },
  fill: { flex: 1, minHeight: 200 },
  viewport: { position: "absolute", top: 0, left: 0, overflow: "hidden", backgroundColor: "#ffffff" },
  web: { flex: 1, backgroundColor: "#ffffff" },
});
