/**
 * #4389 (screens H1, H2, HT) — host copy for Home's setup card, the one-time
 * sheet and Taking payments from Home. Never "business", never a provider
 * name; always "Tap to Pay on iPhone" on iOS (Apple naming, every language).
 * The words live in src/i18n/locales/<lang>/ (English: homeSetup.json, other
 * languages: hostSetup.json); each property reads the current language.
 */
import english from "../../i18n/locales/en/homeSetup.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`homeSetup.${key}`, variables);

export const HOME_SETUP_COPY = {
  h1: {
    title: (brand: string): string => t("h1.title", { brand }),
    count: (done: number): string => t("h1.count", { done }),
    waiting: (client: string): string => t("h1.waiting", { client }),
    get moreNeeded(): string { return t("h1.moreNeeded"); },
    get cta(): string { return t("h1.cta"); },
    todoSub: (done: number): string => t("h1.todoSub", { done }),
    get progressLabel(): string { return t("h1.progressLabel"); },
  },
  h2: {
    title: (brand: string): string => t("h2.title", { brand }),
    get country(): string { return t("h2.country"); },
    get terms(): string { return t("h2.terms"); },
    get payments(): string { return t("h2.payments"); },
    get later(): string { return t("h2.later"); },
    get finish(): string { return t("h2.finish"); },
  },
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
  takePayment: {
    get pill(): string { return t("takePayment.pill"); },
    atDoorToday: (n: number, amount: string): string => t("takePayment.atDoorToday", { count: n, amount }),
    get noEventToday(): string { return t("takePayment.noEventToday"); },
    get openFailed(): string { return t("takePayment.openFailed"); },
  },
};
