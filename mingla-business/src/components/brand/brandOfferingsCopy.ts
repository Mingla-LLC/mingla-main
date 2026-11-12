/**
 * #4389 (F4) — the offering names on "What do you want to make first?",
 * loaded with that list. English: brandSetup.offerings.json; other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.offerings.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_OFFERINGS_COPY = {
  offerings: {
    get event(): string { return t("offerings.event"); },
    get experience(): string { return t("offerings.experience"); },
    get trip(): string { return t("offerings.trip"); },
    get rsvp(): string { return t("offerings.rsvp"); },
    get venue(): string { return t("offerings.venue"); },
  },
};
