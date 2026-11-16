/**
 * StatusPill — opinionated wrapper around `Pill` with a fixed dictionary
 * mapping the 7 event-organiser status states to variant + label.
 *
 * Mingla domain rule (I-5): copy is event/experience-language only.
 */

import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Pill } from "./Pill";
import type { PillVariant } from "./Pill";

export type StatusPillStatus =
  | "LIVE"
  | "DRAFT"
  | "UPCOMING"
  | "ENDED"
  | "PENDING"
  | "PREVIEW"
  | "SOLD_OUT"
  // #4420 Graphite Glass kit states (additive).
  | "NOW"
  | "PAID"
  | "REFUNDED"
  | "PARTIAL"
  | "ATTENTION"
  | "CANCELLED"
  | "PAUSED";

export interface StatusPillProps {
  status: StatusPillStatus;
  /**
   * Internal escape hatch — chrome compositions sometimes want a different
   * label (e.g. "STARTING SOON" with the UPCOMING variant). Avoid in
   * application code; document any future use here.
   */
  overrideLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface StatusEntry {
  variant: PillVariant;
  label: string;
  livePulse?: boolean;
}

const STATUS_DICT: Record<StatusPillStatus, StatusEntry> = {
  LIVE: { variant: "live", label: "LIVE", livePulse: true },
  DRAFT: { variant: "draft", label: "DRAFT" },
  // #4420: upcoming = the orange dot (one of the places orange is allowed).
  UPCOMING: { variant: "accent", label: "UPCOMING" },
  ENDED: { variant: "draft", label: "ENDED" },
  PENDING: { variant: "warn", label: "PENDING" },
  PREVIEW: { variant: "info", label: "PREVIEW" },
  SOLD_OUT: { variant: "error", label: "SOLD OUT" },
  NOW: { variant: "live", label: "NOW", livePulse: true },
  PAID: { variant: "ok", label: "PAID" },
  REFUNDED: { variant: "draft", label: "REFUNDED" },
  PARTIAL: { variant: "muted", label: "PARTIAL" },
  ATTENTION: { variant: "warn", label: "NEEDS ATTENTION" },
  CANCELLED: { variant: "muted", label: "CANCELLED" },
  PAUSED: { variant: "muted", label: "PAUSED" },
};

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  overrideLabel,
  testID,
  style,
}) => {
  const entry = STATUS_DICT[status];

  return (
    <Pill
      variant={entry.variant}
      livePulse={entry.livePulse}
      testID={testID}
      style={style}
    >
      {overrideLabel ?? entry.label}
    </Pill>
  );
};

export default StatusPill;
