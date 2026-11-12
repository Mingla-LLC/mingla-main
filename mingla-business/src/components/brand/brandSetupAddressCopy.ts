/**
 * #4389 (screen T1) — the Tap to Pay on iPhone address screen's words, loaded
 * with that route. English: brandSetup.address.json; other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.address.json";
import { BRAND_SETUP_SHARED_COPY } from "./brandSetupSharedCopy";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_SETUP_ADDRESS_COPY = {
  t1: {
    get title(): string { return t("t1.title"); },
    get helper(): string { return t("t1.helper"); },
    get helperAndroid(): string { return t("t1.helperAndroid"); },
    get search(): string { return t("t1.search"); },
    get searchHelper(): string { return t("t1.searchHelper"); },
    get poweredByGoogle(): string { return t("t1.poweredByGoogle"); },
    noMatch: (country: string, postal: string): string => t("t1.noMatch", { country, postal }),
    get buildingNumber(): string { return t("t1.buildingNumber"); },
    get buildingNumberError(): string { return t("t1.buildingNumberError"); },
    get unit(): string { return t("t1.unit"); },
    get refused(): string { return t("t1.refused"); },
    get change(): string { return t("t1.change"); },
    get save(): string { return t("t1.save"); },
  },
  /** The offline line, shared with the setup flow and Ari. */
  common: BRAND_SETUP_SHARED_COPY.common,
};
