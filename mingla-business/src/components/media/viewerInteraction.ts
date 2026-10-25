export type MediaViewerKeyAction = "close" | "previous" | "next" | null;

export function mediaViewerKeyAction(input: {
  key: string;
  topLayer: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
}): MediaViewerKeyAction {
  if (!input.topLayer) return null;
  if (input.key === "Escape") return "close";
  if (input.key === "ArrowLeft" && input.hasPrevious) return "previous";
  if (input.key === "ArrowRight" && input.hasNext) return "next";
  return null;
}
