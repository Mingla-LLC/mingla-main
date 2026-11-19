/**
 * #4420 A1 — the web document's own background and scroll edges.
 *
 * `html` and `body` had no background, so wherever the dark app did not cover
 * the screen (the end of the Messages list, a rubber-band bounce) the page
 * showed white. They now take the app canvas and never bounce
 * (`overscroll-behavior: none`).
 *
 * The Messages thread and inbox scrollers keep their scroll to themselves
 * (`contain`): scrolling to the oldest message never drags the page, so the
 * pinned composer stays in view (#4420 A2, SC-10). They are matched by the
 * testID react-native-web renders as `data-testid`.
 *
 * Read only by app/+html.tsx (the server-rendered document), never by the
 * client bundle.
 */
import { color } from "../constants/designSystem";

/** Scrollers whose scroll must never chain to the page. */
export const WEB_CONTAINED_SCROLLERS = [
  "brand-group-message-scroll",
  "brand-group-inbox-scroll",
] as const;

export function webDocumentCss(): string {
  const contained = WEB_CONTAINED_SCROLLERS.map((id) => `[data-testid="${id}"]`).join(",");
  return [
    `html,body{background-color:${color.canvas};overscroll-behavior:none}`,
    `${contained}{overscroll-behavior:contain}`,
  ].join("\n");
}
