// MINGLA-INVARIANT: I-4490-WEB-ROOT-PAINTS-APP-CANVAS | issue #4490 | on web, html and body carry the app canvas colour so no browser white ever shows behind the Host app; public pages that paint their own look draw over it.
/**
 * #4490 click-test D29 — html and body paint the app canvas on web, so no
 * browser white can ever show behind the Host app.
 * Invariant I-4490-WEB-ROOT-PAINTS-APP-CANVAS is declared at the top of this file.
 */
import { describe, expect, it } from "@jest/globals";

import { color } from "../../../constants/designSystem";
import { APP_BACKGROUND_CSS, installAppBackgroundCss } from "../appBackgroundCss.web";

function fakeDocument(): { doc: Document; styles: { id: string; textContent: string }[] } {
  const styles: { id: string; textContent: string }[] = [];
  const doc = {
    getElementById: (id: string) => styles.find((s) => s.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (el: { id: string; textContent: string }) => styles.push(el) },
  } as unknown as Document;
  return { doc, styles };
}

describe("D29 — the page root is the app canvas", () => {
  it("installs one rule giving html and body the canvas colour", () => {
    const { doc, styles } = fakeDocument();
    installAppBackgroundCss(doc);
    installAppBackgroundCss(doc);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(APP_BACKGROUND_CSS);
    expect(APP_BACKGROUND_CSS).toBe(`html,body{background-color:${color.canvas};}`);
  });
});
