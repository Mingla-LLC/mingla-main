/**
 * #4389 (screens A1–A5) — host copy for Ari's brand setup cards. Never
 * "business", never a provider name. The cards render from tool results and
 * the server checklist, not from Ari's words (AR-2). The words live in
 * src/i18n/locales/<lang>/ (English: ariSetup.json, other languages:
 * hostSetup.json); each property reads the current language.
 */
import { STRIPE_SUPPORTED_COUNTRIES } from "../../constants/stripeSupportedCountries";
import english from "../../i18n/locales/en/ariSetup.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`ariSetup.${key}`, variables);

/** The four setup rows, in order (a getter so each read is in the current language). */
export const ariSetupItems = (): readonly [string, string, string, string] => [
  t("items.name"),
  t("items.country"),
  t("items.terms"),
  t("items.payments"),
];

export const ARI_SETUP_COPY = {
  a1: {
    headline: (first: string | null): string => (first ? t("a1.headlineNamed", { first }) : t("a1.headline")),
    get body(): string { return t("a1.body"); },
    get cardTitle(): string { return t("a1.cardTitle"); },
    get minutes(): string { return t("a1.minutes"); },
    get setUp(): string { return t("a1.setUp"); },
    get withAri(): string { return t("a1.withAri"); },
    get withAriMessage(): string { return t("a1.withAriMessage"); },
    get offline(): string { return t("a1.offline"); },
  },
  a2: {
    lead: (brand: string, done: number, next: string): string => t("a2.lead", { brand, done, next }),
    count: (done: number): string => t("a2.count", { done }),
    waiting: (client: string): string => t("a2.waiting", { client }),
    get cta(): string { return t("a2.cta"); },
    get allSet(): string { return t("a2.allSet"); },
    get error(): string { return t("a2.error"); },
    get retry(): string { return t("a2.retry"); },
    get progressLabel(): string { return t("a2.progressLabel"); },
  },
  a3: {
    question: (name: string, country: string, currency: string): string =>
      t("a3.question", { name, country, currency }),
    questionNoCountry: (name: string): string => t("a3.questionNoCountry", { name }),
    get thisBrand(): string { return t("a3.thisBrand"); },
    get fundsLabel(): string { return t("a3.fundsLabel"); },
    get expired(): string { return t("a3.expired"); },
    duplicate: (name: string): string => t("a3.duplicate", { name }),
    get continue(): string { return t("a3.continue"); },
    get createNew(): string { return t("a3.createNew"); },
  },
  a4: {
    get secureTitle(): string { return t("a4.secureTitle"); },
    get secureBody(): string { return t("a4.secureBody"); },
    get open(): string { return t("a4.open"); },
    get termsTitle(): string { return t("a4.termsTitle"); },
    get termsBody(): string { return t("a4.termsBody"); },
    get termsCta(): string { return t("a4.termsCta"); },
    get countryTitle(): string { return t("a4.countryTitle"); },
    get countryBody(): string { return t("a4.countryBody"); },
    get countryCta(): string { return t("a4.countryCta"); },
    get owner(): string { return t("a4.owner"); },
    get doorTitle(): string { return t("a4.doorTitle"); },
    get doorBody(): string { return t("a4.doorBody"); },
    get doorCta(): string { return t("a4.doorCta"); },
  },
  a5: {
    get notice(): string { return t("a5.notice"); },
    get open(): string { return t("a5.open"); },
  },
  get brandMismatch(): string { return t("brandMismatch"); },
};

/** "Canada (CAD)" for a bank country code, or null when unknown. */
export function payoutCountryLabel(code: unknown): { name: string; currency: string } | null {
  if (typeof code !== "string") return null;
  const cc = code.trim().toUpperCase();
  if (cc === "NG") return { name: "Nigeria", currency: "NGN" };
  const hit = STRIPE_SUPPORTED_COUNTRIES.find((c) => c.country === cc);
  return hit ? { name: hit.displayName, currency: hit.defaultCurrency } : null;
}
