/**
 * #4572 item 1 — web only: listens for the preview page's "stale" / "failed"
 * message from ONE frame (event.source must be that frame's own window, so no
 * other page or frame can trigger a refresh or the error card).
 */
import { useEffect, useRef, type RefObject } from "react";
import { previewRefusalKind } from "./previewRefresh";

export function usePreviewRefusalListener(
  frame: RefObject<HTMLIFrameElement | null> | (() => readonly (Window | null | undefined)[]),
  onStale: (() => void) | undefined,
  onFailed: (() => void) | undefined,
): void {
  const handlers = useRef({ onStale, onFailed });
  handlers.current = { onStale, onFailed };
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const listener = (event: MessageEvent) => {
      const target = frameRef.current;
      const windows = typeof target === "function" ? target() : [target.current?.contentWindow ?? null];
      if (!event.source || !windows.some((candidate) => candidate && candidate === event.source)) return;
      const kind = previewRefusalKind(event.data);
      if (kind === "stale") handlers.current.onStale?.();
      else if (kind === "failed") handlers.current.onFailed?.();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
}
