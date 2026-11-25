/**
 * #4490 click-test D29 — nothing white can ever show behind the app on web.
 *
 * The page root (html and body) had no background, so any gap the app did not
 * paint (a scrolled shell, an overscroll bounce, a short page) showed the
 * browser's white. The app's canvas colour now sits on html and body too.
 * Public pages that paint their own look draw over it, so they are unchanged.
 *
 * Invariant I-4490-WEB-ROOT-PAINTS-APP-CANVAS: html and body carry
 * the app canvas colour on web. Enforced by
 * appBackgroundCss.issue4490.implementor.test.ts.
 */
import { color } from "../../constants/designSystem";

const STYLE_ID = "mingla-app-background-4490";

export const APP_BACKGROUND_CSS = `html,body{background-color:${color.canvas};}`;

export const installAppBackgroundCss = (doc: Document | undefined = (globalThis as { document?: Document }).document): void => {
  if (doc === undefined || doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = APP_BACKGROUND_CSS;
  doc.head.appendChild(style);
};
