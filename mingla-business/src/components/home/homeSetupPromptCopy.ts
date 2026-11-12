/**
 * #4389 (screen H2) — host copy for Home's one-time setup sheet. It loads with
 * the sheet's own chunk. English: homeSetup.prompt.json (same `homeSetup`
 * namespace); other languages: hostSetup.json.
 */
import english from "../../i18n/locales/en/homeSetup.prompt.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`homeSetup.${key}`, variables);

export const HOME_SETUP_PROMPT_COPY = {
  h2: {
    title: (brand: string): string => t("h2.title", { brand }),
    get country(): string { return t("h2.country"); },
    get terms(): string { return t("h2.terms"); },
    get payments(): string { return t("h2.payments"); },
    get later(): string { return t("h2.later"); },
    get finish(): string { return t("h2.finish"); },
  },
};
