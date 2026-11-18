/**
 * #4271 door polish — what colour an end state is, as data.
 *
 * The colour answers "did money move?" before anyone reads a word:
 *   ok       money taken and recorded (green)
 *   neutral  nothing was charged, or a setup limit with a fallback (grey)
 *   caution  money may exist or exists, the record is not settled (amber)
 *   bad      declined by the bank, or blocked by Apple or Mingla (red)
 *
 * Colour is never the only signal: each tone has its own icon. Kept free of
 * React Native imports so the map is unit-testable; shared by TapStatusView
 * and the host's pay code end states. The guest pay page keeps its own copy of
 * the three tones it shows (doorPayGuestTone.ts), pinned to this map by test.
 */
import {
  color,
} from "../../constants/designSystem";
import type { IconName } from "../ui/Icon";

export type DoorTone = "ok" | "neutral" | "caution" | "bad";

export interface DoorToneStyle {
  ringFill: string;
  /** Neutral is drawn with a hairline; the coloured rings have none. */
  ringBorder: string | null;
  iconColor: string;
  iconSize: number;
  /** The icon when the screen names none. One per tone, never shared. */
  defaultIcon: IconName;
  /** Caution and bad interrupt a screen reader; the others wait their turn. */
  liveRegion: "polite" | "assertive";
}

export const DOOR_TONE_STYLES: Readonly<Record<DoorTone, DoorToneStyle>> = {
  ok: {
    ringFill: color.successTint,
    ringBorder: null,
    iconColor: color.success,
    iconSize: 30,
    defaultIcon: "check",
    liveRegion: "polite",
  },
  neutral: {
    ringFill: color.fill.tile,
    ringBorder: color.lineStrong,
    iconColor: color.text2,
    iconSize: 28,
    defaultIcon: "clock",
    liveRegion: "polite",
  },
  caution: {
    ringFill: color.warningTint,
    ringBorder: null,
    iconColor: color.warning,
    iconSize: 28,
    defaultIcon: "flag",
    liveRegion: "assertive",
  },
  bad: {
    ringFill: color.errorTint,
    ringBorder: null,
    iconColor: color.errorText,
    iconSize: 28,
    defaultIcon: "close",
    liveRegion: "assertive",
  },
};

export const doorToneStyle = (tone: DoorTone): DoorToneStyle => DOOR_TONE_STYLES[tone];

/**
 * The host's pay code end states. Expired and cancelled charged nothing (grey),
 * a failed payment is red, and "checking" or "payment landing" is money that
 * isn't settled yet (amber).
 */
export const doorPayHostTone = (
  status: "paid" | "expired" | "cancelled" | "failed" | "checking" | "payment_landing",
): DoorTone => {
  switch (status) {
    case "paid":
      return "ok";
    case "expired":
    case "cancelled":
      return "neutral";
    case "failed":
      return "bad";
    case "checking":
    case "payment_landing":
      return "caution";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};
