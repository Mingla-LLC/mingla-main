/**
 * CountryPickerModal + CountryPickerOverlay — app-mobile thin wrappers
 * around `@mingla/phone-input`.
 *
 * Per ORCH-0847 Phase A — implementations moved to the shared package.
 * Existing callers (PhoneInput, CollaborationModule overlay variants, etc.)
 * continue to import from this path; the wrappers bake in the app-mobile
 * Icon set and i18n labels.
 */

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  CountryPickerModal as PackageCountryPickerModal,
  CountryPickerOverlay as PackageCountryPickerOverlay,
  type IconRenderer,
  type PhoneInputLabels,
  type PhoneInputTheme,
} from "@mingla/phone-input";

import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";

type PickerLabels = Pick<
  PhoneInputLabels,
  "pickerTitle" | "pickerSearchPlaceholder" | "pickerCloseAccessibilityLabel"
>;

interface CountryPickerContentProps {
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

interface CountryPickerModalProps extends CountryPickerContentProps {
  visible: boolean;
  /**
   * Issue #4114 QA run 2: the Chats tab opens the picker over the dark chat
   * screen, so it asks for the dark surface. Onboarding, settings and the pair
   * request keep the light default.
   */
  tone?: "light" | "dark";
}

/** Issue #4114 QA run 2: the picker on the dark chat surface (chatTokens). */
export const CHAT_DARK_COUNTRY_PICKER_THEME: PhoneInputTheme = {
  backgroundPrimary: chatTokens.surface,
  textPrimary: chatTokens.textPrimary,
  textTertiary: chatTokens.textSoft,
  searchBackground: chatTokens.surfaceRaised,
  rowPressedBackground: chatTokens.strip,
  divider: chatTokens.hairline,
  accent: chatTokens.accent,
};

const useConsumerIconRenderer = (): IconRenderer => {
  return useCallback<IconRenderer>((name, iconProps) => {
    const iconName =
      name === "chevronDown"
        ? "chevron-down"
        : name === "checkmark"
          ? "checkmark"
          : name === "close"
            ? "close"
            : "search-outline";
    return (
      <Icon name={iconName} size={iconProps.size} color={iconProps.color} />
    );
  }, []);
};

const usePickerLabels = (): PickerLabels => {
  const { t } = useTranslation(["onboarding"]);
  return {
    pickerTitle: "Select Country",
    pickerSearchPlaceholder: t("onboarding:country_picker.search_placeholder"),
    pickerCloseAccessibilityLabel: t(
      "onboarding:country_picker.close_accessibility",
    ),
  };
};

export const CountryPickerModal: React.FC<CountryPickerModalProps> = ({
  tone = "light",
  ...props
}) => {
  const iconRenderer = useConsumerIconRenderer();
  const labels = usePickerLabels();
  return (
    <PackageCountryPickerModal
      {...props}
      iconRenderer={iconRenderer}
      labels={labels}
      theme={tone === "dark" ? CHAT_DARK_COUNTRY_PICKER_THEME : undefined}
    />
  );
};

export const CountryPickerOverlay: React.FC<CountryPickerContentProps> = (
  props,
) => {
  const iconRenderer = useConsumerIconRenderer();
  const labels = usePickerLabels();
  return (
    <PackageCountryPickerOverlay
      {...props}
      iconRenderer={iconRenderer}
      labels={labels}
    />
  );
};
