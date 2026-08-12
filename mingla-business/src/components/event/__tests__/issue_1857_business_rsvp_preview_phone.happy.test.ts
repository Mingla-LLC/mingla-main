import { describe, expect, jest, test } from "@jest/globals";
import type { ReactElement } from "react";

jest.mock("@mingla/phone-input", () => ({
  COUNTRIES: [
    { code: "GB", name: "United Kingdom" },
    { code: "NG", name: "Nigeria" },
    { code: "US", name: "United States" },
  ],
  PhoneInput: () => null,
  getCountryByCode: (code: string) => ({ code, name: code }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import type {
  ResolvedTheme,
  RsvpPhoneFieldRenderArgs,
  ThemePalette,
} from "@mingla/offering-rendering";
import { PhoneInput } from "@mingla/phone-input";

import {
  BusinessRsvpPhoneField,
  businessRsvpPhoneTheme,
} from "../useBusinessRsvpPhoneField";

const palette = {
  page: "#ffffff",
  primaryText: "#111111",
  tertiaryText: "#666666",
  panelBorder: "#dddddd",
  accent: "#123456",
  card: "#f8f8f8",
  accentWash: "#eeeeee",
} as ThemePalette;

const theme = { foregroundColor: "#000000" } as ResolvedTheme;

describe("#1857 business RSVP phone renderer", () => {
  test("executes country-aware phone callbacks and keeps the web picker overlaid", () => {
    const onChangeRawValue = jest.fn();
    const onChangeCountry = jest.fn();
    const args = {
      countryCode: "GB",
      rawValue: "07700900123",
      onChangeCountry,
      onChangeRawValue,
      onBlur: jest.fn(),
      invalid: false,
      disabled: false,
      label: "Guest phone",
      testID: "guest-phone",
      required: true,
      emptyRequired: false,
      role: "primary",
      guestId: null,
      index: null,
      palette,
    } satisfies RsvpPhoneFieldRenderArgs;

    const field = BusinessRsvpPhoneField({
      args,
      palette,
      phoneFieldTheme: businessRsvpPhoneTheme(palette, theme),
    });
    const phoneInput = (
      field.props as { children: ReactElement<Record<string, unknown>>[] }
    ).children[1];

    expect(phoneInput.type).toBe(PhoneInput);
    expect(phoneInput.props.pickerPresentation).toBe("overlay");

    (phoneInput.props.onChangePhone as (value: string) => void)("07700 900456");
    expect(onChangeRawValue).toHaveBeenCalledWith(
      "07700 900456",
      "+447700900456",
    );

    (phoneInput.props.onChangeCountry as (value: string) => void)("US");
    expect(onChangeCountry).toHaveBeenCalledWith("US", null);
  });
});
