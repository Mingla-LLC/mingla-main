/**
 * Event-detail recent-activity feed row — extracted from app/event/[id]/index.tsx
 * (Cycle 17d Stage 2 §F.4).
 *
 * Owns:
 *   - `ActivityEvent` discriminated-union type
 *   - `activityRowKey()` React key derivation
 *   - `formatActivityRelativeTime()` relative-time formatter
 *   - `activityKindSpec()` kind→visual-spec mapper
 *   - `EventDetailActivityRow` memoized row component
 *
 * Memoized — mapped over the recent-activity array; row props (event-by-id +
 * stable handlers) are reference-equal across re-renders unless the row's
 * own data changed.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { EditSeverity } from "../../store/eventEditLogStore";
import { formatGbp } from "../../utils/currency";
import { Icon, type IconName } from "../ui/Icon";

// ----- Activity feed types (Cycle 9c rework v3 + Cycle 9c-2 ext) ---

export type ActivityEvent =
  | {
      kind: "purchase";
      orderId: string;
      buyerName: string;
      summary: string;
      amountGbp: number;
      at: string;
    }
  | {
      kind: "refund";
      orderId: string;
      buyerName: string;
      summary: string;
      amountGbp: number;
      at: string;
    }
  | {
      kind: "cancel";
      orderId: string;
      buyerName: string;
      summary: string;
      at: string;
    }
  | {
      kind: "event_edit";
      editId: string;
      severity: EditSeverity;
      summary: string;
      reason: string;
      at: string;
    }
  | {
      kind: "event_sales_ended";
      eventId: string;
      summary: string;
      at: string;
    }
  | {
      kind: "event_cancelled";
      eventId: string;
      summary: string;
      at: string;
    }
  // Cycle 11 — event_scan kind. Buyer is the SUBJECT (not actor), so
  // ActivityRow renders summary as primary line per §4.8.
  | {
      kind: "event_scan";
      scanId: string;
      ticketId: string;
      orderId: string;
      buyerName: string;
      ticketName: string;
      summary: string; // e.g., "Tunde checked in"
      at: string;
    }
  // Cycle 12 — door refund stream. Mirrors order `refund` shape but keyed
  // differently so the feed can distinguish door (cash/manual money returned
  // at the door) from online (Stripe-mediated). Door refunds never touch
  // useScanStore (OBS-1 lock — refund is money-only, not attendance) so they
  // need their own stream sourced directly from useDoorSalesStore.
  | {
      kind: "event_door_refund";
      saleId: string; // ds_xxx parent door sale
      refundId: string; // dr_xxx refund record
      buyerName: string; // sale.buyerName or "Walk-up"
      summary: string; // "{buyer} — refunded £X (door)"
      amountGbp: number;
      at: string; // refund.refundedAt ISO
    };

const ACTIVITY_RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export const formatActivityRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < ACTIVITY_RELATIVE_TIME_MS.minute) return "just now";
  if (delta < ACTIVITY_RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < ACTIVITY_RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.day)}d ago`;
};

// React keys differ per kind: order-level uses orderId, event-level uses
// editId or eventId (no orderId field on the new kinds).
export const activityRowKey = (a: ActivityEvent): string => {
  if (a.kind === "purchase" || a.kind === "refund" || a.kind === "cancel") {
    return `${a.kind}-${a.orderId}-${a.at}`;
  }
  if (a.kind === "event_edit") {
    return `${a.kind}-${a.editId}`;
  }
  if (a.kind === "event_scan") {
    return `${a.kind}-${a.scanId}`;
  }
  if (a.kind === "event_door_refund") {
    return `${a.kind}-${a.refundId}`;
  }
  return `${a.kind}-${a.eventId}-${a.at}`;
};

// ----- Kind → visual spec ------------------------------------------

interface ActivityKindSpec {
  iconName: IconName;
  iconColor: string;
  badgeBg: string;
  amountColor: string | null;
  amountSign: "+" | "-" | null;
}

const activityKindSpec = (event: ActivityEvent): ActivityKindSpec => {
  if (event.kind === "purchase") {
    return {
      iconName: "ticket",
      iconColor: "#34c759",
      badgeBg: "rgba(34, 197, 94, 0.18)",
      amountColor: "#34c759",
      amountSign: "+",
    };
  }
  if (event.kind === "refund") {
    return {
      iconName: "refund",
      iconColor: accent.warm,
      badgeBg: "rgba(235, 120, 37, 0.18)",
      amountColor: accent.warm,
      amountSign: "-",
    };
  }
  if (event.kind === "cancel") {
    return {
      iconName: "close",
      iconColor: textTokens.tertiary,
      badgeBg: "rgba(120, 120, 120, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_edit") {
    // Severity drives color: additive = info-blue (quiet), material = accent.warm (louder).
    // "destructive" not reachable here — those are order-level (refund/cancel) and
    // already rendered via the order streams + filtered out at recentActivity build.
    if (event.severity === "material") {
      return {
        iconName: "edit",
        iconColor: accent.warm,
        badgeBg: "rgba(235, 120, 37, 0.18)",
        amountColor: null,
        amountSign: null,
      };
    }
    return {
      iconName: "edit",
      iconColor: "#3b82f6",
      badgeBg: "rgba(59, 130, 246, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_sales_ended") {
    return {
      iconName: "clock",
      iconColor: "#3b82f6",
      badgeBg: "rgba(59, 130, 246, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_scan") {
    // Cycle 11 — same success-green as purchase but with check icon to
    // emphasise check-in vs new sale.
    return {
      iconName: "check",
      iconColor: "#34c759",
      badgeBg: "rgba(52, 199, 89, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_door_refund") {
    // Cycle 12 — same warm-orange treatment as order `refund` so refunds
    // feel consistent across online + door streams. summary already carries
    // "(door)" suffix for the buyer to disambiguate.
    return {
      iconName: "refund",
      iconColor: accent.warm,
      badgeBg: "rgba(235, 120, 37, 0.18)",
      amountColor: accent.warm,
      amountSign: "-",
    };
  }
  // event_cancelled — same close icon as order-cancel but red severity to
  // signal "everyone affected" vs grey "one buyer affected".
  return {
    iconName: "close",
    iconColor: semantic.error,
    badgeBg: "rgba(239, 68, 68, 0.18)",
    amountColor: null,
    amountSign: null,
  };
};

// ----- Row component -----------------------------------------------

interface EventDetailActivityRowProps {
  event: ActivityEvent;
}

const EventDetailActivityRowInner: React.FC<EventDetailActivityRowProps> = ({
  event: a,
}) => {
  const spec = activityKindSpec(a);
  const relTime = formatActivityRelativeTime(a.at);

  // Amount label only applies to order-level kinds with money flow.
  // Purchase with totalGbpAtPurchase === 0 renders "Free" instead of "+£0.00".
  let amountLabel: string | null = null;
  if (a.kind === "purchase") {
    amountLabel =
      a.amountGbp === 0
        ? "Free"
        : `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  } else if (a.kind === "refund") {
    amountLabel = `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  } else if (a.kind === "event_door_refund") {
    // Cycle 12 — door refund renders amount the same as online refund
    // (warm color + minus sign) so the operator's eye sweep across the
    // feed sees "money out" consistently regardless of channel.
    amountLabel = `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  }

  // Row shape branches by stream:
  //  - order-level (purchase / refund / cancel / event_door_refund):
  //    {buyerName} \\ {summary} \\ relTime
  //  - event_edit: {summary} \\ {reason} \\ relTime  (no buyer)
  //  - event_sales_ended / event_cancelled: {summary} \\ relTime  (no buyer, no reason)
  //  - event_scan: same shape as event-level (no separate buyer line);
  //    summary already carries the buyer name ("Tunde checked in").
  const isOrderLevel =
    a.kind === "purchase" ||
    a.kind === "refund" ||
    a.kind === "cancel" ||
    a.kind === "event_door_refund";

  return (
    <View style={styles.host}>
      <View style={[styles.iconBadge, { backgroundColor: spec.badgeBg }]}>
        <Icon name={spec.iconName} size={16} color={spec.iconColor} />
      </View>
      <View style={styles.col}>
        {isOrderLevel ? (
          <>
            <Text style={styles.name} numberOfLines={1}>
              {a.buyerName}
            </Text>
            <Text style={styles.summary} numberOfLines={1}>
              {a.summary}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.name} numberOfLines={1}>
              {a.summary}
            </Text>
            {a.kind === "event_edit" && a.reason.trim().length > 0 ? (
              <Text style={styles.summary} numberOfLines={1}>
                {a.reason}
              </Text>
            ) : null}
          </>
        )}
        <Text style={styles.time} numberOfLines={1}>
          {relTime}
        </Text>
      </View>
      {amountLabel !== null && spec.amountColor !== null ? (
        <Text
          style={[styles.amount, { color: spec.amountColor }]}
          numberOfLines={1}
        >
          {amountLabel}
        </Text>
      ) : null}
    </View>
  );
};

export const EventDetailActivityRow = React.memo(EventDetailActivityRowInner);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  summary: {
    fontSize: 12,
    color: textTokens.secondary,
    marginTop: 1,
  },
  time: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  amount: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
    marginLeft: spacing.sm,
  },
});
