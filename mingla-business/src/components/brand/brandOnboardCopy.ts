/**
 * #4389 — the bank setup screen's words (/brand/{id}/payments/onboard and its
 * web body). English: brandSetup.onboard.json; other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.onboard.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_ONBOARD_COPY = {
  /** #4389 — the bank setup screen (/brand/{id}/payments/onboard). */
  onboard: {
    get title(): string { return t("onboard.title"); },
    get body(): string { return t("onboard.body"); },
    get opening(): string { return t("onboard.opening"); },
    get checking(): string { return t("onboard.checking"); },
    get checkingSub(): string { return t("onboard.checkingSub"); },
    get haveReady(): string { return t("onboard.haveReady"); },
    get readyId(): string { return t("onboard.readyId"); },
    readyBank: (country: string | null): string =>
      country === null ? t("onboard.readyBankAny") : t("onboard.readyBank", { country }),
    get readyTax(): string { return t("onboard.readyTax"); },
  },
};
