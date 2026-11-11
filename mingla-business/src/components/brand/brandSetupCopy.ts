/**
 * #4389 — host copy for brand setup (design v11, binding words).
 * Host copy never names a payment partner and never says "business" (U-7,
 * U-8). Tap to Pay on iPhone is always written in full (Apple naming).
 * [TRANSITIONAL] English only — exit: move these keys into the app's locale
 * files for every shipped language (#4389 i18n remainder in the build log).
 */
export const BRAND_SETUP_COPY = {
  f1: {
    title: "Name your brand",
    label: "Brand name",
    helper: "This is what guests see on tickets and your page.",
    cta: "Continue",
    tooLong: "Use 60 characters or fewer.",
    authWarming: "Getting things ready…",
    discardTitle: "Discard this brand name?",
    discardBody: "It hasn't been saved yet.",
    discard: "Discard",
    keepEditing: "Keep editing",
  },
  f2: {
    title: "Where will you collect funds?",
    body: "Pick the country your bank account is in. Prices and payouts use its currency.",
    search: "Search bank countries",
    suggested: "Suggested",
    footnote: (country: string, cur: string): string => `Payouts go to a bank in ${country}, in ${cur}.`,
    noMatch: (q: string): string => `No bank country matches '${q}'.`,
    cantPayOut: "Mingla can't pay out there yet",
    locked: (country: string): string =>
      `Payouts are already set up for a bank in ${country}. To use another country, disconnect payments first.`,
    forbidden: "Only the brand owner or an admin can change the bank country.",
    conflict: (country: string): string => `This was changed on another device to ${country}.`,
    keep: "Keep",
    change: "Change",
    cta: "Continue",
  },
  f3: {
    title: "Get paid",
    change: "Change",
    terms: "I agree to the Mingla Organiser Terms",
    readTerms: "Read terms",
    termsHint: "Tick the Organiser Terms to continue.",
    stripeBody: "On the next screen you'll add your ID and bank details. Have them ready.",
    stripeCta: "Continue to secure setup",
    continueSetup: "Continue setup",
    returnedIncomplete: "You left before finishing. Pick up where you stopped.",
    notOwner: (owner: string): string => `Only ${owner} can set up payments. We've added it to their Home.`,
    waitingClient: (client: string): string => `Waiting for ${client} to accept and add bank details`,
    otherDevice: "Finishing on your other device…",
    trust: "Your bank details go straight to our payment partner. Mingla never sees them.",
    ngHeading: "Your Nigerian bank",
  },
  f4: {
    checkingTitle: "Details sent.",
    checkingBody: "We're checking them. This usually takes a few minutes. You can keep going.",
    actionNeeded: "One more thing is needed before you can take payments:",
    ngDone: "Bank connected. You're ready to sell.",
    done: "You're all set.",
    refreshErrorTitle: "Couldn't check right now.",
    refreshErrorBody: "We'll update you.",
    retry: "Try again",
    makeFirst: "What do you want to make first?",
    coverBio: "Add a cover and bio",
    ttpTitle: "Tap to Pay on iPhone",
    ttpBody:
      "Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone.",
    ttpTerms: "Terms apply.",
    ttpCta: "Set up Tap to Pay on iPhone",
  },
  k1: {
    title: "Only free events for now?",
    body:
      "Until your bank is set up, you can create and publish free events and RSVPs. You can't sell tickets or take payments, including Tap to Pay on iPhone.",
    bodyAndroid:
      "Until your bank is set up, you can create and publish free events and RSVPs. You can't sell tickets or take payments, including Tap to Pay.",
    later: "Finish any time from Home or Ari.",
    bankNow: "Set up bank now",
    freeOnly: "Free events only for now",
    toast: "Saved. You can create free events. Set up your bank to sell tickets.",
  },
  common: {
    later: "Save and finish later",
    offline: "You're offline. Your answers are saved.",
    serverError: "We couldn't save that. Try again.",
    tryAgain: "Try again",
    back: "Back",
    goHome: "Go to Home",
    resume: (step: string): string => `Welcome back. You stopped at ${step}.`,
    deleted: (brand: string): string => `${brand} was deleted on another device.`,
    noAccess: (brand: string): string => `You no longer have access to set up ${brand}.`,
    progress: (n: number): string => `Step ${n} of 4`,
  },
  n1: {
    title: "You have a brand in progress",
    body: (brand: string): string =>
      `${brand} isn't finished yet. Pick up where you stopped, or discard it and start a new one.`,
    oneAtATime: "You can have one brand in progress at a time.",
    continue: (brand: string): string => `Continue ${brand}`,
    discardNew: "Discard and start new",
    confirmTitle: (brand: string): string => `Discard ${brand}?`,
    confirmBody: "Its name and setup progress will be deleted. This can't be undone.",
    confirmBodyPayments: " Its payment setup will be closed too.",
    discard: "Discard",
    keep: "Keep it",
    discardError: (brand: string): string => `We couldn't discard ${brand}. Try again.`,
    discarded: (brand: string): string => `${brand} discarded.`,
  },
  t1: {
    title: "Where will you take card payments?",
    helper: "Only used for Tap to Pay on iPhone. Not shown to guests.",
    helperAndroid: "Only used for Tap to Pay. Not shown to guests.",
    search: "Start typing your address",
    searchHelper: "Pick it from the list and we fill in the rest.",
    poweredByGoogle: "Powered by Google",
    noMatch: (country: string, postal: string): string =>
      `No match in ${country}. Check the spelling, or try the ${postal}.`,
    buildingNumber: "Building number",
    buildingNumberError: "Add the building number.",
    unit: "Add apartment or unit",
    refused: "We couldn't use that address. Pick it from the list again.",
    change: "Change",
    save: "Save address",
  },
  stepNames: {
    name: "Name your brand",
    country: "Bank country",
    pay: "Get paid",
    done: "You're all set",
  },
} as const;

/** Words that must never appear in host copy for this flow (U-7, U-8, Apple naming). */
export const BRAND_SETUP_BANNED_WORDS = [/stripe/i, /paystack/i, /\bbusiness\b/i, /\breader\b/i, /\bterminal\b/i, /\bhardware\b/i] as const;
