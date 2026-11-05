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
