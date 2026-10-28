import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import {
  previewCornerRadius,
  previewDimensions,
  previewScale,
  PREVIEW_DEVICE_LABELS,
  type PreviewDevicePreference,
} from "../../../../sites/previewDevice";
import { PREVIEW_TOKENS_MESSAGE } from "../../../../sites/previewFrame";

/*
 * #2829 W9r (DESIGN_SPEC §1.7) — the draft at a simulated device size on
 * Business web: an iframe rendered at the device's real CSS width (so the
 * site's own breakpoints apply) and scaled to fit the stage. The frame keeps
 * its own scroll. Unsaved token changes are posted in (debounced 150 ms) and
 * re-posted after every load.
 */
export type ScaledPreviewFrameProps = {
  url: string;
  preference: PreviewDevicePreference;
  /** Fit within this height (side panel 520, phone sheet 560); or fill the stage's own height. */
  maxHeight?: number;
  fill?: boolean;
  tokenDeclarations?: readonly string[] | null;
  onLoad?: () => void;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ScaledPreviewFrame({ url, preference, maxHeight = 520, fill = false, tokenDeclarations, onLoad }: ScaledPreviewFrameProps): React.ReactElement {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { width, height } = previewDimensions(preference);
  const scale = previewScale({ paneWidth: box.width, maxHeight: fill ? box.height : maxHeight, width, height });
  const left = Math.max(0, (box.width - width * scale) / 2);
  const reduce = prefersReducedMotion();

  const post = () => {
    const target = frameRef.current?.contentWindow;
    if (target && tokenDeclarations) target.postMessage({ type: PREVIEW_TOKENS_MESSAGE, declarations: [...tokenDeclarations] }, "*");
  };
  const latest = useRef(post);
  latest.current = post;
  useEffect(() => {
    const timer = setTimeout(() => latest.current(), 150);
    return () => clearTimeout(timer);
  }, [tokenDeclarations]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setBox((previous) => (previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height }));
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.stage, fill ? styles.fill : { height: Math.ceil(height * scale) || maxHeight }]}
      testID="preview-stage"
    >
      <View
        style={[
          styles.viewport,
          {
            width,
            height,
            left,
            borderRadius: previewCornerRadius(preference.device),
            transform: [{ scale }],
            transitionProperty: reduce ? "none" : "transform, width, height, left",
            transitionDuration: reduce ? "0ms" : "200ms",
            transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
          } as object,
        ]}
        testID="preview-viewport"
      >
        {React.createElement("iframe", {
          ref: frameRef,
          src: url,
          title: `Draft preview of your website at ${PREVIEW_DEVICE_LABELS[preference.device].toLowerCase()} size`,
          onLoad: () => {
            post();
            onLoad?.();
          },
          width,
          height,
          style: { border: 0, width: `${width}px`, height: `${height}px`, display: "block", background: "#ffffff" },
          referrerPolicy: "no-referrer",
          sandbox: "allow-scripts allow-same-origin allow-forms",
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    borderRadius: 12,
    backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 10px, transparent 10px 20px)",
  } as object,
  fill: { flex: 1, minHeight: 200 },
  viewport: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    transformOrigin: "top left",
    boxShadow: "0 0 0 2px rgba(255,255,255,0.14), 0 12px 40px rgba(0,0,0,0.5)",
  } as object,
});
