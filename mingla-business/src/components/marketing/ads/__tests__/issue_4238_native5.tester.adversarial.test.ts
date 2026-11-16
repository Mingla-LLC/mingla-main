/**
 * #4238 tester final native 4 (after rework 6) — adversarial, different angle
 * from issue_4238_rework6.implementor.test.ts.
 *
 * The implementor checks that the same-total key EXISTS in every locale and
 * that the withdraw buttons stack. This attacks what the Host actually reads:
 *  - every locale's withdraw label still carries {{amount}} exactly once, so the
 *    full-width button shows the money in every language, and the sheet passes
 *    the back-pay amount into it;
 *  - the same-total line is rendered with NO variables, so a locale that put a
 *    {{placeholder}} in it would show raw braces; it must be non-empty and
 *    placeholder-free everywhere;
 *  - the line shows ONLY on an extend-the-end-date suggestion, never on a
 *    raise or lower suggestion (where the total does change).
 *
 * Fails on revert of rework 6: dropping the extend_end-only line from the
 * sheet, or widening it to every suggestion, reds the third block.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../../..");
const localesDir = path.join(root, "src/i18n/locales");
const sheetSrc = fs.readFileSync(
  path.join(root, "src/components/marketing/ads/HostAdManageSheets.tsx"),
  "utf8",
);

type Json = Record<string, unknown>;
const locales = fs
  .readdirSync(localesDir)
  .filter((l) => fs.existsSync(path.join(localesDir, l, "hostAds.json")));

function manage(locale: string): Json {
  const json = JSON.parse(fs.readFileSync(path.join(localesDir, locale, "hostAds.json"), "utf8")) as Json;
  return ((json.hostAds as Json)?.manage ?? {}) as Json;
}

describe("withdraw label shows the amount in every language", () => {
  it("covers every Host locale", () => {
    expect(locales.length).toBeGreaterThanOrEqual(28);
  });

  it.each(locales)("%s: withdraw.go has exactly one {{amount}}", (locale) => {
    const go = (manage(locale).withdraw as Json | undefined)?.go;
    expect(typeof go).toBe("string");
    expect(((go as string).match(/\{\{amount\}\}/g) ?? []).length).toBe(1);
  });

  it("the sheet fills the label with the back-pay amount", () => {
    expect(sheetSrc).toContain('hm("withdraw.go", { amount: props.money(quote.backPay) })');
  });
});

describe("same-total line is plain text everywhere", () => {
  it.each(locales)("%s: sameTotalLine is non-empty with no placeholders", (locale) => {
    const line = (manage(locale).ari as Json | undefined)?.sameTotalLine;
    expect(typeof line).toBe("string");
    expect((line as string).trim().length).toBeGreaterThan(10);
    expect(line as string).not.toMatch(/\{\{|\}\}/);
  });

  it("the sheet renders it without variables", () => {
    expect(sheetSrc).toContain('hm("ari.sameTotalLine")}');
    expect(sheetSrc).not.toMatch(/hm\("ari\.sameTotalLine",/);
  });
});

describe("same-total line only on an extend suggestion", () => {
  it("is gated on extend_end alone", () => {
    const at = sheetSrc.indexOf('hm("ari.sameTotalLine")');
    expect(at).toBeGreaterThan(-1);
    const gate = sheetSrc.slice(Math.max(0, at - 160), at);
    expect(gate).toContain('props.suggestion.kind === "extend_end" ? (');
    expect(gate).not.toMatch(/raise_budget|lower_budget|\|\|/);
    expect((sheetSrc.match(/ari\.sameTotalLine/g) ?? []).length).toBe(1);
  });
});
