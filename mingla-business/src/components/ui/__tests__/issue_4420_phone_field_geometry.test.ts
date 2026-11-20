/**
 * #4420 wave 6 [TEST-MOD-APPROVED #4420] — ui/PhoneField matches ui/Input.
 *
 * Fails when: PhoneField stops passing the Input geometry (48 tall, 1px rim,
 * radius sm, the error flush with the field, no focus shadow) or the Input
 * fill; or the shared PhoneInput stops honouring `metrics` / `fieldBackground`
 * (or changes its defaults, which would move app-mobile's field).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@mingla/phone-input", () => ({ PhoneInput: () => null, getCountryByCode: () => undefined }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({
  parsePhoneEntry: () => ({ ok: false }),
  resolvePhoneStartCountry: () => null,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../../../utils/devicePhoneRegion", () => ({ devicePhoneRegion: () => null }));

// eslint-disable-next-line import/first
import { BUSINESS_PHONE_METRICS, BUSINESS_SHEET_PHONE_THEME } from "../PhoneField";
// eslint-disable-next-line import/first
import { color, edge, radius, size } from "../../../constants/designSystem";

const input = fs.readFileSync(path.join(__dirname, "../Input.tsx"), "utf8");
const phoneField = fs.readFileSync(path.join(__dirname, "../PhoneField.tsx"), "utf8");
const pkg = fs.readFileSync(path.join(__dirname, "../../../../../packages/phone-input/PhoneInput.tsx"), "utf8");

describe("#4420 PhoneField geometry", () => {
  test("uses the Input height, rim, radius and an unindented error", () => {
    expect(input).toContain("const HEIGHT = 48;");
    expect(BUSINESS_PHONE_METRICS).toEqual({
      height: size.input,
      borderWidth: 1,
      focusedBorderWidth: edge.ringInputFocus.borderWidth,
      borderRadius: radius.sm,
      horizontalPadding: 14,
      errorIndent: 0,
      focusShadow: false,
    });
    expect(size.input).toBe(48);
    expect(phoneField).toContain("metrics={BUSINESS_PHONE_METRICS}");
  });

  test("the field takes the Input fill; the picker keeps an opaque surface", () => {
    // [TEST-MOD #4518] the fill is read when the sheet is built, not frozen
    // at import, so a host-themed checkout can re-point it. Same token.
    expect(input).toContain("backgroundColor: color.fill.input,");
    expect(BUSINESS_SHEET_PHONE_THEME.fieldBackground).toBe(color.fill.input);
    expect(BUSINESS_SHEET_PHONE_THEME.backgroundPrimary).toBe(color.canvas);
    expect(BUSINESS_SHEET_PHONE_THEME.borderError).toBe(edge.ringError.borderColor);
  });

  test("the shared PhoneInput honours metrics and keeps its defaults when none are passed", () => {
    expect(pkg).toContain("backgroundColor: theme?.fieldBackground ?? t.backgroundPrimary,");
    expect(pkg).toContain("focused && !error && metrics?.focusShadow !== false ? shadowSm : null,");
    expect(pkg).toMatch(/container: \{\s*flexDirection: "row",\s*alignItems: "center",\s*minHeight: 56,\s*borderRadius: radius\.md,\s*borderWidth: 2,/);
    expect(pkg).toContain("metrics?.errorIndent !== undefined ? { paddingLeft: metrics.errorIndent } : null");
  });
});
