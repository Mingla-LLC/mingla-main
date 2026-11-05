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
