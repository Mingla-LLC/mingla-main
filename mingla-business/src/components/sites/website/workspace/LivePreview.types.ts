import type React from "react";
import type { PreviewDevicePreference } from "../../../../sites/previewDevice";
import type { PreviewMarks } from "../../../../sites/previewBridge";

export type LivePreviewProps = {
  /** The frame address for the page being edited (null: nothing to show yet). */
  url: string | null;
  /** The page `url` shows (its id): another page opens at its top; the same page rebuilt keeps its scroll. */
  pageKey?: string | null;
  preference: PreviewDevicePreference;
  editMode: boolean;
  marks: PreviewMarks;
  tokenDeclarations: readonly string[] | null;
  selectedId: string | null;
  onSelect: (sectionId: string) => void;
  onReady?: (pagePath: string) => void;
  /** The page could not be rebuilt after a change: build the draft preview again. */
  onRetry?: () => void;
  /** Desktop only: the small Ari card, drawn beside the selected section. */
  renderCard?: (() => React.ReactNode) | null;
  cardHeight?: number;
};
