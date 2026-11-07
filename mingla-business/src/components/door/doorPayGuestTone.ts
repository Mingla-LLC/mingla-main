/**
 * #4271 door polish — the guest pay page's end-state rings (paid green, expired
 * and cancelled grey, failed red), the same rule and colours as the host's
 * screen (doorTone.ts).
 *
 * Kept separate from doorTone.ts on purpose: the host's tones ship in the
 * on-intent door chunk, and a module both the guest page and that chunk import
 * would be hoisted into the eager web __common chunk. The #4271 polish test
 * pins these values to DOOR_TONE_STYLES so the two cannot drift.
 */
import { glass, semantic, text as textTokens } from "../../constants/designSystem";
import type { IconName } from "../ui/Icon";

export type DoorPayGuestTone = "ok" | "neutral" | "bad";

export interface DoorPayGuestToneStyle {
  ringFill: string;
  ringBorder: string | null;
  iconColor: string;
  iconSize: number;
  defaultIcon: IconName;
}

export const DOOR_PAY_GUEST_TONE_STYLES: Readonly<Record<DoorPayGuestTone, DoorPayGuestToneStyle>> = {
  ok: { ringFill: semantic.successTint, ringBorder: null, iconColor: semantic.success, iconSize: 30, defaultIcon: "check" },
  neutral: {
    ringFill: glass.tint.profileElevated,
    ringBorder: glass.border.profileElevated,
    iconColor: textTokens.secondary,
    iconSize: 28,
    defaultIcon: "clock",
  },
  bad: { ringFill: semantic.errorRing, ringBorder: null, iconColor: semantic.errorText, iconSize: 28, defaultIcon: "close" },
};

/** Paid is green, expired and cancelled charged nothing (grey), failed is red. */
export const doorPayGuestTone = (status: "paid" | "expired" | "cancelled" | "failed"): DoorPayGuestTone => {
  switch (status) {
    case "paid":
      return "ok";
    case "expired":
    case "cancelled":
      return "neutral";
    case "failed":
      return "bad";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};
