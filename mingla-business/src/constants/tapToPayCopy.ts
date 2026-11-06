/**
 * #4271 — every new Tap to Pay string, in one place. No React Native imports;
 * anything that depends on the platform takes `os`, so "iPhone" can never reach
 * an Android screen by accident.
 *
 * Device-facing text uses tapToPayName(os). Records (labels, reconciliation,
 * orders, CSV) and the shared push use TAP_TO_PAY_SHORT, because they are read
 * on other devices and on the web.
 */
export const TAP_TO_PAY_SHORT = "Tap to Pay";

export const tapToPayName = (os: string): string =>
  os === "ios" ? "Tap to Pay on iPhone" : TAP_TO_PAY_SHORT;

export const TAP_UPDATE_IOS_COPY = {
  title: "Update iOS to use Tap to Pay on iPhone",
  body: "Tap to Pay on iPhone needs iOS 17.6 or later. Update in Settings, then come back. Or use a pay code now. It works on any phone.",
  primary: "Open Settings",
  secondary: "Use a pay code",
} as const;

/** Reader failures Apple tells apart. "terms_not_accepted" routes to setup instead. */
export type TapReaderProblem =
  | "icloud_required"
  | "terms_cancelled"
  | "terms_failed"
  | "prepare_failed"
  | "device_banned"
  | "merchant_blocked";

/** Only a reader failure a retry can't fix drops "Try again". */
export const tapReaderProblemCanRetry = (problem: TapReaderProblem): boolean =>
  problem !== "device_banned" && problem !== "merchant_blocked";

export const tapReaderProblemCopy = (problem: TapReaderProblem, os: string): string => {
  const name = tapToPayName(os);
  switch (problem) {
    case "icloud_required":
      return "Sign in to iCloud on this iPhone, then try again.";
    case "terms_cancelled":
      return `Apple's terms weren't accepted. ${name} stays off until they are.`;
    case "terms_failed":
      return "Apple couldn't save the terms with this Apple ID. Try again.";
    case "prepare_failed":
      return `Couldn't get ${name} ready. Try again.`;
    case "device_banned":
      return `Apple has blocked ${name} on this phone. Use a pay code.`;
    case "merchant_blocked":
      return `${name} is off for this brand. Contact Mingla support. Use a pay code for now.`;
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
};

export const tapReaderProblemTitle = (os: string): string => `${tapToPayName(os)} didn't start`;

export const TAP_ADMIN_ONLY_COPY = {
  title: "Ask an admin to turn this on",
  body: "A brand owner or admin needs to accept Apple's terms for Tap to Pay on iPhone. Ask them to open Account, then Tap to Pay on iPhone, in Mingla Host.",
  usePayCode: "Use a pay code",
} as const;

export const tapToPaySetupButtonLabel = (os: string): string =>
  os === "ios" ? "Accept Apple's terms and set up" : "Set up Tap to Pay";

export const TAP_APPLE_TERMS_ROW = {
  title: "Apple's terms",
  sub: "Apple asks a brand owner or admin to accept its terms once. Apple shows them next.",
} as const;

export const tapConfiguringTitle = (os: string): string => `Getting ${tapToPayName(os)} ready`;
export const TAP_CONFIGURING_BODY =
  "This can take a minute the first time. You can't take a tap until it's finished.";

export interface TapEducationRow {
  title: string;
  sub: string;
}

/**
 * The re-findable guide (Apple 4.3 to 4.8). Text only. The PIN row's accessibility
 * wording still needs checking against Apple's guide.
 */
export const tapEducationRows = (os: string, options: { pinRow: boolean }): TapEducationRow[] => {
  const where = os === "ios" ? "near the top of the iPhone" : "on the back of the phone";
  const rows: TapEducationRow[] = [
    {
      title: "Contactless cards",
      sub:
        os === "ios"
          ? "Hold the card flat near the top of the iPhone until you see the check mark."
          : "Hold the card flat on the back of the phone until it says it's done.",
    },
    {
      title: "Apple Pay and other wallets",
      sub: `Guests hold their phone or watch ${where} the same way.`,
    },
  ];
  if (os === "ios" && options.pinRow) {
    rows.push({
      title: "PIN",
      sub: "Some cards ask for a PIN. Apple shows a PIN screen on the iPhone, and the guest enters it. Accessibility options are on that screen.",
    });
  }
  rows.push({
    title: "If a tap doesn't work",
    sub: "Use a pay code. The guest scans it and pays on their own phone. It's one tap from the tap screen.",
  });
  return rows;
};

export const TAP_HOW_TO_TAP_BUTTON = "Show How to Tap";
export const TAP_HOW_TO_TAP_FAILED = "Couldn't show Apple's How to Tap guide. Try again.";
export const TAP_ON_FOR_BRAND = "On for this brand";

export const TAP_CARD_NEEDS_INSERT_COPY = {
  title: "This card can't be tapped",
  body: "This card needs to be inserted, and a phone can't do that. Try Apple Pay, another card, or a pay code.",
} as const;

export const tapOnboardingCopy = (os: string): { title: string; body: string; button: string } => ({
  title: `Take cards with ${tapToPayName(os)}`,
  body: "No card machine. Guests tap a card or phone on your phone at the door.",
  button: `Set up ${tapToPayName(os)}`,
});

export const TAP_TIMED_OUT_COPY = {
  title: "Payment timed out",
  body: "No card was read. Nothing was charged.",
} as const;

export const TAP_UNKNOWN_RESULT_COPY = {
  title: "Checking the payment",
  body: "We don't know yet if this went through. Don't take another payment until this finishes.",
} as const;

/**
 * #4271 — a tap that went through after the host closed the sale. The host is
 * told so they don't take the money again (cash or another card).
 */
export const tapPaidAfterCloseCopy = (amount: string, saved: boolean): { title: string; body: string } => ({
  title: "A card payment went through",
  body: saved
    ? `${amount} was paid by card after you closed the sale. It's recorded as a sale. Don't take this payment again.`
    : `${amount} was paid by card after you closed the sale. It will be recorded as a sale shortly. Don't take this payment again.`,
});

export const TAP_PROCESSING_TEXT = "Processing payment…";
export const TAP_SEND_RECEIPT = "Send receipt";
