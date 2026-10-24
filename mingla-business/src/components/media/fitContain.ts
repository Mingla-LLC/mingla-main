export interface FitContainBox {
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface MediaViewerStageSize {
  width: number;
  height: number;
  topArea: number;
  bottomArea: number;
}

/** Keep bars, safe-area insets, stage padding and desktop arrows out of media geometry. */
export function calculateMediaViewerStage(input: {
  viewportWidth: number;
  viewportHeight: number;
  insetTop: number;
  insetBottom: number;
  wideDesktop: boolean;
  hasBottomArea: boolean;
}): MediaViewerStageSize {
  const topArea = Math.max(0, input.insetTop) + 56;
  const bottomInset = Math.max(0, input.insetBottom);
  const bottomArea = input.hasBottomArea ? bottomInset + 72 : bottomInset;
  const arrowAllowance = input.wideDesktop ? 144 : 0;
  return {
    width: Math.max(0, input.viewportWidth - 32 - arrowAllowance),
    height: Math.max(0, input.viewportHeight - topArea - bottomArea - 32),
    topArea,
    bottomArea,
  };
}

/** Return the largest centered box that preserves media aspect ratio without cropping. */
export function fitContain(
  mediaWidth: number | null | undefined,
  mediaHeight: number | null | undefined,
  stageWidth: number,
  stageHeight: number,
): FitContainBox {
  const safeStageWidth = Math.max(0, stageWidth);
  const safeStageHeight = Math.max(0, stageHeight);
  if (!mediaWidth || !mediaHeight || mediaWidth <= 0 || mediaHeight <= 0) {
    return { width: safeStageWidth, height: safeStageHeight, left: 0, top: 0 };
  }
  const scale = Math.min(safeStageWidth / mediaWidth, safeStageHeight / mediaHeight);
  const width = Math.min(safeStageWidth, Math.max(0, mediaWidth * scale));
  const height = Math.min(safeStageHeight, Math.max(0, mediaHeight * scale));
  return {
    width,
    height,
    left: Math.max(0, (safeStageWidth - width) / 2),
    top: Math.max(0, (safeStageHeight - height) / 2),
  };
}
