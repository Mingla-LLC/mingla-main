/**
 * #4490 N35/N42/N73 — the web document is dark before any JavaScript runs.
 * `public/index.html` is the Expo SPA template (dev server and export); its
 * pre-JS background must equal the app canvas, and it must carry a readable
 * loader inside #root (React replaces it on its first render).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { color } from "../../../constants/designSystem";

const html = readFileSync(join(__dirname, "../../../../public/index.html"), "utf8");

describe("public/index.html preboot (#4490)", () => {
  it("paints html and body in the app canvas colour before any script", () => {
    const preboot = html.slice(html.indexOf('<style id="mingla-preboot">'));
    expect(preboot).toContain(`background-color: ${color.canvas};`);
    expect(preboot).toContain(`color: ${color.text2};`);
  });

  it("keeps the Expo template placeholders and the #root mount", () => {
    expect(html).toContain("%LANG_ISO_CODE%");
    expect(html).toContain("%WEB_TITLE%");
    expect(html).toMatch(/<div id="root">[\s\S]*mingla-preboot[\s\S]*Loading…[\s\S]*<\/div>/);
    expect(html).toContain("</head>");
  });
});
