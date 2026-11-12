/**
 * #4389 (screen HT) — host copy for Home's Tap to Pay card and its To do row.
 * Always "Tap to Pay on iPhone" on iOS (Apple naming, every language). It
 * loads with the card's own chunk. English: homeSetup.tap.json (same
 * `homeSetup` namespace); other languages: hostSetup.json.
 */
import english from "../../i18n/locales/en/homeSetup.tap.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`homeSetup.${key}`, variables);

export const HOME_SETUP_TAP_COPY = {
  ht: {
    get iosTitle(): string { return t("ht.iosTitle"); },
    get iosBody(): string { return t("ht.iosBody"); },
    get terms(): string { return t("ht.terms"); },
    get androidTitle(): string { return t("ht.androidTitle"); },
    get androidBody(): string { return t("ht.androidBody"); },
    get getStarted(): string { return t("ht.getStarted"); },
    get notNow(): string { return t("ht.notNow"); },
    notOwner: (owner: string, brand: string): string => t("ht.notOwner", { owner, brand }),
    notOwnerIos: (owner: string, brand: string): string => t("ht.notOwnerIos", { owner, brand }),
    get ownerFallback(): string { return t("ht.ownerFallback"); },
    get todoIos(): string { return t("ht.todoIos"); },
    get todoAndroid(): string { return t("ht.todoAndroid"); },
    get todoSub(): string { return t("ht.todoSub"); },
  },
};
