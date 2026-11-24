/**
 * #4541 R2.7 / R2.12 — the Explorer's primitives for @mingla/form-rendering:
 * the dark purchase palette, the app Icon, the native date path, a WHITE
 * required asterisk (Q9; "(optional)" still marks the other questions so
 * colour never carries the meaning alone) and every package word from the
 * `forms` namespace.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  FormIconProps,
  FormRenderingCopy,
  FormRenderingPrimitives,
} from "@mingla/form-rendering";

import { Icon } from "../ui/Icon";
import { RsvpFormWebDateInput } from "./RsvpFormWebDateInput";

/** The dark purchase palette the form screen, card and cart block draw on. */
export const FORM_DARK = {
  page: "#0b0d11",
  panel: "#171a20",
  panelStrong: "#20242c",
  line: "rgba(255,255,255,0.10)",
  text1: "#ffffff",
  text2: "rgba(255,255,255,0.72)",
  text3: "rgba(255,255,255,0.56)",
  accent: "#eb7825",
  accentWash: "rgba(235,120,37,0.14)",
  accentLine: "rgba(235,120,37,0.42)",
  danger: "#f87171",
  warning: "#fbbf24",
  requiredMark: "#ffffff",
} as const;

const FormIcon: React.FC<FormIconProps> = (props) => (
  <Icon name={props.name} size={props.size} color={props.color} strokeWidth={props.strokeWidth} />
);

/** The package words, translated (fields left out fall back to English). */
export function useFormRenderingCopy(): Partial<FormRenderingCopy> {
  const { t } = useTranslation("forms");
  return useMemo<Partial<FormRenderingCopy>>(() => ({
    shownToDoorStaff: t("shownToDoorStaff"),
    answersSeenLine: t("doorLine"),
    optional: t("optional"),
    untitledQuestion: t("untitledQuestion"),
    requiredToContinue: t("needsAnswers"),
    fieldErrors: {
      required: t("fieldRequired"),
      type: t("fieldType"),
      option: t("fieldOption"),
      too_long: t("fieldTooLong"),
    },
    textPlaceholder: t("textPlaceholder"),
    numberPlaceholder: t("numberPlaceholder"),
    numberMin: (min: string) => t("numberMin", { min }),
    numberMax: (max: string) => t("numberMax", { max }),
    datePlaceholder: t("datePlaceholder"),
    dateCancel: t("dateCancel"),
    dateSet: t("dateSet"),
    brandFallbackName: t("theHost"),
    fromBrand: (brand: string) => t("fromBrand", { brand }),
    fromHost: t("fromHost"),
  }), [t]);
}

export function useFormPrimitives(): FormRenderingPrimitives {
  const copy = useFormRenderingCopy();
  return useMemo<FormRenderingPrimitives>(() => ({
    tokens: {
      color: {
        danger: FORM_DARK.danger,
        warning: FORM_DARK.warning,
        accent: FORM_DARK.accent,
        accentLine: FORM_DARK.accentLine,
        line: FORM_DARK.line,
        text1: FORM_DARK.text1,
        text2: FORM_DARK.text2,
        text3: FORM_DARK.text3,
        text4: FORM_DARK.text3,
        textStrong: FORM_DARK.text1,
        fill: { inset: FORM_DARK.panelStrong },
        requiredMark: FORM_DARK.requiredMark,
      },
      radius: { sm: 8, md: 12 },
      space: { 1: 4, 2: 8, 4: 16, 6: 24 },
      type: {
        body: { fontSize: 16, lineHeight: 24 },
        caption: { fontSize: 12, lineHeight: 16 },
        small: { fontSize: 14, lineHeight: 20 },
      },
    },
    Icon: FormIcon,
    WebDateTimeInput: RsvpFormWebDateInput,
    copy,
  }), [copy]);
}
