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
 * #4420 D1: Host web is a single-page export (app.json web.output "single"),
 * so app/+html.tsx is never used. The CSS is installed at boot by the root
 * layout (installWebDocumentCss, app/_layout.tsx), the same way the field
 * focus rule is (fieldFocusCss.web.ts): one <style id="mingla-web-document-4420">
 * in <head>. Native has no document, so the installer does nothing there.
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

export const WEB_DOCUMENT_STYLE_ID = "mingla-web-document-4420";

/** Writes the document CSS into <head> once (web only; a no-op without a document). */
export function installWebDocumentCss(): void {
  const doc = (globalThis as { document?: Document }).document;
  if (doc === undefined || doc.getElementById(WEB_DOCUMENT_STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = WEB_DOCUMENT_STYLE_ID;
  style.textContent = webDocumentCss();
  doc.head.appendChild(style);
}
