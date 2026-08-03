import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import {
  type StayCancelPreview,
  type StayReservationGroup,
} from "./stayGuest";
import { formatStayMoney } from "./stayGuestMoney";
import {
  BrandRenderingReact as React,
  useBrandRenderingState as useState,
  type BrandRenderingReactElement,
  type BrandRenderingReactNode,
} from "./PublicVenueTabs";

export function StayReservationDetail({
  group,
  loading,
  error,
  palette,
  busy = false,
  onRetry,
  onPay,
  onCancelPreview,
  onCancel,
}: {
  group: StayReservationGroup | null;
  loading: boolean;
  error: string | null;
  palette: ThemePalette;
  busy?: boolean;
  onRetry: () => void;
  onPay: (group: StayReservationGroup) => void | Promise<void>;
  onCancelPreview: (
    group: StayReservationGroup,
    selectedLineIds: string[],
  ) => Promise<StayCancelPreview>;
  onCancel: (
    preview: StayCancelPreview,
    reason: string,
  ) => void | Promise<void>;
}): BrandRenderingReactElement {
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<StayCancelPreview | null>(null);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (loading) {
    return (
      <StateCard palette={palette}>
        <ActivityIndicator color={palette.accent} />
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Loading your Stay…
        </Text>
      </StateCard>
    );
  }
  if (group === null) {
    return (
      <StateCard palette={palette}>
        <Text style={[styles.heading, { color: palette.primaryText }]}>
          This Stay reservation could not load
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {error ?? "Try again in a moment."}
        </Text>
        <Action label="Try again" palette={palette} onPress={onRetry} />
      </StateCard>
    );
  }

  const state = stateContent(group);
  const canCancel =
    group.state === "confirmed" || group.state === "partially_cancelled";
  const canPay =
    group.state === "instant_payment_pending" ||
    group.state === "approved_payment_required";
  const refund = refundContent(group);

  const loadPreview = async (): Promise<void> => {
    if (selected.length === 0) {
      setLocalError("Choose at least one Room or Place to cancel.");
      return;
    }
    setLocalError(null);
    try {
      setPreview(await onCancelPreview(group, selected));
    } catch (caught) {
      setLocalError(
        caught instanceof Error
          ? caught.message
          : "Cancellation could not be previewed.",
      );
    }
  };

  return (
    <View style={styles.host}>
      <View style={[styles.hero, { backgroundColor: palette.card }]}>
        <Text style={[styles.eyebrow, { color: palette.accent }]}>
          {group.publicReference}
        </Text>
        <Text style={[styles.title, { color: palette.primaryText }]}>
          {state.title}
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {state.body}
        </Text>
        <Text style={[styles.total, { color: palette.primaryText }]}>
          {formatStayMoney(group.totalMinor, group.currencyCode)}
        </Text>
        <Text style={[styles.meta, { color: palette.tertiaryText }]}>
          Exact total in {group.currencyCode}
        </Text>
        {state.deadline ? (
          <Text style={[styles.deadline, { color: palette.accent }]}>
            {state.deadline}
          </Text>
        ) : null}
        {canPay ? (
          <Action
            label={busy ? "Opening payment…" : "Complete payment"}
            palette={palette}
            disabled={busy}
            onPress={() => {
              void onPay(group);
            }}
          />
        ) : null}
      </View>

      <View style={[styles.receipt, { backgroundColor: palette.card }]}>
        <Text style={[styles.sectionTitle, { color: palette.primaryText }]}>
          Reservation receipt
        </Text>
        <ReceiptRow
          label="Rooms and Places"
          amount={group.sourceSubtotalMinor}
          currency={group.currencyCode}
          palette={palette}
        />
        <ReceiptRow
          label="Fees"
          amount={group.feeTotalMinor}
          currency={group.currencyCode}
          palette={palette}
        />
        <ReceiptRow
          label="Taxes"
          amount={group.taxTotalMinor}
          currency={group.currencyCode}
          palette={palette}
        />
        <ReceiptRow
          label="Exact total"
          amount={group.totalMinor}
          currency={group.currencyCode}
          palette={palette}
          strong
        />
        <Text style={[styles.meta, { color: palette.tertiaryText }]}>
          Created {new Date(group.createdAt).toLocaleString()}
        </Text>
      </View>

      {refund ? (
        <View style={[styles.refundCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.heading, { color: palette.primaryText }]}>
            {refund.title}
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            {refund.body}
          </Text>
          {refund.amountMinor ? (
            <Text style={[styles.total, { color: palette.primaryText }]}>
              {formatStayMoney(refund.amountMinor, group.currencyCode)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, { color: palette.primaryText }]}>
        Rooms and Places
      </Text>
      {group.lines.map((line) => {
        const name =
          typeof line.offering.name === "string"
            ? line.offering.name
            : line.kind === "room"
              ? "Room"
              : "Place";
        const checked = selected.includes(line.lineId);
        const lineCanCancel =
          canCancel && !["cancelled", "declined", "expired"].includes(line.state);
        return (
          <Pressable
            key={line.lineId}
            accessibilityRole={lineCanCancel ? "checkbox" : undefined}
            accessibilityLabel={`${name}, ${line.state.replaceAll("_", " ")}`}
            accessibilityState={lineCanCancel ? { checked } : undefined}
            disabled={!lineCanCancel || preview !== null}
            onPress={() =>
              setSelected((current: string[]) =>
                checked
                  ? current.filter((id: string) => id !== line.lineId)
                  : [...current, line.lineId]
              )}
            style={[
              styles.line,
              {
                backgroundColor: palette.card,
                borderColor: checked ? palette.accent : palette.panelBorder,
              },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.lineName, { color: palette.primaryText }]}>
                {name}
              </Text>
              <Text style={[styles.meta, { color: palette.secondaryText }]}>
                {line.kind === "room"
                  ? `${line.roomQuantity ?? 1} room${line.roomQuantity === 1 ? "" : "s"} · ${line.roomCheckIn ?? ""} to ${line.roomCheckOut ?? ""}`
                  : `${line.placeGuests ?? line.adults + line.children} guests`}
              </Text>
              <Text style={[styles.meta, { color: palette.tertiaryText }]}>
                {line.state.replaceAll("_", " ")}
              </Text>
            </View>
            <Text style={[styles.lineAmount, { color: palette.primaryText }]}>
              {formatStayMoney(line.totalMinor, group.currencyCode)}
            </Text>
          </Pressable>
        );
      })}

      {canCancel && preview === null ? (
        <Action
          label={busy ? "Checking policy…" : "Preview cancellation"}
          palette={palette}
          disabled={busy || selected.length === 0}
          onPress={() => {
            void loadPreview();
          }}
        />
      ) : null}

      {preview !== null ? (
        <View style={[styles.cancelCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.heading, { color: palette.primaryText }]}>
            Review cancellation
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Refund due under the snapshotted policy:
          </Text>
          <Text style={[styles.total, { color: palette.primaryText }]}>
            {formatStayMoney(preview.amountMinor, preview.currencyCode)}
          </Text>
          <Text style={[styles.meta, { color: palette.tertiaryText }]}>
            This preview expires at{" "}
            {new Date(preview.expiresAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            .
          </Text>
          <TextInput
            accessibilityLabel="Cancellation reason"
            placeholder="Why are you cancelling?"
            placeholderTextColor={palette.tertiaryText}
            value={reason}
            onChangeText={setReason}
            style={[
              styles.input,
              {
                color: palette.primaryText,
                borderColor: palette.panelBorder,
              },
            ]}
          />
          <Action
            label={busy ? "Cancelling…" : "Confirm cancellation"}
            palette={palette}
            disabled={busy || reason.trim().length < 3}
            onPress={() => {
              void onCancel(preview, reason.trim());
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keep Stay reservation"
            disabled={busy}
            onPress={() => {
              setPreview(null);
              setReason("");
            }}
            style={styles.keep}
          >
            <Text style={[styles.keepText, { color: palette.accent }]}>
              Keep reservation
            </Text>
          </Pressable>
        </View>
      ) : null}
      {localError ?? error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {localError ?? error}
        </Text>
      ) : null}
    </View>
  );
}

function refundContent(group: StayReservationGroup): {
  title: string;
  body: string;
  amountMinor: string | null;
} | null {
  const relevant = [...group.events].reverse().find((event) =>
    [
      "stay_refund_attention_required",
      "stay_refund_succeeded",
      "stay_refund_queued",
      "stay_reservation_cancelled",
    ].includes(event.eventType)
  );
  if (!relevant) return null;
  const amountMinor =
    typeof relevant.metadata.amountMinor === "string"
      ? relevant.metadata.amountMinor
      : null;
  if (relevant.eventType === "stay_refund_attention_required") {
    return {
      title: "Refund needs attention",
      body: "Mingla is reviewing the refund. You do not need to submit it again.",
      amountMinor,
    };
  }
  if (relevant.eventType === "stay_refund_succeeded") {
    return {
      title: "Refund sent",
      body: "The refund was sent to the original payment source.",
      amountMinor,
    };
  }
  if (relevant.eventType === "stay_refund_queued") {
    return {
      title: "Refund in progress",
      body: "The refund is queued for the original payment source.",
      amountMinor,
    };
  }
  return {
    title: "Cancellation recorded",
    body:
      "Any refund due under the reviewed policy is being tracked against the original payment.",
    amountMinor,
  };
}

function ReceiptRow({
  label,
  amount,
  currency,
  palette,
  strong = false,
}: {
  label: string;
  amount: string;
  currency: string;
  palette: ThemePalette;
  strong?: boolean;
}): BrandRenderingReactElement {
  return (
    <View style={styles.receiptRow}>
      <Text
        style={[
          styles.body,
          { color: strong ? palette.primaryText : palette.secondaryText },
          strong && styles.strong,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.body,
          { color: palette.primaryText },
          strong && styles.strong,
        ]}
      >
        {formatStayMoney(amount, currency)}
      </Text>
    </View>
  );
}

function stateContent(group: StayReservationGroup): {
  title: string;
  body: string;
  deadline: string | null;
} {
  const requestDeadline = group.requestDeadline
    ? new Date(group.requestDeadline).toLocaleString()
    : null;
  const paymentDeadline = group.paymentDeadline
    ? new Date(group.paymentDeadline).toLocaleString()
    : null;
  switch (group.state) {
    case "request_pending":
      return {
        title: "Request sent",
        body: "The Stay is reviewing your Rooms and Places. You have not been charged.",
        deadline: requestDeadline ? `Response due by ${requestDeadline}` : null,
      };
    case "approved_payment_required":
      return {
        title: "Your Stay approved the request",
        body: "Complete payment before the reservation hold expires.",
        deadline: paymentDeadline ? `Pay by ${paymentDeadline}` : null,
      };
    case "instant_payment_pending":
      return {
        title: "Payment required",
        body: "Your selections are temporarily held. Complete payment to confirm.",
        deadline: group.hold?.expiresAt
          ? `Hold expires ${new Date(group.hold.expiresAt).toLocaleString()}`
          : null,
      };
    case "finalizing":
      return {
        title: "Confirming your Stay",
        body: "Payment was received. We are finalizing the inventory now.",
        deadline: null,
      };
    case "confirmed":
      return {
        title: "Your Stay is confirmed",
        body: "Your Rooms and Places are reserved.",
        deadline: null,
      };
    case "partially_cancelled":
      return {
        title: "Part of this Stay was cancelled",
        body: "The remaining Rooms and Places are still confirmed.",
        deadline: null,
      };
    case "cancelled":
      return {
        title: "Stay cancelled",
        body: "Refund progress appears in your notifications and payment source.",
        deadline: null,
      };
    case "declined":
      return {
        title: "Request declined",
        body: "The Stay could not accept this request. You were not charged.",
        deadline: null,
      };
    case "request_expired":
      return {
        title: "Request expired",
        body: "The Stay did not approve this request in time. You were not charged.",
        deadline: null,
      };
    default:
      return {
        title: "Needs attention",
        body: "Mingla is reconciling this reservation. Do not retry payment.",
        deadline: null,
      };
  }
}

function StateCard({
  children,
  palette,
}: {
  children: BrandRenderingReactNode;
  palette: ThemePalette;
}): BrandRenderingReactElement {
  return (
    <View style={[styles.hero, { backgroundColor: palette.card }]}>
      {children}
    </View>
  );
}

function Action({
  label,
  palette,
  onPress,
  disabled = false,
}: {
  label: string;
  palette: ThemePalette;
  onPress: () => void;
  disabled?: boolean;
}): BrandRenderingReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: palette.accent },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, { color: palette.accentText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { gap: 16 },
  hero: { padding: 20, borderRadius: 18, gap: 10 },
  receipt: { padding: 18, borderRadius: 18, gap: 9 },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  refundCard: { padding: 18, borderRadius: 18, gap: 8 },
  strong: { fontWeight: "900" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 17 },
  total: { fontSize: 26, lineHeight: 32, fontWeight: "900" },
  deadline: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "900" },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  flex: { flex: 1, gap: 4 },
  lineName: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  lineAmount: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  cancelCard: { borderRadius: 18, padding: 18, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  action: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  actionText: { fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  keep: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  keepText: { fontSize: 14, fontWeight: "800" },
  error: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
});
