import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuest";
import { Check, Square } from "lucide-react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useCancelStayReservation,
  usePreviewStayCancellation,
  useRespondToStayRequest,
  useStayStaffReservationGroup,
} from "../../hooks/useStayStaffReservations";
import type {
  StayCancelPreview,
  StayStaffReservationGroup,
} from "../../types/stayReservation";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Sheet } from "../ui/Sheet";

const STATE_LABELS: Record<StayStaffReservationGroup["state"], string> = {
  instant_payment_pending: "Awaiting payment",
  request_pending: "Needs response",
  declined: "Declined",
  request_expired: "Request expired",
  approved_payment_required: "Approved · awaiting payment",
  finalizing: "Confirming payment",
  confirmed: "Confirmed",
  partially_cancelled: "Partially cancelled",
  cancelled: "Cancelled",
  reconciliation_required: "Needs attention",
};

function dateTime(value: string | null): string {
  if (value === null) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function dateOnly(value: string | null): string {
  if (value === null) return "";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    parsed,
  );
}

function errorCopy(error: Error | null): string | null {
  if (error === null) return null;
  if (error.message.includes("stay_version_conflict")) {
    return "This reservation changed elsewhere. Reload it before acting.";
  }
  if (error.message.includes("stay_inventory_changed")) {
    return "The held inventory changed. Reload before responding.";
  }
  if (error.message.includes("stay_dependent_place_requires_room")) {
    return "A Place tied to a Room must be cancelled with that Room.";
  }
  if (error.message.includes("stay_rail_not_enabled")) {
    return "Stay cancellations are not active yet.";
  }
  if (error.message.includes("forbidden")) {
    return "Your Stay permission does not include this action.";
  }
  return "The reservation could not be updated. Reload and try again.";
}

function lineName(line: StayStaffReservationGroup["lines"][number]): string {
  const name = line.offering.name;
  return typeof name === "string" && name.trim().length > 0
    ? name
    : line.kind === "room"
      ? "Room"
      : "Place";
}

