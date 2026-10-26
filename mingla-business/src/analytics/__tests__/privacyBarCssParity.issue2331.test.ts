// #2331 — the server-rendered buyer pages and the React app draw the SAME
// privacy bar. Both carry their own copy of the stylesheet (the server pages
// boot without the React bundle), so this test pins them byte-for-byte and pins
// the root-inset rules that keep every control above the bar.
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { privacyBarCss, privacyBarRuntimeSource } = require("../../../server/publicPrivacyRuntime.js") as {
  privacyBarCss: () => string;
  privacyBarRuntimeSource: () => string;
};

const BANNER_SOURCE = readFileSync(join(__dirname, "..", "ConsentBanner.web.tsx"), "utf8");

function reactBarCss(): string {
  const match = BANNER_SOURCE.match(/const BAR_CSS = `\n([\s\S]*?)\n`;/);
  if (match === null) throw new Error("BAR_CSS not found in ConsentBanner.web.tsx");
  return match[1].split("${PRIVACY_INSET_PROPERTY}").join("--mingla-privacy-inset");
}

describe("#2331 privacy bar stylesheet parity", () => {
  it("the server copy equals the React copy rule for rule", () => {
    expect(privacyBarCss().split("\n")).toEqual(reactBarCss().split("\n"));
  });

  it("the app root ends above the bar and can scroll its last control clear of it", () => {
    for (const css of [privacyBarCss(), reactBarCss()]) {
      expect(css).toContain("#root{box-sizing:border-box;padding-bottom:var(--mingla-privacy-inset,0px)}");
      expect(css).toContain('html[data-mingla-privacy-bar="shown"] #root{overflow-y:auto}');
    }
  });

  it("both owners raise and clear the shown marker together with the inset", () => {
    expect(BANNER_SOURCE).toMatch(/if \(inset > 0\) document\.documentElement\.setAttribute\(PRIVACY_BAR_ATTRIBUTE, "shown"\);\s*else document\.documentElement\.removeAttribute\(PRIVACY_BAR_ATTRIBUTE\);/);
    expect(BANNER_SOURCE).toContain('const PRIVACY_BAR_ATTRIBUTE = "data-mingla-privacy-bar";');
    const runtime = privacyBarRuntimeSource();
    expect(runtime).toContain('if(h>0)d.setAttribute("data-mingla-privacy-bar","shown");else d.removeAttribute("data-mingla-privacy-bar");');
  });
});
