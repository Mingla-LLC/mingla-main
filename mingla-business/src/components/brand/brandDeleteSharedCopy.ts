/**
 * #4389 — the delete words the delete sheet, Ari's delete card and the brand
 * profile all show (what happens to payments, how to restore). English:
 * brandSetup.deleteShared.json; other languages: hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.deleteShared.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_DELETE_SHARED_COPY = {
  delete: {
    get closedOnDelete(): string { return t("delete.closedOnDelete"); },
    get none(): string { return t("delete.none"); },
    get restoreTitle(): string { return t("delete.restoreTitle"); },
    get restoreBody(): string { return t("delete.restoreBody"); },
    get bankPayouts(): string { return t("delete.bankPayouts"); },
    get bankPayoutsSwitchedOff(): string { return t("delete.bankPayoutsSwitchedOff"); },
  },
};
