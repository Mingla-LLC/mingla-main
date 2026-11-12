/**
 * #4389 (F4) — the Tap to Pay on iPhone card's words, loaded with the card (in
 * the door chunk). Always "Tap to Pay on iPhone" (Apple naming, every
 * language). English: brandSetup.f4card.json; other languages: hostSetup.json.
 */
import english from "../../../i18n/locales/en/brandSetup.f4card.json";
import { businessT, registerBusinessEnglish } from "../../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const F4_TAP_TO_PAY_COPY = {
  f4: {
    get ttpTitle(): string { return t("f4.ttpTitle"); },
    get ttpBody(): string { return t("f4.ttpBody"); },
    get ttpTerms(): string { return t("f4.ttpTerms"); },
    get ttpCta(): string { return t("f4.ttpCta"); },
    get ttpOn(): string { return t("f4.ttpOn"); },
    get takePayment(): string { return t("f4.takePayment"); },
  },
};
