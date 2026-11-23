/**
 * issue #4522 W-11 — orange text on the dark surfaces uses the readable design
 * token (accentText), never the orange fill token (accent). Source-level guard
 * (these are style sheets in screens a node jest run cannot mount); the screens
 * were checked in a browser.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(path.join(root, rel), "utf-8");
const styleBlock = (src: string, key: string): string => {
  const at = src.indexOf(`${key}:`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("},", at) + 2);
};

describe("readable accent text on dark", () => {
  test.each([
    "app/checkout-trip/[tripEventId]/payment.tsx",
    "app/checkout-trip/[tripEventId]/buyer.tsx",
  ])("%s: Total due today label and amount", (file) => {
    const src = read(file);
    expect(styleBlock(src, "dueTodayLabel")).toContain("color.accentText");
    expect(styleBlock(src, "dueTodayValue")).toContain("color.accentText");
  });
  test("the balance page's brand label", () => {
    expect(styleBlock(read("src/components/trip/TripBalancePanel.tsx"), "eyebrow")).toContain(
      "color.accentText",
    );
  });
  test("the 'Use what you typed' row text and icon", () => {
    const src = read("src/components/location/AddressInput.tsx");
    const at = src.indexOf("  action: {");
    expect(src.slice(at, src.indexOf("},", at))).toMatch(/text: dsColor\.accentText/);
  });
});