function LineCard({
  line,
  currencyCode,
  selectable,
  selected,
  onToggle,
}: {
  line: StayStaffReservationGroup["lines"][number];
  currencyCode: string;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const schedule =
    line.kind === "room"
      ? `${dateOnly(line.roomCheckIn)} → ${dateOnly(line.roomCheckOut)} · ${line.roomQuantity ?? 0} room${line.roomQuantity === 1 ? "" : "s"}`
      : `${line.placeGuests ?? 0} guest${line.placeGuests === 1 ? "" : "s"}${line.placeUnits ? ` · ${line.placeUnits} unit${line.placeUnits === 1 ? "" : "s"}` : ""}`;
  return (
    <Pressable
      accessibilityRole={selectable ? "checkbox" : undefined}
      accessibilityState={selectable ? { checked: selected } : undefined}
      accessibilityLabel={`${selected ? "Selected" : "Select"} ${lineName(line)} for cancellation`}
      disabled={!selectable}
      onPress={onToggle}
      style={[styles.lineCard, selected && styles.lineCardSelected]}
      testID={`stay-staff-line-${line.lineId}`}
    >
      <View style={styles.rowBetween}>
        <View style={styles.flexOne}>
          <Text style={styles.lineTitle}>{lineName(line)}</Text>
          <Text style={styles.helper}>{schedule}</Text>
        </View>
        {selectable ? (
          selected ? (
            <Check size={22} color={accent.warm} />
          ) : (
            <Square size={22} color={textTokens.tertiary} />
          )
        ) : null}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>
          {line.kind === "room" ? "Room" : "Place"}
        </Text>
        <Text style={styles.money}>
          {formatStayMoney(line.totalMinor, currencyCode)}
        </Text>
      </View>
      {line.allocations.map((allocation) => (
        <Text key={allocation.ordinal} style={styles.meta}>
          Room {allocation.ordinal + 1}: {allocation.adults} adult
          {allocation.adults === 1 ? "" : "s"} · {allocation.children} child
          {allocation.children === 1 ? "" : "ren"}
        </Text>
      ))}
      {line.fees.map((fee) => (
        <View key={`${fee.name}-${fee.amountMinor}`} style={styles.rowBetween}>
          <Text style={styles.meta}>{fee.name}</Text>
          <Text style={styles.meta}>
            {formatStayMoney(fee.amountMinor, currencyCode)}
          </Text>
        </View>
      ))}
      <Text style={styles.meta}>
        Line state: {line.state.replaceAll("_", " ")}
      </Text>
    </Pressable>
  );
}

function CancellationReview({
  preview,
  group,
  reason,
  onReasonChange,
  onConfirm,
  onBack,
  pending,
  error,
}: {
  preview: StayCancelPreview;
  group: StayStaffReservationGroup;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  pending: boolean;
  error: Error | null;
}): React.ReactElement {
  return (
    <GlassCard
      variant="elevated"
      style={styles.reviewCardChrome}
      contentStyle={styles.reviewCard}
    >
      <Text style={styles.sectionTitle}>Review cancellation</Text>
      <Text style={styles.helper}>
        Nothing changes until you confirm. This preview expires{" "}
        {dateTime(preview.expiresAt)}.
      </Text>
      <View style={styles.impactGrid}>
        <Impact
          label="Refund to guest"
          value={formatStayMoney(preview.amountMinor, preview.currencyCode)}
        />
        <Impact
          label="Amount retained"
          value={formatStayMoney(
            preview.retainedAmountMinor,
            preview.currencyCode,
          )}
        />
        <Impact
          label="Inventory reopened"
          value={`${preview.inventoryRelease.lineCount} line${preview.inventoryRelease.lineCount === 1 ? "" : "s"}`}
          detail={`${preview.inventoryRelease.roomNightQuantity} room-night units · ${preview.inventoryRelease.placeQuantity} Place units`}
        />
        <Impact
          label="Payout effect"
          value={
            preview.payoutEffect.requiresPayoutReversal
              ? `${formatStayMoney(preview.payoutEffect.payoutReversalMinor, preview.currencyCode)} reversal`
              : `${formatStayMoney(preview.payoutEffect.futureReleaseReductionMinor, preview.currencyCode)} withheld`
          }
          detail={`${formatStayMoney(preview.payoutEffect.organizerLiabilityMinor, preview.currencyCode)} organiser liability`}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Reason shown in the audit trail</Text>
        <TextInput
          value={reason}
          onChangeText={onReasonChange}
          placeholder="Why is this being cancelled?"
          placeholderTextColor={textTokens.tertiary}
          accessibilityLabel="Cancellation reason"
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="stay-cancel-reason"
        />
      </View>
      {error ? <Text style={styles.error}>{errorCopy(error)}</Text> : null}
      <View style={styles.actionRow}>
        <Button
          label="Back"
          onPress={onBack}
          variant="secondary"
          size="md"
          disabled={pending}
        />
        <Button
          label="Confirm cancellation"
          onPress={onConfirm}
          variant="destructive"
          size="md"
          loading={pending}
          disabled={reason.trim().length < 3}
          testID="stay-cancel-confirm"
        />
      </View>
      <Text style={styles.meta}>Group {group.publicReference}</Text>
    </GlassCard>
  );
}

function Impact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): React.ReactElement {
  return (
    <View style={styles.impact}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.impactValue}>{value}</Text>
      {detail ? <Text style={styles.meta}>{detail}</Text> : null}
    </View>
  );
}

export interface StayReservationManagementDetailProps {
  visible: boolean;
  venueId: string;
  groupId: string | null;
  onClose: () => void;
}

