// #4420 sheet audit round 2 (shots-sheets after2-*).
//   - One field, one border, one focus ring: a web textarea that is the only
//     child of its bordered box draws no outline of its own; the box draws the
//     input focus border and ring. A textarea sharing its box keeps its ring.
//   - The Review changes diff row: every flex column may shrink below its
//     longest word (min-width:auto pushed the old value to a sliver and ran an
//     unbroken name past the row edge).
//   - The desktop sidebar draws the Mingla Host lockup at the kit's 64 (rail
//     48), cropped to the art, from the vector master on web.
// FAILS-ON-REVERT: drop the CSS rule, a minWidth:0, or the logo crop and the
// matching test goes red.

import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../constants/designSystem", () => ({
  edge: {
    ringFocus: { ring: "#ffffff", ringWidth: 2 },
    ringInputFocus: { borderColor: "rgba(255,255,255,0.4)" },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require("../fieldFocusCss.web") as typeof import("../fieldFocusCss.web");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const native = require("../fieldFocusCss") as typeof import("../fieldFocusCss");

const read = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, "../../../..", rel), "utf8");

describe("#4420 one field, one ring", () => {
  test("the only-child textarea loses its outline and its box draws the ring", () => {
    expect(web.FIELD_FOCUS_CSS).toContain("div:has(> textarea:only-child:focus) > textarea{outline:none}");
    expect(web.FIELD_FOCUS_CSS).toContain("div:has(> textarea:only-child:focus){");
    expect(web.FIELD_FOCUS_CSS).toContain("border-color:rgba(255,255,255,0.4) !important;");
    expect(web.FIELD_FOCUS_CSS).toContain("outline:2px solid #ffffff;");
    // A textarea that shares its box (composer + send) is not matched.
    expect(web.FIELD_FOCUS_CSS).not.toMatch(/(^|})textarea:focus\{outline:none/);
  });

  // [TEST-MOD-APPROVED #4420] device round 2: Ari's composer pill.
  test("an opted-in field box draws the ring on its rounded pill, not inside it", () => {
    expect(web.FIELD_FOCUS_BOX_PROPS).toEqual({ dataSet: { fieldFocus: "box" } });
    expect(web.FIELD_FOCUS_CSS).toContain('[data-field-focus="box"] textarea:focus,[data-field-focus="box"] input:focus{outline:none}');
    expect(web.FIELD_FOCUS_CSS).toContain('[data-field-focus="box"]:has(textarea:focus),[data-field-focus="box"]:has(input:focus){');
    expect(native.FIELD_FOCUS_BOX_PROPS).toEqual({});
    expect(read("src/components/ari/InputBar.tsx")).toMatch(/<View style=\{styles\.field\} \{\.\.\.FIELD_FOCUS_BOX_PROPS\}>/);
    expect(read("src/components/home/HomeAskAri.tsx")).toMatch(/<View style=\{styles\.askRow\} \{\.\.\.FIELD_FOCUS_BOX_PROPS\}>/);
  });

  test("install adds the rule once to the document head", () => {
    const appended: Array<{ id: string; textContent: string }> = [];
    const doc = {
      getElementById: (id: string) => appended.find((s) => s.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
      head: { appendChild: (s: { id: string; textContent: string }) => appended.push(s) },
    };
    (globalThis as { document?: unknown }).document = doc;
    web.installFieldFocusCss();
    web.installFieldFocusCss();
    expect(appended).toHaveLength(1);
    expect(appended[0].textContent).toBe(web.FIELD_FOCUS_CSS);
    delete (globalThis as { document?: unknown }).document;
  });

  test("native installs nothing, and the root layout installs it", () => {
    expect(native.FIELD_FOCUS_CSS).toBe("");
    expect(read("app/_layout.tsx")).toMatch(/installFieldFocusCss\(\);/);
  });
});

describe("#4420 diff row columns shrink", () => {
  test("diffContent, oldValue and newValue all carry minWidth: 0", () => {
    const src = read("src/components/event/ChangeSummaryModal.tsx");
    for (const key of ["diffContent", "oldValue", "newValue"]) {
      expect(src).toMatch(new RegExp(`  ${key}: \\{\\n    flex: 1,\\n    minWidth: 0,`));
    }
  });
});

describe("#4420 sidebar logo", () => {
  test("the lockup is cropped to its art at the kit's widths, vector on web", () => {
    const src = read("src/components/ui/DesktopSidebar.tsx");
    expect(src).toMatch(/const LOGO_ART = \{ x: 307, y: 628, w: 1386, h: 744 \} as const;/);
    expect(src).toMatch(/const LOGO_WIDTH_SIDEBAR = 64;/);
    expect(src).toMatch(/const LOGO_WIDTH_RAIL = 48;/);
    expect(src).toMatch(/uri: "\/brand\/mingla-business-logo\.svg"/);
    expect(src).not.toMatch(/styles\.logoMark/);
    // The served vector is the canon master (the #1001 parity gate pins bytes).
    expect(read("public/brand/mingla-business-logo.svg")).toBe(
      read("../packages/brand-assets/mingla-business-logo.svg"),
    );
  });
});
