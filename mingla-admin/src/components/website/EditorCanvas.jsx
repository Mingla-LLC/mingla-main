// #4636 — the canvas: the REAL page from usemingla.com/site-preview/<token> at
// true size (1440 / 834 / 390 wide), filling the canvas height and scrolling
// inside the frame. Fit scales a wide page down to the canvas width; 100%
// shows it at true size with horizontal pan. The selected section's tools sit
// in a bar above the frame.
import { forwardRef, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { DEVICES, fitScale } from "../../lib/siteEditorModel";
import { MiniButton } from "./editorUi";

export const EditorCanvas = forwardRef(function EditorCanvas({ src, frameKey, device, zoom, title, failed, onRetry, selectedName, selectedHidden, selIndex, count, canEdit, onAction, onAddBelow, onFrameLoad }, ref) {
  const stageRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frameW = DEVICES[device];
  const scale = zoom === "fit" ? fitScale(box.w - 24, frameW) : 1;
  const frameH = Math.max(320, Math.round((box.h - 24) / scale));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--a-soft)]" data-canvas={device} data-zoom={zoom}>
      {selIndex !== null && canEdit ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--a-line)] bg-[var(--a-panel)] px-3 py-1.5" role="toolbar" aria-label={`${selectedName} tools`} data-section-toolbar="">
          <span className="mr-1 truncate text-xs font-semibold">{selectedName}{selectedHidden ? " · hidden" : ""}</span>
          <MiniButton onClick={() => onAction("up", selIndex)} disabled={selIndex === 0}><ArrowUp size={12} /> Up</MiniButton>
          <MiniButton onClick={() => onAction("down", selIndex)} disabled={selIndex >= count - 1}><ArrowDown size={12} /> Down</MiniButton>
          <MiniButton onClick={() => onAction("dup", selIndex)}><Copy size={12} /> Duplicate</MiniButton>
          <MiniButton onClick={() => onAction("hide", selIndex)}>{selectedHidden ? <Eye size={12} /> : <EyeOff size={12} />} {selectedHidden ? "Show" : "Hide"}</MiniButton>
          <MiniButton onClick={() => onAction("del", selIndex)}><Trash2 size={12} /> Delete</MiniButton>
          <MiniButton onClick={() => onAddBelow(selIndex + 1)}><Plus size={12} /> Add section below</MiniButton>
        </div>
      ) : null}
      <div ref={stageRef} className={`relative min-h-0 flex-1 p-3 ${zoom === "fit" ? "overflow-hidden" : "overflow-auto"}`}>
        {failed ? (
          <div className="grid h-full place-items-center" data-preview-failed="">
            <div className="text-center">
              <p className="text-sm font-semibold">Preview couldn't load.</p>
              <p className="mt-1 text-xs text-[var(--a-dim)]">The site didn't answer, or the preview link ran out.</p>
              <Button className="mt-3" size="sm" variant="secondary" icon={RefreshCw} onClick={onRetry}>Retry</Button>
            </div>
          </div>
        ) : !src || !box.w ? (
          <Skeleton height="100%" rounded="8px" />
        ) : (
          <div style={{ width: Math.round(frameW * scale), height: Math.round(frameH * scale), margin: "0 auto" }}>
            <div style={{ width: frameW, height: frameH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
              <iframe ref={ref} key={frameKey} title={title} src={src} width={frameW} height={frameH} onLoad={onFrameLoad}
                className="block rounded-lg border-0 bg-white shadow-[0_2px_20px_rgba(0,0,0,.18)]" referrerPolicy="strict-origin" data-editor-frame="" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
