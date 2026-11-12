/**
 * #4389 — the brand setup words more than one screen chunk shows: K1 ("Skip
 * payments for now", also Ari's K1 card and Home's toast) and the offline /
 * server error lines (the setup flow, Ari, the Tap to Pay address screen).
 * Every other brand setup word loads with its own screen's chunk.
 * English: brandSetup.shared.json (namespace `brandSetup`); other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.shared.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_SETUP_SHARED_COPY = {
  k1: {
    get title(): string { return t("k1.title"); },
    get body(): string { return t("k1.body"); },
    get bodyAndroid(): string { return t("k1.bodyAndroid"); },
    get later(): string { return t("k1.later"); },
    get bankNow(): string { return t("k1.bankNow"); },
    get freeOnly(): string { return t("k1.freeOnly"); },
    get toast(): string { return t("k1.toast"); },
  },
  common: {
    get offline(): string { return t("common.offline"); },
    get serverError(): string { return t("common.serverError"); },
  },
};
