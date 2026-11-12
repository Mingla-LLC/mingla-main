/**
 * #4389 (screens H1, HT) — host copy for Home's setup card and Taking payments
 * from Home. Never "business", never a provider name. The one-time sheet (H2)
 * and the Tap to Pay card (HT) carry their own words (homeSetupPromptCopy.ts,
 * homeSetupTapCopy.ts) so each loads with its own chunk, not with the app.
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
  takePayment: {
    get pill(): string { return t("takePayment.pill"); },
    atDoorToday: (n: number, amount: string): string => t("takePayment.atDoorToday", { count: n, amount }),
    get noEventToday(): string { return t("takePayment.noEventToday"); },
    get openFailed(): string { return t("takePayment.openFailed"); },
  },
};
