/**
 * issue #4522 W-7 — at 375 px the plan editor's rows must not push past the
 * card: a web text field beside a suffix needs minWidth 0 and the suffix must
 * be allowed to shrink/wrap. Measured in a browser at 375 px (no element past
 * the card in Percent or Amount mode); this guards the style.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.join(__dirname, "..", "PaymentPlanEditorV2.tsx"), "utf-8");
const block = (key: string): string => {
  const at = src.indexOf(`  ${key}: {`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("},", at) + 2);
};

describe("PaymentPlanEditorV2 at a narrow width", () => {
  test("the field beside a suffix can shrink", () => {
    expect(block("input")).toMatch(/minWidth: 0/);
  });
  test("the suffix can shrink and wrap", () => {
    expect(src).toMatch(/suffix: \{[^}]*flexShrink: 1/);
  });
});
