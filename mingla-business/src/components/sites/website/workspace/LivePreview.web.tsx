import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { color, scrim } from "../../../../constants/designSystem";
import { previewDimensions, PREVIEW_DEVICE_LABELS } from "../../../../sites/previewDevice";
import { ariCardPosition, messageFromFrame, scaleRect, sectionViewportRect, stageFrame } from "../../../../sites/previewBridge";
import { usePreviewFrames, type FrameMessage, type PreviewCommands } from "./usePreviewFrames";
import type { LivePreviewProps } from "./LivePreview.types";

/*
 * #4453 — the live draft on Host web. One visible iframe at the device's real
 * CSS width, scaled to the stage; a saved change loads the next draft in a
 * second, hidden iframe and swaps it in when it reports ready, so the page
 * never blanks. Messages are accepted only from these two frames' own
 * windows. The small Ari card is drawn here, over the stage, anchored to the
 * selected section's rect.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const LivePreview = React.forwardRef<PreviewCommands, LivePreviewProps>(function LivePreview(props, ref) {
  const { url, preference, editMode, marks, tokenDeclarations, selectedId, onSelect, onReady, renderCard, cardHeight } = props;
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const device = previewDimensions(preference);
  const frame = stageFrame(stage, device.width);
  const [clicked, setClicked] = useState<{ id: string; top: number; left: number; width: number; height: number } | null>(null);

  const send = useCallback((key: number, message: FrameMessage) => {
    // The frame redirects from Studio to the site runtime, so its final
    // origin is not known here. Only ids, colours and the owner's own draft
    // words are sent, to a window this component created.
    frames.current.get(key)?.contentWindow?.postMessage(message, "*");
  }, []);

  const preview = usePreviewFrames({
    url,
    editMode,
    marks,
    tokenDeclarations,
    send,
    onSelect: (sectionId, rect) => {
      setClicked({ id: sectionId, ...rect });
      onSelect(sectionId);
    },
    onReady,
  });
  useImperativeHandle(ref, () => preview.commands, [preview.commands]);

  const handlers = useRef(preview);
  handlers.current = preview;
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const listener = (event: MessageEvent) => {
      const keys = [...frames.current.keys()];
      const index = messageFromFrame(event.source, keys.map((key) => frames.current.get(key)?.contentWindow ?? null));
      if (index >= 0) handlers.current.onMessage(keys[index]!, event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setStage((previous) => (previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height }));
  };

  // Where the selected section is now, in stage pixels: from the frame's own
  // report when it has one (it follows scrolling), else from the click.
  const known = selectedId ? preview.geometry.sections.find((section) => section.id === selectedId) : undefined;
  const frameRect = known
    ? sectionViewportRect(known, preview.geometry.scrollY, frame.width)
    : clicked && clicked.id === selectedId ? clicked : null;
  const cardAt = selectedId && renderCard && frame.scale > 0
    ? ariCardPosition(
      frameRect ? scaleRect(frameRect, frame.scale, { left: frame.left, top: 0 }) : { top: 0, left: frame.left, width: frame.width * frame.scale, height: stage.height },
      stage,
      { width: 340, height: cardHeight ?? 260 },
    )
    : null;

  const reduce = prefersReducedMotion();
  const slots = [preview.swap.shown, preview.swap.loading].filter((slot): slot is NonNullable<typeof slot> => slot !== null);
  return (
    <View onLayout={onLayout} style={styles.stage} testID="live-preview-stage">
      <View
        style={[styles.viewport, {
          width: frame.width,
          height: frame.height,
          left: frame.left,
          transform: [{ scale: frame.scale || 1 }],
          opacity: frame.scale > 0 ? 1 : 0,
          transitionProperty: reduce ? "none" : "width, left",
          transitionDuration: reduce ? "0ms" : "200ms",
        } as object]}
        testID="live-preview-viewport"
      >
        {slots.map((slot) => {
          const visible = slot.key === preview.swap.shown?.key;
          return React.createElement("iframe", {
            key: slot.key,
            ref: (node: HTMLIFrameElement | null) => {
              if (node) frames.current.set(slot.key, node);
              else frames.current.delete(slot.key);
            },
            src: slot.url,
            title: visible ? `Your draft website at ${PREVIEW_DEVICE_LABELS[preference.device].toLowerCase()} size. Press Enter on a section to change it.` : undefined,
            "aria-hidden": visible ? undefined : true,
            tabIndex: visible ? 0 : -1,
            "data-testid": visible ? "live-preview-frame" : "live-preview-frame-next",
            onLoad: () => preview.onLoaded(slot.key),
            width: frame.width,
            height: frame.height,
            style: {
              position: "absolute", top: 0, left: 0, border: 0, width: `${frame.width}px`, height: `${frame.height}px`, background: color.paper,
              opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none",
            },
            referrerPolicy: "no-referrer",
            sandbox: "allow-scripts allow-same-origin allow-forms",
          });
        })}
      </View>
      {cardAt && renderCard ? (
        <View style={[styles.card, { top: cardAt.top, left: cardAt.left, width: cardAt.width }]} testID="live-preview-card">
          {renderCard()}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, minHeight: 200, position: "relative", overflow: "hidden", backgroundColor: color.fill.tableHead },
  viewport: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
    backgroundColor: color.paper,
    transformOrigin: "top left",
    boxShadow: `0 0 0 1px ${color.fill.step}, 0 12px 40px ${scrim.modal}`,
  } as object,
  card: { position: "absolute", zIndex: 5 },
});
