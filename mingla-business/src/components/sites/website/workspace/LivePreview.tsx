import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { WebView } from "react-native-webview";
import { color } from "../../../../constants/designSystem";
import { previewDimensions, PREVIEW_DEVICE_LABELS } from "../../../../sites/previewDevice";
import { NATIVE_BRIDGE_LISTENER, nativeBridgeCall, stageFrame } from "../../../../sites/previewBridge";
import { usePreviewFrames, type FrameMessage, type PreviewCommands } from "./usePreviewFrames";
import type { LivePreviewProps } from "./LivePreview.types";

/*
 * #4453 — the live draft on iOS and Android: a WebView at the device's CSS
 * width, scaled to the stage. The bridge talks through
 * `window.ReactNativeWebView.postMessage`; Host's commands are delivered by
 * a small injected listener. A saved change loads in a second WebView and
 * swaps in when ready (the same rule as web). A tapped section opens the Ari
 * card as a sheet, so nothing is drawn over the page here.
 */
export const LivePreview = React.forwardRef<PreviewCommands, LivePreviewProps>(function LivePreview(props, ref) {
  const { url, preference, editMode, marks, tokenDeclarations, onSelect, onReady } = props;
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const views = useRef(new Map<number, { injectJavaScript: (script: string) => void }>());
  const device = previewDimensions(preference);
  const frame = stageFrame(stage, device.width);

  const send = useCallback((key: number, message: FrameMessage) => {
    views.current.get(key)?.injectJavaScript(nativeBridgeCall(message));
  }, []);
  const preview = usePreviewFrames({ url, editMode, marks, tokenDeclarations, send, onSelect: (sectionId) => onSelect(sectionId), onReady });
  useImperativeHandle(ref, () => preview.commands, [preview.commands]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setStage((previous) => (previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height }));
  };
  const slots = [preview.swap.shown, preview.swap.loading].filter((slot): slot is NonNullable<typeof slot> => slot !== null);
  const scale = frame.scale || 1;
  return (
    <View onLayout={onLayout} style={styles.stage} testID="live-preview-stage">
      <View
        style={[styles.viewport, {
          width: frame.width,
          height: frame.height,
          opacity: frame.scale > 0 ? 1 : 0,
          transform: [
            { translateX: frame.left - (frame.width - frame.width * scale) / 2 },
            { translateY: -(frame.height - frame.height * scale) / 2 },
            { scale },
          ],
        }]}
        testID="live-preview-viewport"
      >
        {slots.map((slot) => {
          const visible = slot.key === preview.swap.shown?.key;
          return (
            <View key={slot.key} style={[StyleSheet.absoluteFill, visible ? null : styles.hidden]} pointerEvents={visible ? "auto" : "none"}>
              <WebView
                ref={(node) => {
                  if (node) views.current.set(slot.key, node as unknown as { injectJavaScript: (script: string) => void });
                  else views.current.delete(slot.key);
                }}
                source={{ uri: slot.url }}
                style={styles.web}
                injectedJavaScript={NATIVE_BRIDGE_LISTENER}
                onMessage={(event) => preview.onMessage(slot.key, event.nativeEvent.data)}
                onLoadEnd={() => preview.onLoaded(slot.key)}
                sharedCookiesEnabled={false}
                setSupportMultipleWindows={false}
                accessibilityLabel={visible ? `Your draft website at ${PREVIEW_DEVICE_LABELS[preference.device].toLowerCase()} size. Tap a section to change it.` : undefined}
                accessibilityElementsHidden={!visible}
                importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
                testID={visible ? "live-preview-frame" : "live-preview-frame-next"}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, minHeight: 200, position: "relative", overflow: "hidden", backgroundColor: color.fill.tableHead },
  viewport: { position: "absolute", top: 0, left: 0, overflow: "hidden", backgroundColor: color.paper },
  web: { flex: 1, backgroundColor: color.paper },
  hidden: { opacity: 0 },
});
