// #4420 web journey (shots 11 and 13) — a focused single-line field (the Where
// step's Address, the ticket sheet's Capacity) showed a second rectangular
// browser ring inside its rounded box. The web field-focus stylesheet now
// removes a text input's own outline and draws the kit ring on the box that
// holds it, so each field shows exactly one visible focus ring.
//
// WHAT THIS FILE PROVES (the stylesheet the app installs, read rule by rule)
//   SR-1 a focused text input inside a box draws no outline of its own.
//   SR-2 that box draws the kit focus ring (2px, offset 2) instead, so focus
//        stays visible.
//   SR-3 tick boxes, radios, sliders and file pickers keep the browser ring.
//
// FAILS-ON-REVERT: drop the text-input rules from fieldFocusCss.web.ts and
// SR-1 / SR-2 go red.

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../constants/designSystem", () => ({
  edge: {
    ringFocus: { ring: "#ffffff", ringWidth: 2 },
    ringInputFocus: { borderColor: "rgba(255,255,255,0.4)" },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require("../fieldFocusCss.web") as typeof import("../fieldFocusCss.web");

/** The installed stylesheet as { selector list -> declarations }. */
const rules = (): Array<{ selectors: string[]; body: string }> =>
  web.FIELD_FOCUS_CSS.split("}")
    .filter((chunk) => chunk.includes("{"))
    .map((chunk) => {
      const [selector, body] = chunk.split("{");
      // Split on top-level commas only (not inside :not(...)).
      const selectors: string[] = [];
      let depth = 0;
      let current = "";
      for (const ch of selector) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
          selectors.push(current.trim());
          current = "";
        } else current += ch;
      }
      selectors.push(current.trim());
      return { selectors, body };
    });

const focusedTextInput = /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):not\(\[type=range\]\):not\(\[type=file\]\):focus/;

describe("#4420 a single-line field shows one focus ring", () => {
  test("SR-1 the focused text input draws no outline", () => {
    const inputRule = rules().find((rule) =>
      rule.selectors.some((sel) => /^div:has\(> .+\) > /.test(sel) && focusedTextInput.test(sel.split(") > ")[1] ?? "")));
    expect(inputRule?.body).toBe("outline:none");
  });

  test("SR-2 the box holding it draws the kit ring", () => {
    const boxRule = rules().find((rule) =>
      rule.selectors.some((sel) => sel.startsWith("div:has(> input") && !sel.includes(") > ")));
    expect(boxRule?.body).toContain("outline:2px solid #ffffff;");
    expect(boxRule?.body).toContain("outline-offset:2px");
  });

  test("SR-3 tick boxes, radios, sliders and file pickers keep the browser ring", () => {
    const textRules = rules().filter((rule) => rule.selectors.some((sel) => focusedTextInput.test(sel)));
    expect(textRules.length).toBe(2);
    for (const type of ["checkbox", "radio", "range", "file"]) {
      for (const rule of textRules) {
        expect(rule.selectors.join(",")).toContain(`:not([type=${type}])`);
      }
    }
  });
});
