/**
 * #4389 (screens H1, H2, HT) — host copy for Home's setup card, the one-time
 * sheet and Taking payments from Home. Never "business", never a provider
 * name; always "Tap to Pay on iPhone" on iOS (Apple naming).
 * [TRANSITIONAL] English only — exit: moved into the locale files with the
 * rest of the #4389 copy (i18n remainder in the build log).
 */
export const HOME_SETUP_COPY = {
  h1: {
    title: (brand: string): string => `Finish setting up ${brand}`,
    count: (done: number): string => `${done} of 4`,
    waiting: (client: string): string => `Waiting for ${client}`,
    moreNeeded: "One more thing",
    cta: "Continue",
    todoSub: (done: number): string => `${done} of 4 done`,
  },
  h2: {
    title: (brand: string): string => `${brand} needs a few details before it can take payments.`,
    country: "Bank country",
    terms: "Organiser Terms",
    payments: "Payment details",
    later: "Later",
    finish: "Finish now",
  },
  ht: {
    iosTitle: "Tap to Pay on iPhone",
    iosBody:
      "Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone.",
    terms: "Terms apply.",
    androidTitle: "Tap to Pay",
    androidBody: "Guests tap a card or phone on your Android phone to pay at the door.",
    getStarted: "Get started",
    notNow: "Not now",
    notOwner: (owner: string, brand: string): string =>
      `Only ${owner} can turn this on for ${brand}.`,
    notOwnerIos: (owner: string, brand: string): string =>
      `Only ${owner} can turn this on for ${brand}. We've let them know.`,
    ownerFallback: "the owner",
    todoIos: "Set up Tap to Pay on iPhone",
    todoAndroid: "Set up Tap to Pay",
    todoSub: "Take card payments at the door",
  },
  takePayment: {
    pill: "Take a payment",
    chip: "Take a payment",
    atDoorToday: (n: number, amount: string): string =>
      `At the door today · ${n} ${n === 1 ? "sale" : "sales"} · ${amount}`,
    noEventToday: "Nothing on today to sell for. Take payments on the day of an event.",
    openFailed: "Couldn't open the door sale. Try again.",
  },
} as const;
