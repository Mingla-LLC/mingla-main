/* #4453 6a — the tester's adversarial check (verdict 6932025288, P1-2): the CSS a gallery design actually ships hides the form honeypot and the screen-reader labels (jsdom applies no CSS, so render tests could not see it). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const pub = path.resolve(__dirname, "../../../public/designs");
const css = (key: string) => fs.readFileSync(path.join(pub, "_shared/blocks-1.css"), "utf8") + fs.readFileSync(path.join(pub, `${key}/1.css`), "utf8");
describe("#4453 6a tester: a gallery design hides the form honeypot and screen-reader labels", () => {
  for (const key of ["nocturne", "haven", "maison"]) {
    it(`${key}: .form-trap and .sr-only are visually hidden`, () => {
      const all = css(key);
      expect(all, `${key} must hide .form-trap`).toMatch(/\.form-trap[^{]*\{[^}]*(clip-path|position:\s*absolute|display:\s*none)/);
      expect(all, `${key} must hide .sr-only`).toMatch(/\.sr-only[^{]*\{[^}]*(clip-path|clip:)/);
    });
  }
});
