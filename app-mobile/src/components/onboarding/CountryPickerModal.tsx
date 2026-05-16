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
} from "@mingla/phone-input";

import { Icon } from "../ui/Icon";

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
}

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

export const CountryPickerModal: React.FC<CountryPickerModalProps> = (
  props,
) => {
  const iconRenderer = useConsumerIconRenderer();
  const labels = usePickerLabels();
  return (
    <PackageCountryPickerModal
      {...props}
      iconRenderer={iconRenderer}
      labels={labels}
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