export function StayReservationManagementDetail({
  visible,
  venueId,
  groupId,
  onClose,
}: StayReservationManagementDetailProps): React.ReactElement {
  const groupQuery = useStayStaffReservationGroup(visible ? groupId : null);
  const respond = useRespondToStayRequest();
  const previewMutation = usePreviewStayCancellation();
  const cancel = useCancelStayReservation();
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<StayCancelPreview | null>(null);
  const [reason, setReason] = useState("");

  const group = groupQuery.data ?? null;
  const cancellableLines = useMemo(
    () => group?.lines.filter((line) => line.state === "confirmed") ?? [],
    [group?.lines],
  );

  useEffect(() => {
    setSelectedLineIds([]);
    setPreview(null);
    setReason("");
  }, [groupId]);

  const toggleLine = (
    line: StayStaffReservationGroup["lines"][number],
  ): void => {
    setPreview(null);
    setSelectedLineIds((current) => {
      if (current.includes(line.lineId)) {
        return current.filter((id) => id !== line.lineId);
      }
      const dependentIds =
        line.kind === "room"
          ? cancellableLines
              .filter(
                (candidate) => candidate.dependencyRoomLineId === line.lineId,
              )
              .map((candidate) => candidate.lineId)
          : [];
      return [...new Set([...current, line.lineId, ...dependentIds])];
    });
  };

  const handlePreview = (): void => {
    if (group === null || selectedLineIds.length === 0) return;
    previewMutation.mutate(
      {
        groupId: group.groupId,
        selectedLineIds,
        expectedVersion: group.version,
      },
      { onSuccess: setPreview },
    );
  };

  const handleCancel = (): void => {
    if (preview === null) return;
    cancel.mutate(
      { venueId, preview, reason: reason.trim() },
      {
        onSuccess: () => {
          setPreview(null);
          setSelectedLineIds([]);
          setReason("");
        },
      },
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint="full"
      verticalAlign="top"
      testID="stay-staff-reservation-detail"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.title}>Reservation group</Text>
            <Text style={styles.helper}>
              {group?.publicReference ?? "Loading reservation…"}
            </Text>
          </View>
          <Button label="Close" onPress={onClose} variant="ghost" size="sm" />
        </View>

        {groupQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.helper}>Loading the reservation truth…</Text>
          </View>
        ) : groupQuery.isError || group === null ? (
          <View style={styles.centerState}>
            <Text style={styles.sectionTitle}>Reservation could not load</Text>
            <Text style={styles.helper}>
              Check your connection or permission, then retry.
            </Text>
            <Button
              label="Try again"
              onPress={() => void groupQuery.refetch()}
              variant="secondary"
            />
          </View>
        ) : (
          <>
            <View style={styles.statePill}>
              <Text style={styles.statePillText}>
                {STATE_LABELS[group.state]}
              </Text>
            </View>

            {group.state === "reconciliation_required" ? (
              <View style={styles.attention}>
                <Text style={styles.attentionTitle}>
                  Operations review needed
                </Text>
                <Text style={styles.helper}>
                  The provider result is ambiguous. Do not retry payment or mark
                  this paid/refunded manually; Mingla will reconcile the
                  provider event safely.
                </Text>
              </View>
            ) : null}

            <GlassCard variant="elevated" contentStyle={styles.card}>
              <Text style={styles.sectionTitle}>Guest</Text>
              <Text style={styles.value}>{group.guest.name}</Text>
              {group.guest.email ? (
                <Text style={styles.helper}>{group.guest.email}</Text>
              ) : null}
              {group.guest.phone ? (
                <Text style={styles.helper}>{group.guest.phone}</Text>
              ) : null}
              <View style={styles.divider} />
              <View style={styles.rowBetween}>
                <Text style={styles.meta}>Booking mode</Text>
                <Text style={styles.value}>
                  {group.mode === "request" ? "Request" : "Instant"}
                </Text>
              </View>
              {group.requestDeadline ? (
                <View style={styles.rowBetween}>
                  <Text style={styles.meta}>Response deadline</Text>
                  <Text style={styles.value}>
                    {dateTime(group.requestDeadline)}
                  </Text>
                </View>
              ) : null}
              {group.paymentDeadline ? (
                <View style={styles.rowBetween}>
                  <Text style={styles.meta}>Payment deadline</Text>
                  <Text style={styles.value}>
                    {dateTime(group.paymentDeadline)}
                  </Text>
                </View>
              ) : null}
            </GlassCard>

            {group.state === "request_pending" ? (
              <GlassCard variant="elevated" contentStyle={styles.card}>
                <Text style={styles.sectionTitle}>
                  Respond to the whole request
                </Text>
                <Text style={styles.helper}>
                  Approval holds every Room and Place until the payment
                  deadline. The reservation confirms only after payment
                  succeeds.
                </Text>
                {!group.permissions.canRespond ? (
                  <Text style={styles.warning}>
                    Your Stay permissions are view-only for request decisions.
                  </Text>
                ) : null}
                {respond.isError ? (
                  <Text style={styles.error}>{errorCopy(respond.error)}</Text>
                ) : null}
                <View style={styles.actionRow}>
                  <Button
                    label="Decline all"
                    onPress={() =>
                      respond.mutate({
                        venueId,
                        groupId: group.groupId,
                        expectedVersion: group.version,
                        decision: "decline",
                      })
                    }
                    variant="destructive"
                    disabled={!group.permissions.canRespond}
                    loading={respond.isPending}
                    testID="stay-request-decline"
                  />
                  <Button
                    label="Approve all"
                    onPress={() =>
                      respond.mutate({
                        venueId,
                        groupId: group.groupId,
                        expectedVersion: group.version,
                        decision: "approve",
                      })
                    }
                    disabled={!group.permissions.canRespond}
                    loading={respond.isPending}
                    testID="stay-request-approve"
                  />
                </View>
              </GlassCard>
            ) : null}

            <View style={styles.sectionHead}>
              <View style={styles.flexOne}>
                <Text style={styles.sectionTitle}>Rooms & Places</Text>
                <Text style={styles.helper}>
                  {group.lines.length} line{group.lines.length === 1 ? "" : "s"}{" "}
                  in this group
                </Text>
              </View>
              {cancellableLines.length > 0 && group.permissions.canCancel ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select every confirmed line"
                  onPress={() => {
                    setPreview(null);
                    setSelectedLineIds(
                      selectedLineIds.length === cancellableLines.length
                        ? []
                        : cancellableLines.map((line) => line.lineId),
                    );
                  }}
                  style={styles.textAction}
                >
                  <Text style={styles.textActionLabel}>
                    {selectedLineIds.length === cancellableLines.length
                      ? "Clear"
                      : "Select all"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {group.lines.map((line) => (
              <LineCard
                key={line.lineId}
                line={line}
                currencyCode={group.currencyCode}
                selectable={
                  line.state === "confirmed" &&
                  group.permissions.canCancel &&
                  preview === null
                }
                selected={selectedLineIds.includes(line.lineId)}
                onToggle={() => toggleLine(line)}
              />
            ))}

            {selectedLineIds.length > 0 && preview === null ? (
              <GlassCard variant="elevated" contentStyle={styles.card}>
                <Text style={styles.sectionTitle}>Cancel selected lines</Text>
                <Text style={styles.helper}>
                  Review the exact refund, inventory release and payout effect
                  before anything changes.
                </Text>
                {previewMutation.isError ? (
                  <Text style={styles.error}>
                    {errorCopy(previewMutation.error)}
                  </Text>
                ) : null}
                <Button
                  label={`Review ${selectedLineIds.length} cancellation${selectedLineIds.length === 1 ? "" : "s"}`}
                  onPress={handlePreview}
                  variant="destructive"
                  loading={previewMutation.isPending}
                  fullWidth
                  testID="stay-cancel-preview"
                />
              </GlassCard>
            ) : null}

            {preview !== null ? (
              <CancellationReview
                preview={preview}
                group={group}
                reason={reason}
                onReasonChange={setReason}
                onConfirm={handleCancel}
                onBack={() => setPreview(null)}
                pending={cancel.isPending}
                error={cancel.error}
              />
            ) : null}

            <GlassCard variant="elevated" contentStyle={styles.card}>
              <Text style={styles.sectionTitle}>Money</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.meta}>Room & Place subtotal</Text>
                <Text style={styles.value}>
                  {formatStayMoney(
                    group.sourceSubtotalMinor,
                    group.currencyCode,
                  )}
                </Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.meta}>Named fees</Text>
                <Text style={styles.value}>
                  {formatStayMoney(group.feeTotalMinor, group.currencyCode)}
                </Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.meta}>Taxes</Text>
                <Text style={styles.value}>
                  {formatStayMoney(group.taxTotalMinor, group.currencyCode)}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.rowBetween}>
                <Text style={styles.lineTitle}>Total</Text>
                <Text style={styles.total}>
                  {formatStayMoney(group.totalMinor, group.currencyCode)}
                </Text>
              </View>
              <Text style={styles.helper}>
                Payment:{" "}
                {group.payment?.state.replaceAll("_", " ") ?? "not started"}
                {group.payment ? ` · ${group.payment.provider}` : ""}
              </Text>
              {group.refunds.map((refund) => (
                <View key={refund.refundId} style={styles.refundRow}>
                  <Text style={styles.value}>
                    {formatStayMoney(refund.amountMinor, group.currencyCode)}{" "}
                    refund
                  </Text>
                  <Text style={styles.meta}>
                    {refund.state.replaceAll("_", " ")} · {refund.reason}
                  </Text>
                </View>
              ))}
            </GlassCard>

            <GlassCard variant="elevated" contentStyle={styles.card}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              {group.events.map((event, index) => (
                <View
                  key={`${event.createdAt}-${event.eventType}-${index}`}
                  style={styles.timelineRow}
                >
                  <View style={styles.timelineDot} />
                  <View style={styles.flexOne}>
                    <Text style={styles.value}>
                      {event.eventType
                        .replace(/^stay_/, "")
                        .replaceAll("_", " ")}
                    </Text>
                    <Text style={styles.meta}>
                      {dateTime(event.createdAt)} · {event.actorType}
                    </Text>
                  </View>
                </View>
              ))}
            </GlassCard>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.md,
  },
  title: { ...typography.h2, color: textTokens.primary },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  meta: { ...typography.caption, color: textTokens.tertiary },
  value: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" },
  money: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  total: { ...typography.h3, color: accent.warm },
  flexOne: { flex: 1, minWidth: 0 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  centerState: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  statePill: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: semantic.warningTint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statePillText: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  attention: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
    padding: spacing.md,
    gap: spacing.xs,
  },
  attentionTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  // CONTENT-node measures (#1532 §4): passed as `contentStyle` so the gap
  // reaches the children. On `style` it landed on the chrome node, whose only
  // in-flow child is the clip view, and spaced nothing.
  card: { gap: spacing.sm },
  lineCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 96,
  },
  lineCardSelected: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235,120,37,0.08)",
  },
  lineTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
    marginVertical: spacing.xs,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  textActionLabel: {
    ...typography.bodySm,
    color: accent.warm,
    fontWeight: "700",
  },
  warning: { ...typography.bodySm, color: semantic.warning },
  error: { ...typography.bodySm, color: semantic.error },
  reviewCard: { gap: spacing.md },
  // CHROME-node half of the same card: a border belongs on the chrome node.
  reviewCardChrome: { borderColor: semantic.warning },
  impactGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  impact: {
    minWidth: 210,
    flexGrow: 1,
    flexBasis: "45%",
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  impactValue: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  field: { gap: spacing.xs },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
  },
  inputMultiline: { minHeight: 84, textAlignVertical: "top" },
  refundRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    paddingTop: spacing.sm,
    gap: spacing.xxs,
  },
  timelineRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
    marginTop: 6,
  },
});

export default StayReservationManagementDetail;
