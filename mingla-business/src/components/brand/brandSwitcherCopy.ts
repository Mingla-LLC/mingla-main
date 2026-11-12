/**
 * #4389 (screen N3) — the brand switcher's draft row words, loaded with the
 * switcher. English: brandSetup.switcher.json; other languages:
 * hostSetup.json.
 */
import english from "../../i18n/locales/en/brandSetup.switcher.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_SWITCHER_COPY = {
  n3: {
    get draftLabel(): string { return t("n3.draftLabel"); },
    progress: (done: number): string => t("n3.progress", { done }),
    get freeOnlyTag(): string { return t("n3.freeOnlyTag"); },
    get continue(): string { return t("n3.continue"); },
    get discard(): string { return t("n3.discard"); },
  },
};
