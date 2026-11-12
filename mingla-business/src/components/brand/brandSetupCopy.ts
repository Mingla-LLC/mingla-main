/**
 * #4389 — host copy for the brand setup flow (design v11, binding words): F1
 * name, F2 bank country, F3 get paid, F4 done, N1 and the flow's interruptions.
 * Host copy never names a payment partner and never says "business" (U-7,
 * U-8). Tap to Pay on iPhone is always written in full (Apple naming), in
 * every language.
 *
 * Only the setup flow's chunk loads this module. The words other screens show
 * live next to them (brandSetupSharedCopy, brandSetupAddressCopy,
 * brandOnboardCopy, brandDeleteCopy, brandDeleteSharedCopy, brandSwitcherCopy,
 * brandOfferingsCopy, brandNewCopy, door/tap/f4TapToPayCopy): Metro hoists a
 * module more than one chunk imports into the eager web __common chunk.
 *
 * The words live in src/i18n/locales/<lang>/ (English: brandSetup.json and its
 * brandSetup.<part>.json siblings; other languages: hostSetup.json, loaded with
 * the language). Each property reads the current language when it is read,
 * with English as the fallback.
 */
import english from "../../i18n/locales/en/brandSetup.json";
import { businessT, registerBusinessEnglish } from "../../i18n";
import { BRAND_SETUP_SHARED_COPY } from "./brandSetupSharedCopy";

registerBusinessEnglish(english);

const t = (key: string, variables?: Record<string, string | number>): string =>
  businessT(`brandSetup.${key}`, variables);

export const BRAND_SETUP_COPY = {
  f1: {
    get title(): string { return t("f1.title"); },
    get label(): string { return t("f1.label"); },
    get helper(): string { return t("f1.helper"); },
    get cta(): string { return t("f1.cta"); },
    get tooLong(): string { return t("f1.tooLong"); },
    counterLabel: (n: number): string => t("f1.counterLabel", { n }),
    get authWarming(): string { return t("f1.authWarming"); },
    get discardTitle(): string { return t("f1.discardTitle"); },
    get discardBody(): string { return t("f1.discardBody"); },
    get discard(): string { return t("f1.discard"); },
    get keepEditing(): string { return t("f1.keepEditing"); },
    get sessionTitle(): string { return t("f1.sessionTitle"); },
    get sessionBody(): string { return t("f1.sessionBody"); },
    get signIn(): string { return t("f1.signIn"); },
  },
  f2: {
    get title(): string { return t("f2.title"); },
    get body(): string { return t("f2.body"); },
    get search(): string { return t("f2.search"); },
    get suggested(): string { return t("f2.suggested"); },
    footnote: (country: string, currency: string): string => t("f2.footnote", { country, currency }),
    noMatch: (query: string): string => t("f2.noMatch", { query }),
    get cantPayOut(): string { return t("f2.cantPayOut"); },
    locked: (country: string): string => t("f2.locked", { country }),
    get forbidden(): string { return t("f2.forbidden"); },
    conflict: (country: string): string => t("f2.conflict", { country }),
    get keep(): string { return t("f2.keep"); },
    get change(): string { return t("f2.change"); },
    get cta(): string { return t("f2.cta"); },
  },
  f3: {
    get title(): string { return t("f3.title"); },
    get change(): string { return t("f3.change"); },
    get terms(): string { return t("f3.terms"); },
    get readTerms(): string { return t("f3.readTerms"); },
    get termsHint(): string { return t("f3.termsHint"); },
    get stripeBody(): string { return t("f3.stripeBody"); },
    get stripeCta(): string { return t("f3.stripeCta"); },
    get continueSetup(): string { return t("f3.continueSetup"); },
    get returnedIncomplete(): string { return t("f3.returnedIncomplete"); },
    notOwner: (owner: string): string => t("f3.notOwner", { owner }),
    waitingClient: (client: string): string => t("f3.waitingClient", { client }),
    get otherDevice(): string { return t("f3.otherDevice"); },
    get refresh(): string { return t("f3.refresh"); },
    get ownerFallback(): string { return t("f3.ownerFallback"); },
    get trust(): string { return t("f3.trust"); },
    /** #4389 — the Nigerian bank card's accessibility label (no visible heading). */
    get ngCardLabel(): string { return t("f3.ngCardLabel"); },
  },
  f4: {
    get checkingTitle(): string { return t("f4.checkingTitle"); },
    get checkingBody(): string { return t("f4.checkingBody"); },
    get actionNeeded(): string { return t("f4.actionNeeded"); },
    get ngDone(): string { return t("f4.ngDone"); },
    get done(): string { return t("f4.done"); },
    get refreshErrorTitle(): string { return t("f4.refreshErrorTitle"); },
    get refreshErrorBody(): string { return t("f4.refreshErrorBody"); },
    get retry(): string { return t("f4.retry"); },
    get makeFirst(): string { return t("f4.makeFirst"); },
    get coverBio(): string { return t("f4.coverBio"); },
  },
  k1: BRAND_SETUP_SHARED_COPY.k1,
  common: {
    get later(): string { return t("common.later"); },
    get tryAgain(): string { return t("common.tryAgain"); },
    get back(): string { return t("common.back"); },
    get goHome(): string { return t("common.goHome"); },
    resume: (step: string): string => t("common.resume", { step }),
    deleted: (brand: string | null): string =>
      brand ? t("common.deleted", { brand }) : t("common.thisBrandDeleted"),
    noAccess: (brand: string | null): string =>
      brand ? t("common.noAccess", { brand }) : t("common.thisBrandNoAccess"),
    progress: (step: number): string => t("common.progress", { step }),
    get offline(): string { return BRAND_SETUP_SHARED_COPY.common.offline; },
    get serverError(): string { return BRAND_SETUP_SHARED_COPY.common.serverError; },
  },
  n1: {
    get title(): string { return t("n1.title"); },
    body: (brand: string): string => t("n1.body", { brand }),
    get oneAtATime(): string { return t("n1.oneAtATime"); },
    continue: (brand: string): string => t("n1.continue", { brand }),
    get discardNew(): string { return t("n1.discardNew"); },
    confirmTitle: (brand: string): string => t("n1.confirmTitle", { brand }),
    get confirmBody(): string { return t("n1.confirmBody"); },
    get confirmBodyPayments(): string { return t("n1.confirmBodyPayments"); },
    get discard(): string { return t("n1.discard"); },
    get keep(): string { return t("n1.keep"); },
    discardError: (brand: string): string => t("n1.discardError", { brand }),
  },
  stepNames: {
    get name(): string { return t("stepNames.name"); },
    get country(): string { return t("stepNames.country"); },
    get pay(): string { return t("stepNames.pay"); },
    get done(): string { return t("stepNames.done"); },
  },
};

/** Words that must never appear in host copy for this flow (U-7, U-8, Apple naming). */
export const BRAND_SETUP_BANNED_WORDS = [/stripe/i, /paystack/i, /\bbusiness\b/i, /\breader\b/i, /\bterminal\b/i, /\bhardware\b/i] as const;
