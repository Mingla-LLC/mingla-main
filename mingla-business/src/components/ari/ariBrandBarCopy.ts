/**
 * #4389 (screen AB) — host copy for Ari's top bar and brand switch. The words
 * live in src/i18n/locales/<lang>/ (English: ariSetup.json `bar`, other
 * languages: hostSetup.json); each property reads the current language.
 */
import english from "../../i18n/locales/en/ariSetup.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string>): string =>
  businessT(`ariSetup.bar.${key}`, variables);

export const ARI_BRAND_BAR_COPY = {
  get switcherTitle(): string { return t("switcherTitle"); },
  get chats(): string { return t("chats"); },
  get settings(): string { return t("settings"); },
  get busyTitle(): string { return t("busyTitle"); },
  busyBody: (next: string, current: string): string => t("busyBody", { next, current }),
  busySwitch: (next: string): string => t("busySwitch", { next }),
  busyStay: (current: string): string => t("busyStay", { current }),
  switched: (next: string): string => t("switched", { next }),
  draftKept: (other: string): string => t("draftKept", { other }),
};
