/**
 * PhoneInput — app-mobile thin wrapper around `@mingla/phone-input`.
 *
 * Per ORCH-0847 Phase A — the implementation moved to a shared package so
 * mingla-business can reuse it for the public buyer form. This wrapper
 * preserves the original consumer API (no iconRenderer/labels prop) by baking
 * in the app-mobile Icon set and i18n labels, so the 9 existing callers
 * (onboarding flow, AddFriendView, AccountSettings, etc.) keep working
 * unchanged.
 */

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  PhoneInput as PackagePhoneInput,
  type IconRenderer,
  type PhoneInputLabels,
  type PhoneInputTheme,
} from "@mingla/phone-input";

import { Icon } from "../ui/Icon";

interface PhoneInputProps {
  value: string;
  countryCode: string;
  onChangePhone: (phone: string) => void;
  onChangeCountry: (code: string) => void;
  error: string | null;
  disabled: boolean;
  theme?: PhoneInputTheme;
  showDoneAccessory?: boolean;
}

export const PhoneInput: React.FC<PhoneInputProps> = (props) => {
  const { t } = useTranslation("onboarding");

  const iconRenderer = useCallback<IconRenderer>(
    (name, iconProps) => {
      const iconName =
        name === "chevronDown"
          ? "chevron-down"
          : name === "checkmark"
            ? "checkmark"
            : name === "close"
              ? "close"
              : "search-outline";
      return (
        <Icon
          name={iconName}
          size={iconProps.size}
          color={iconProps.color}
        />
      );
    },
    [],
  );

  const labels: PhoneInputLabels = {
    phonePlaceholder: t("phone.placeholder_phone"),
    countryButtonAccessibilityLabel: (name) =>
      t("phone.country_accessibility", { name }),
    phoneInputAccessibilityLabel: t("phone.headline"),
    doneButton: t("common:done"),
    pickerTitle: "Select Country",
    pickerSearchPlaceholder: t("onboarding:country_picker.search_placeholder"),
    pickerCloseAccessibilityLabel: t(
      "onboarding:country_picker.close_accessibility",
    ),
  };

  return (
    <PackagePhoneInput
      {...props}
      iconRenderer={iconRenderer}
      labels={labels}
    />
  );
};
