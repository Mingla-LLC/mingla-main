/**
 * #4389 (N1) — the /brand/new route's own words ("{brand} was discarded"),
 * loaded with that route. English: brandSetup.new.json; other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.new.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_NEW_COPY = {
  n1: {
    discarded: (brand: string): string => t("n1.discarded", { brand }),
  },
};
