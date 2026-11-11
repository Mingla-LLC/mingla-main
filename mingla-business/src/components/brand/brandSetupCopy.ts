/**
 * #4389 — host copy for brand setup (design v11, binding words).
 * Host copy never names a payment partner and never says "business" (U-7,
 * U-8). Tap to Pay on iPhone is always written in full (Apple naming), in
 * every language.
 *
 * The words live in src/i18n/locales/<lang>/ (English: brandSetup.json, kept
 * next to this module so the eager bundle does not grow; other languages:
 * hostSetup.json, loaded with the language). Each property reads the current
 * language when it is read, with English as the fallback.
 */
import english from "../../i18n/locales/en/brandSetup.json";
import { businessT, registerBusinessEnglish } from "../../i18n";

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
    get ngHeading(): string { return t("f3.ngHeading"); },
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
    get ttpTitle(): string { return t("f4.ttpTitle"); },
    get ttpBody(): string { return t("f4.ttpBody"); },
    get ttpTerms(): string { return t("f4.ttpTerms"); },
    get ttpCta(): string { return t("f4.ttpCta"); },
  },
  k1: {
    get title(): string { return t("k1.title"); },
    get body(): string { return t("k1.body"); },
    get bodyAndroid(): string { return t("k1.bodyAndroid"); },
    get later(): string { return t("k1.later"); },
    get bankNow(): string { return t("k1.bankNow"); },
    get freeOnly(): string { return t("k1.freeOnly"); },
    get toast(): string { return t("k1.toast"); },
  },
  common: {
    get later(): string { return t("common.later"); },
    get offline(): string { return t("common.offline"); },
    get serverError(): string { return t("common.serverError"); },
    get tryAgain(): string { return t("common.tryAgain"); },
    get back(): string { return t("common.back"); },
    get goHome(): string { return t("common.goHome"); },
    resume: (step: string): string => t("common.resume", { step }),
    deleted: (brand: string | null): string =>
      brand ? t("common.deleted", { brand }) : t("common.thisBrandDeleted"),
    noAccess: (brand: string | null): string =>
      brand ? t("common.noAccess", { brand }) : t("common.thisBrandNoAccess"),
    progress: (step: number): string => t("common.progress", { step }),
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
    discarded: (brand: string): string => t("n1.discarded", { brand }),
  },
  n3: {
    draft: (done: number): string => t("n3.draft", { done }),
    get freeOnly(): string { return t("n3.freeOnly"); },
    get continue(): string { return t("n3.continue"); },
    get discard(): string { return t("n3.discard"); },
  },
  t1: {
    get title(): string { return t("t1.title"); },
    get helper(): string { return t("t1.helper"); },
    get helperAndroid(): string { return t("t1.helperAndroid"); },
    get search(): string { return t("t1.search"); },
    get searchHelper(): string { return t("t1.searchHelper"); },
    get poweredByGoogle(): string { return t("t1.poweredByGoogle"); },
    noMatch: (country: string, postal: string): string => t("t1.noMatch", { country, postal }),
    get buildingNumber(): string { return t("t1.buildingNumber"); },
    get buildingNumberError(): string { return t("t1.buildingNumberError"); },
    get unit(): string { return t("t1.unit"); },
    get refused(): string { return t("t1.refused"); },
    get change(): string { return t("t1.change"); },
    get save(): string { return t("t1.save"); },
  },
  /** #4389 — the bank setup screen (/brand/{id}/payments/onboard). */
  onboard: {
    get title(): string { return t("onboard.title"); },
    get body(): string { return t("onboard.body"); },
    get opening(): string { return t("onboard.opening"); },
    get haveReady(): string { return t("onboard.haveReady"); },
    get readyId(): string { return t("onboard.readyId"); },
    readyBank: (country: string | null): string =>
      country === null ? t("onboard.readyBankAny") : t("onboard.readyBank", { country }),
    get readyTax(): string { return t("onboard.readyTax"); },
  },
  stepNames: {
    get name(): string { return t("stepNames.name"); },
    get country(): string { return t("stepNames.country"); },
    get pay(): string { return t("stepNames.pay"); },
    get done(): string { return t("stepNames.done"); },
  },
  offerings: {
    get event(): string { return t("offerings.event"); },
    get experience(): string { return t("offerings.experience"); },
    get trip(): string { return t("offerings.trip"); },
    get rsvp(): string { return t("offerings.rsvp"); },
    get venue(): string { return t("offerings.venue"); },
  },
  delete: {
    get blockedBalance(): string { return t("delete.blockedBalance"); },
    get blockedEvents(): string { return t("delete.blockedEvents"); },
    get blockedPaying(): string { return t("delete.blockedPaying"); },
    get blockedPartner(): string { return t("delete.blockedPartner"); },
    get blockedPayout(): string { return t("delete.blockedPayout"); },
    get closedOnDelete(): string { return t("delete.closedOnDelete"); },
    get none(): string { return t("delete.none"); },
    get cantDeleteYet(): string { return t("delete.cantDeleteYet"); },
    get nothingDeleted(): string { return t("delete.nothingDeleted"); },
    get closeRefused(): string { return t("delete.closeRefused"); },
    get close(): string { return t("delete.close"); },
  },
};

/** Words that must never appear in host copy for this flow (U-7, U-8, Apple naming). */
export const BRAND_SETUP_BANNED_WORDS = [/stripe/i, /paystack/i, /\bbusiness\b/i, /\breader\b/i, /\bterminal\b/i, /\bhardware\b/i] as const;
