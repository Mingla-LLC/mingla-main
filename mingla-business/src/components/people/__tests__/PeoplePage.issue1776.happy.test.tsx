import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import { canPerformAction, gateCaptionFor, MIN_RANK } from "../../../utils/permissionGates";

const page = readFileSync(path.resolve(__dirname, "../PeoplePage.tsx"), "utf8");

describe("#1776 People-page export wiring", () => {
  test("makes Export the fourth responsive book action without replacing Add as primary", () => {
    expect(page).toContain("isWideDesktop ? 4 : 2");
    expect(page).toContain('testID="people-export-book-loading"');
    expect(page).toMatch(/label="Add"[\s\S]*?accentColor=\{accent\.warm\}/);
    expect(page).toMatch(/label="Export"[\s\S]*?leadingIcon="download"[\s\S]*?variant="ghost"/);
    expect(page).toMatch(/exportAction:[\s\S]*?borderColor:\s*accent\.warm/);
    expect(page).toContain('accessibilityLabel="Export brand contact book"');
    expect(page).toContain("disabled={!exportAuthorized || book.bookTotal === null}");
  });

  test("keeps the sheet mounted after close so the same-session export can finish", () => {
    expect(page).toContain("const [exportMounted, setExportMounted]");
    expect(page).toContain("setExportMounted(true)");
    expect(page).toMatch(/exportMounted\s*\?\s*\([\s\S]*?visible:\s*exportOpen/);
  });

  test("uses the canonical brand-admin gate and exact explanatory caption", () => {
    expect(MIN_RANK.EXPORT_BRAND_BOOK).toBe(50);
    expect(canPerformAction(49, "EXPORT_BRAND_BOOK")).toBe(false);
    expect(canPerformAction(50, "EXPORT_BRAND_BOOK")).toBe(true);
    expect(gateCaptionFor("EXPORT_BRAND_BOOK")).toBe(
      "Your role doesn't include this action. Ask a brand admin or above.",
    );
    expect(page).toContain('testID="people-export-permission-caption"');
    expect(page).toMatch(/accessibilityLiveRegion="polite"[\s\S]*?maxFontSizeMultiplier=\{2\}[\s\S]*?testID="people-export-permission-caption"/);
  });
});
