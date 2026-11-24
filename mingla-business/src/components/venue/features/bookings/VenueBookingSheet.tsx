/**
 * #4490 P3-2 — one booking (`bk`, `bk-overdue`, `bk-guests`, `bk-date`,
 * `bk-cancel`): who, when, what's included, the money (total, paid online,
 * paid at the venue, still to pay and when) and the history. People with
 * money rights mark money taken at the venue and send a reminder; people who
 * run bookings change the guests, move the day, add extras or cancel with the
 * refund shown first.
 *
 * A side panel on wide web, a sheet on phones. Each action replaces the body
 * with its own form (no dialog stacked on the sheet), with Back and one
 * primary button. Changes are previewed by the server before they apply.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import {
  useBookingChange,
  useBookingMoneyAction,
  useStaffCancel,
  useVenueBooking,
} from "../../../../hooks/useVenueBooking";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useDamageDeposit } from "../../../../hooks/useVenueHire";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
// #4490 — moving a booking reads the same day times the guest sees, so it
// loads them from the Guest venue owner on use (never a static import: that
// would put the guest offer models in both owners, i.e. in __common).
import { loadVenueGuestScreens } from "../../guest/venueGuestOwner";
import { venueLayoutSummary } from "@mingla/brand-rendering/venueOffers/layoutModel";
import type {
  BookingChangeAction,
  BookingChangeSummary,
  OfflineMethod,
  StaffCancelPreview,
  VenueBookingDetail,
  VenueOffer,
} from "../../../../types/venueOffers";
import { randomId } from "../../../../utils/randomId";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { DayDateField } from "../../../ui/DayDateField";
import { Icon } from "../../../ui/Icon";
import { Input } from "../../../ui/Input";
import { KeyValue } from "../../../ui/KeyValue";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper } from "../../../ui/NumberStepper";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Pill, Segmented } from "../../../ui/Pill";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { Timeline } from "../../../ui/Timeline";
import { money, offerErrorCopy } from "../offers/offersModel";
import {
  OFFLINE_METHODS,
  balanceDueLine,
  bookingStateWords,
  changePreviewWords,
  changeWords,
  clockIn,
  dateIn,
  historyTitle,
  damageDepositWords,
  hireGuestRangeFor,
  isOverdue,
  methodLabel,
  shortDay,
  moneyRows,
  staffCancelWords,
  whenLine,
} from "./bookingModel";

import { shortBookingReference } from "../../../../utils/venueBookingReference";

/** A time the booking can move to (the guest's own day times). */
type MoveDayRow = { windowId: string; startsAt: string; status: string; remaining: number; label: string | null };

const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

type Mode = "view" | "pay" | "guests" | "date" | "extras" | "cancel" | "deposit_release" | "deposit_hold";

function todayIso(timezone: string): string {
  return dateIn(new Date().toISOString(), timezone) ?? new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface VenueBookingSheetProps {
  brandId: string | null;
  venueId: string | null;
  /** The booking to show; null = closed. */
  groupId: string | null;
  onClose: () => void;
}

export function VenueBookingSheet({ brandId, venueId, groupId, onClose }: VenueBookingSheetProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const [mode, setMode] = useState<Mode>("view");
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    setMode("view");
  }, [groupId]);
  const busyClose = (): void => {
    setMode("view");
    onClose();
  };
  return (
    <>
      <Sheet
        visible={groupId !== null}
        onClose={busyClose}
        snapPoint={0.9}
        presentation={isWideDesktop ? "panel" : undefined}
        testID="venue-booking-sheet"
      >
        {groupId !== null ? (
          <BookingBody
            brandId={brandId}
            venueId={venueId}
            groupId={groupId}
            mode={mode}
            setMode={setMode}
            onClose={busyClose}
            onDone={(text) => {
              setMode("view");
              setToast(text);
            }}
            plainHead={isWideDesktop}
          />
        ) : null}
      </Sheet>
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-booking-toast" />
        </React.Suspense>
      ) : null}
    </>
  );
}

interface BodyProps {
  brandId: string | null;
  venueId: string | null;
  groupId: string;
  mode: Mode;
  setMode: (mode: Mode) => void;
  onClose: () => void;
  onDone: (toast: string) => void;
  plainHead: boolean;
}

function BookingBody({ brandId, venueId, groupId, mode, setMode, onClose, onDone, plainHead }: BodyProps): React.ReactElement {
  const query = useVenueBooking(brandId, venueId, groupId);
  const access = useVenueEditAccess(brandId, venueId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const b = query.data;

  if (query.isLoading) {
    return (
      <View style={styles.body} testID="venue-booking-loading" accessibilityLabel="Loading booking">
        <PickerSheetHead title="Booking" onClose={onClose} plain={plainHead} />
        <Skeleton height={24} width="60%" />
        <Skeleton height={120} radius="md" />
        <Skeleton height={120} radius="md" />
      </View>
    );
  }
  if (query.isError || b === undefined) {
    const err = query.error === null ? null : toVenueOfferError(query.error);
    return (
      <View style={styles.body} testID="venue-booking-error">
        <PickerSheetHead title="Booking" onClose={onClose} plain={plainHead} />
        <Text style={styles.title}>Couldn&apos;t load this booking</Text>
        <Text style={styles.meta}>
          {err !== null && err.code !== "unknown" && err.code !== "network" ? offerErrorCopy(err.code) : "Check your connection and try again."}
        </Text>
        <View>
          <Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} />
        </View>
      </View>
    );
  }

  const offer = (offersQuery.data?.offers ?? []).find((o) => o.id === b.offer.id) ?? null;
  const canMoney = (b.canManageMoney || access.canManageMoney) && b.state === "confirmed";
  const canChange = b.canChange && b.state === "confirmed";
  const common = { b, brandId, venueId, onBack: () => setMode("view"), onDone };

  if (mode === "pay") return <Shell title="Mark as paid" onClose={onClose} plainHead={plainHead}><PayForm {...common} /></Shell>;
  if (mode === "guests") {
    const opts = offer?.options ?? [];
    // #4490 P4 follow-up: a hire changes within its own place (up to the place's capacity when extra guests are sold).
    const hireRange = b.hire !== null ? hireGuestRangeFor(offer?.hire ?? null, b.lines.find((l) => l.state !== "cancelled")?.priceOptionId ?? null) : null;
    const min = hireRange?.min ?? (opts.length > 0 ? Math.min(...opts.map((o) => o.guestMin)) : 1);
    const max = hireRange?.max ?? (opts.length > 0 ? Math.max(...opts.map((o) => o.guestMax)) : 1000);
    return <Shell title="Change guest numbers" onClose={onClose} plainHead={plainHead}><GuestsForm {...common} min={min} max={max} /></Shell>;
  }
  if (mode === "date") return <Shell title="Move the date" onClose={onClose} plainHead={plainHead}><DateForm {...common} offer={offer} /></Shell>;
  if (mode === "deposit_release") return <Shell title="Return the damage deposit" onClose={onClose} plainHead={plainHead}><DepositReleaseForm {...common} /></Shell>;
  if (mode === "deposit_hold") return <Shell title="Hold the damage deposit" onClose={onClose} plainHead={plainHead}><DepositHoldForm {...common} /></Shell>;
  if (mode === "extras") {
    return (
      <Shell title="Add an extra" onClose={onClose} plainHead={plainHead}>
        <ExtrasForm {...common} extras={offer?.extras ?? []} />
      </Shell>
    );
  }
  if (mode === "cancel") return <Shell title="Cancel booking" onClose={onClose} plainHead={plainHead}><CancelForm {...common} /></Shell>;

  const st = bookingStateWords(b.state);
  const now = Date.now();
  const overdue = isOverdue(b, now) && b.state === "confirmed";
  const due = balanceDueLine(b, now);
  const guests = b.lines.reduce((n, l) => n + l.guests, 0);
  const answers = Object.entries(b.answers);
  const facts = [
    { key: "offer", label: b.offerKind === "group_package" ? "Package" : b.offerKind === "private_hire" ? "Private hire" : "Offer", value: b.hire?.placeName ?? (b.offer.name || "—") },
    { key: "when", label: "When", value: whenLine(b) },
    {
      key: "guests",
      label: "Guests",
      value: `${guests}${b.admits > 0 && b.admittedCount > 0 ? ` · ${b.admittedCount} in` : ""}${
        b.changeRules?.guestChangeUntil ? ` · final numbers by ${shortDay(dateIn(b.changeRules.guestChangeUntil, b.timezone) ?? "")}` : ""
      }`,
    },
    { key: "by", label: "Booked by", value: [b.guest.name, b.guest.phone, b.guest.email].filter(Boolean).join(" · ") },
    { key: "ref", label: "Reference", value: shortBookingReference(b.reference) },
    ...(b.hire !== null ? hireFacts(b) : answers.map(([q, a]) => ({ key: `a-${q}`, label: q, value: a }))),
  ];
  const historyItems = [
    ...b.history.map((h, i) => ({
      key: `h-${i}`,
      title: historyTitle(h.type, h.by),
      meta: h.at !== null ? `${shortDay(dateIn(h.at, b.timezone) ?? "")} ${clockIn(h.at, b.timezone) ?? ""}` : undefined,
      at: h.at ?? "",
    })),
    ...b.changes.map((c) => ({
      key: `c-${c.changeId}`,
      title: changeWords(c, b.currencyCode),
      meta: c.createdAt !== null ? `${shortDay(dateIn(c.createdAt, b.timezone) ?? "")} ${clockIn(c.createdAt, b.timezone) ?? ""}` : undefined,
      at: c.createdAt ?? "",
    })),
    ...b.paidAtVenue.map((p) => ({
      key: `p-${p.paymentId}`,
      title: `${money(p.amountMinor, b.currencyCode)} by ${methodLabel(p.method)}${p.note !== null ? ` · ${p.note}` : ""}`,
      meta: p.paidOn !== null ? shortDay(p.paidOn) : undefined,
      at: p.at ?? "",
    })),
  ]
    .sort((x, y) => x.at.localeCompare(y.at))
    .map(({ at: _at, ...rest }) => ({ ...rest, state: "done" as const }));

  return (
    <View style={styles.body} testID="venue-booking-detail">
      <PickerSheetHead title={b.guest.name} onClose={onClose} plain={plainHead} testID="venue-booking-head" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.pills}>
          <Pill variant={st.variant}>{st.label}</Pill>
          {overdue ? <Pill variant="error">Balance overdue</Pill> : b.balanceDueMinor > 0 && b.state === "confirmed" ? <Pill variant="warn">Balance due</Pill> : null}
        </View>
        {overdue ? (
          <Banner tone="danger" title={due ?? "Balance overdue"} body="Send a reminder, or take the money when they arrive." testID="venue-booking-overdue" />
        ) : null}
        <View style={styles.facts} testID="venue-booking-facts">
          {facts.map((f) => (
            <View key={f.key} style={styles.factRow}>
              <Text style={styles.factLabel}>{f.label}</Text>
              <Text style={styles.factValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {b.extras.length > 0 || b.inclusions.some((i) => i.kind !== "choice") ? (
          <View style={styles.section}>
            {b.inclusions.some((i) => i.kind !== "choice") ? (
              <>
                <Text style={styles.sectionLabel}>Included</Text>
                <Text style={styles.meta}>{b.inclusions.filter((i) => i.kind !== "choice").map((i) => i.label).join(" · ")}</Text>
              </>
            ) : null}
            {b.extras.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Extras</Text>
                {b.extras.map((e, i) => (
                  <View key={`${e.id}-${i}`} style={styles.lineRow}>
                    <Text style={[styles.meta, styles.grow]}>
                      {e.qty > 1 ? `${e.qty} × ` : ""}
                      {e.name}
                      {e.addedAt !== null ? " (added later)" : ""}
                    </Text>
                    <Text style={styles.meta}>{money(e.amountMinor, b.currencyCode)}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section} testID="venue-booking-money">
          <Text style={styles.sectionLabel}>Money</Text>
          <KeyValue items={moneyRows(b)} />
          {due !== null && !overdue ? <Text style={styles.meta}>{due}</Text> : null}
          {canMoney && b.balanceDueMinor > 0 ? (
            <View style={styles.actionRow}>
              <Button label="Mark as paid" variant="primary" size="md" leadingIcon="cash" onPress={() => setMode("pay")} testID="venue-booking-mark-paid" />
              {b.guest.email !== null ? <ReminderButton b={b} brandId={brandId} venueId={venueId} onDone={onDone} /> : null}
            </View>
          ) : b.balanceDueMinor > 0 && b.state === "confirmed" ? (
            <Text style={styles.meta}>Only people who handle money for this venue can mark it as paid.</Text>
          ) : null}
        </View>

        {b.hire?.damageDeposit ? (
          <DepositSection b={b} canMoney={b.canManageMoney || access.canManageMoney} setMode={setMode} />
        ) : null}

        {canChange ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Change</Text>
            {b.changeRules === null || b.changeRules.canChangeGuests ? (
              <ActionLine icon="users" label="Change guest numbers" detail={`${guests} now`} onPress={() => setMode("guests")} testID="venue-booking-change-guests" />
            ) : null}
            {b.changeRules === null || b.changeRules.canMove ? (
              <ActionLine icon="calendar" label="Move the date" detail={b.window !== null ? shortDay(b.window.localDate) : null} onPress={() => setMode("date")} testID="venue-booking-move" />
            ) : null}
            {b.changeRules !== null && !b.changeRules.canChangeGuests && !b.changeRules.canMove ? (
              <Text style={styles.meta}>The guest numbers and the day can&apos;t be changed any more under this booking&apos;s terms.</Text>
            ) : null}
            {offer !== null && offer.extras.length > 0 ? (
              <ActionLine icon="plus" label="Add an extra" detail={null} onPress={() => setMode("extras")} testID="venue-booking-add-extra" />
            ) : null}
            <ActionLine icon="refund" label="Cancel booking" detail="See the refund first" onPress={() => setMode("cancel")} danger testID="venue-booking-cancel" />
          </View>
        ) : b.state === "confirmed" ? (
          <Text style={styles.meta}>Only people who run bookings at this venue can change or cancel it.</Text>
        ) : null}

        {historyItems.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>History</Text>
            <Timeline items={historyItems} testID="venue-booking-history" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** #4490 P4 — the hire facts: session, setup and cleanup, the damage deposit, the guest's answers and the saved terms. */
function hireFacts(b: VenueBookingDetail): Array<{ key: string; label: string; value: string }> {
  const h = b.hire;
  if (h === null) return [];
  const out: Array<{ key: string; label: string; value: string }> = [];
  if (h.sessionLabel !== null) out.push({ key: "session", label: "Session", value: h.sessionLabel });
  if (h.layout !== null && h.layoutCapacity !== null) {
    out.push({ key: "layout", label: "Layout", value: venueLayoutSummary(h.layout, h.layoutCapacity) });
  }
  const setup = clockIn(h.setupFrom, b.timezone);
  const cleanup = clockIn(h.cleanupUntil, b.timezone);
  if (setup !== null && cleanup !== null) out.push({ key: "setup", label: "Setup", value: `From ${setup} · cleanup until ${cleanup}` });
  if (h.extraGuests > 0) out.push({ key: "extra", label: "Extra guests", value: `${h.extraGuests} · ${money(h.extraGuestMinor, b.currencyCode)}` });
  if (h.overtimeHours > 0) out.push({ key: "over", label: "Running over", value: `${h.overtimeHours} h · ${money(h.overtimeMinor, b.currencyCode)}` });
  if (h.damageDepositMinor > 0 && h.damageDeposit === null) out.push({ key: "damage", label: "Damage deposit", value: `${money(h.damageDepositMinor, b.currencyCode)} · refundable` });
  if (h.occasion !== null) out.push({ key: "occasion", label: "Occasion", value: h.occasion });
  if (h.note !== null) out.push({ key: "note", label: "Their note", value: h.note });
  if (h.siteVisit) out.push({ key: "visit", label: "Site visit", value: "Asked to see the space first" });
  if (h.hostNote !== null) out.push({ key: "hostNote", label: "Your note", value: h.hostNote });
  if (b.policyText !== null) out.push({ key: "terms", label: "Terms", value: b.policyText });
  return out;
}

function Shell({ title, onClose, plainHead, children }: { title: string; onClose: () => void; plainHead: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.body}>
      <PickerSheetHead title={title} onClose={onClose} plain={plainHead} />
      {children}
    </View>
  );
}

function ActionLine({
  icon,
  label,
  detail,
  onPress,
  danger = false,
  testID,
}: {
  icon: "users" | "calendar" | "plus" | "refund";
  label: string;
  detail: string | null;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail !== null ? `${label}, ${detail}` : label}
      style={({ pressed }) => [styles.actionLine, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Icon name={icon} size={18} color={danger ? color.errorText : color.text2} />
      <Text style={[styles.actionLabel, danger ? styles.danger : null]}>{label}</Text>
      {detail !== null ? <Text style={styles.meta}>{detail}</Text> : null}
      <Icon name="chevR" size={16} color={color.text3} />
    </Pressable>
  );
}

function FormFooter({
  onBack,
  primary,
  onPrimary,
  disabled,
  loading,
  error,
  testID,
  danger = false,
}: {
  onBack: () => void;
  primary: string;
  onPrimary: () => void;
  disabled: boolean;
  loading: boolean;
  error: string | null;
  testID: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.footer}>
      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      <View style={styles.footerRow}>
        <Button label="Back" variant="ghost" size="md" onPress={onBack} disabled={loading} testID={`${testID}-back`} />
        <Button label={primary} variant={danger ? "destructive" : "primary"} size="md" onPress={onPrimary} disabled={disabled} loading={loading} testID={`${testID}-confirm`} />
      </View>
    </View>
  );
}

interface FormProps {
  b: VenueBookingDetail;
  brandId: string | null;
  venueId: string | null;
  onBack: () => void;
  onDone: (toast: string) => void;
}

function ReminderButton({ b, brandId, venueId, onDone }: Pick<FormProps, "b" | "brandId" | "venueId" | "onDone">): React.ReactElement {
  const action = useBookingMoneyAction(brandId, venueId, b.groupId);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.grow}>
      <Button
        label="Send a reminder"
        variant="secondary"
        size="md"
        leadingIcon="send"
        loading={action.isPending}
        onPress={() => {
          setError(null);
          action.mutate(
            { kind: "reminder" },
            {
              onSuccess: () => onDone(`Reminder sent to ${b.guest.email ?? "the guest"}`),
              onError: (e) => {
                const err = toVenueOfferError(e);
                setError(offerErrorCopy(err.code, err.detail));
              },
            },
          );
        }}
        testID="venue-booking-reminder"
      />
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function PayForm({ b, brandId, venueId, onBack, onDone }: FormProps): React.ReactElement {
  const action = useBookingMoneyAction(brandId, venueId, b.groupId);
  const today = todayIso(b.timezone);
  const [amount, setAmount] = useState<number | null>(b.balanceDueMinor);
  const [method, setMethod] = useState<OfflineMethod>("transfer");
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const issue =
    amount === null || amount <= 0
      ? "Enter the amount they paid"
      : amount > b.balanceDueMinor
        ? `They only owe ${money(b.balanceDueMinor, b.currencyCode)}`
        : null;
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-pay">
        <Text style={styles.meta}>
          Record money {b.guest.name} paid you directly. It counts towards the {money(b.balanceDueMinor, b.currencyCode)} still to pay. Nothing is charged.
        </Text>
        <MoneyField label="Amount" valueMinor={amount} onChangeMinor={setAmount} currency={b.currencyCode} error={amount !== null ? issue : null} testID="venue-booking-pay-amount" />
        <Text style={styles.label}>How they paid</Text>
        <Segmented options={OFFLINE_METHODS} value={method} onChange={setMethod} accessibilityLabel="How they paid" testID="venue-booking-pay-method" />
        <DayDateField label="Paid on" value={paidOn} onChangeValue={setPaidOn} accessibilityLabel="Paid on" today={today} testID="venue-booking-pay-date" />
        <View style={styles.field}>
          <Text style={styles.label}>Note (optional)</Text>
          <Input value={note} onChangeText={(t) => setNote(t.slice(0, 200))} placeholder="e.g. Transfer from Ada's company" accessibilityLabel="Note" />
        </View>
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary={amount !== null && amount > 0 ? `Record ${money(amount, b.currencyCode)}` : "Record payment"}
        disabled={issue !== null}
        loading={action.isPending}
        error={error}
        testID="venue-booking-pay"
        onPrimary={() => {
          if (issue !== null || amount === null) return;
          setError(null);
          action.mutate(
            { kind: "record_payment", amountMinor: amount, method, paidOn, note: note.trim().length > 0 ? note.trim() : null },
            {
              onSuccess: (r) =>
                onDone(r.balanceMinor > 0 ? `Recorded. ${money(r.balanceMinor, b.currencyCode)} still to pay` : "Recorded. Paid in full"),
              onError: (e) => {
                const err = toVenueOfferError(e);
                setError(offerErrorCopy(err.code, err.detail));
              },
            },
          );
        }}
      />
    </>
  );
}

/** Ask the server what a change does to the money (debounced), then apply it. */
function usePreview(
  b: VenueBookingDetail,
  brandId: string | null,
  venueId: string | null,
  action: BookingChangeAction,
  payload: Record<string, unknown> | null,
): {
  summary: BookingChangeSummary | null;
  previewError: string | null;
  loading: boolean;
  apply: (onDone: (s: BookingChangeSummary) => void, onError: (text: string) => void) => void;
  applying: boolean;
} {
  const preview = useBookingChange(brandId, venueId, b.groupId);
  const applyM = useBookingChange(brandId, venueId, b.groupId);
  const [summary, setSummary] = useState<BookingChangeSummary | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const key = payload === null ? null : JSON.stringify(payload);
  useEffect(() => {
    setSummary(null);
    setPreviewError(null);
    if (payload === null) return undefined;
    const timer = setTimeout(() => {
      preview.mutate(
        { action, payload, preview: true },
        {
          onSuccess: (s) => setSummary(s),
          onError: (e) => {
            const err = toVenueOfferError(e);
            setPreviewError(offerErrorCopy(err.code, err.detail));
          },
        },
      );
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    summary,
    previewError,
    loading: preview.isPending,
    applying: applyM.isPending,
    apply: (done, fail) => {
      if (payload === null) return;
      applyM.mutate(
        { action, payload, preview: false, expectedVersion: summary?.groupVersion ?? b.version },
        {
          onSuccess: done,
          onError: (e) => {
            const err = toVenueOfferError(e);
            fail(offerErrorCopy(err.code, err.detail));
          },
        },
      );
    },
  };
}

function PreviewBlock({ summary, loading, error, testID }: { summary: BookingChangeSummary | null; loading: boolean; error: string | null; testID: string }): React.ReactElement | null {
  if (error !== null) return <Banner tone="danger" title="This change can't be made" body={error} testID={`${testID}-preview-error`} />;
  if (loading || summary === null) return loading ? <Text style={styles.meta}>Working out the price…</Text> : null;
  const words = changePreviewWords(summary);
  return <Banner tone={summary.refundMinor > 0 ? "warning" : "info"} title={words.title} body={words.body} testID={`${testID}-preview`} />;
}

function GuestsForm({ b, brandId, venueId, onBack, onDone, min, max }: FormProps & { min: number; max: number }): React.ReactElement {
  const now = b.lines.reduce((n, l) => n + l.guests, 0);
  const [guests, setGuests] = useState(now);
  const line = b.lines.find((l) => l.state !== "cancelled") ?? b.lines[0];
  const payload = guests === now ? null : { guests, ...(b.lines.length > 1 && line !== undefined ? { lineId: line.lineId } : {}) };
  const p = usePreview(b, brandId, venueId, "change_guests", payload);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-guests">
        <Text style={styles.meta}>Booked for {now}. The group can be {min} to {max} guests.</Text>
        <NumberStepper label="Guests" value={guests} min={Math.max(1, Math.min(min, now))} max={Math.max(max, now)} onChange={setGuests} testID="venue-booking-guests-stepper" />
        {payload === null ? <Text style={styles.meta}>Change the number to see the new price.</Text> : null}
        <PreviewBlock summary={p.summary} loading={p.loading} error={p.previewError} testID="venue-booking-guests" />
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary={payload === null ? "Change guests" : `Change to ${guests} guests`}
        disabled={payload === null || p.summary === null || p.previewError !== null}
        loading={p.applying}
        error={error}
        testID="venue-booking-guests"
        onPrimary={() => {
          setError(null);
          p.apply(
            (s) => onDone(s.amountMinor > 0 ? `${guests} guests. ${money(s.amountMinor, s.currencyCode)} more to pay` : `${guests} guests`),
            setError,
          );
        }}
      />
    </>
  );
}

function DateForm({ b, brandId, venueId, onBack, onDone, offer }: FormProps & { offer: VenueOffer | null }): React.ReactElement {
  const today = todayIso(b.timezone);
  const [date, setDate] = useState<string>(b.window !== null && b.window.localDate > today ? b.window.localDate : addDays(today, 1));
  const [windowId, setWindowId] = useState<string | null>(null);
  const [rows, setRows] = useState<MoveDayRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const guests = b.lines.reduce((n, l) => n + l.guests, 0);
  const offeringId = b.offer.id;
  useEffect(() => {
    let live = true;
    setRows(null);
    setWindowId(null);
    setLoadError(null);
    if (offeringId === null) return undefined;
    // #4490 P4 follow-up: a hire moves to another session window, named like the guest sees it.
    const load = loadVenueGuestScreens().then(({ venueOfferGuestService, sessionChipsFor }): Promise<MoveDayRow[]> =>
      b.hire !== null
        ? venueOfferGuestService.hireDays({ offeringId, from: date, to: date, guests }).then((r) =>
            sessionChipsFor(r, date, (offer?.hire?.sessions ?? []).map((x) => ({ ...x, weekdays: x.weekdays })), b.timezone, true).map((c) => ({
              windowId: c.windowId,
              startsAt: r.find((x) => x.windowId === c.windowId)?.startsAt ?? "",
              status: r.find((x) => x.windowId === c.windowId)?.status ?? "closed",
              remaining: 1,
              label: `${c.label}${c.times !== null ? ` ${c.times}` : ""}`,
            })),
          )
        : venueOfferGuestService
            .availability({ offeringId, from: date, to: date })
            .then((r) => r.filter((x) => x.localDate === date).map((x) => ({ windowId: x.windowId, startsAt: x.startsAt, status: x.status, remaining: x.remaining, label: null }))),
    );
    load
      .then((list) => {
        if (live) setRows(list);
      })
      .catch(() => {
        if (live) setLoadError("Couldn't load the times for that day. Try again.");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, offeringId]);
  const payload = windowId === null || windowId === b.window?.windowId ? null : { windowId };
  const p = usePreview(b, brandId, venueId, "move_date", payload);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-date">
        <Text style={styles.meta}>
          Now on {whenLine(b)}. Pick the new day, then the {b.hire !== null ? "session" : "time"}.
          {b.hire !== null ? " The same space must be free then, setup and cleanup included." : ""}
        </Text>
        <DayDateField label="Move to" value={date} onChangeValue={setDate} accessibilityLabel="New date" min={addDays(today, 1)} today={today} testID="venue-booking-date-field" />
        {loadError !== null ? (
          <Text style={styles.error}>{loadError}</Text>
        ) : rows === null ? (
          <Skeleton height={44} radius="md" />
        ) : rows.length === 0 ? (
          <Text style={styles.meta}>Nothing runs on {shortDay(date)}. Pick another day.</Text>
        ) : (
          <View style={styles.chips}>
            {rows.map((r) => {
              const time = r.label ?? clockIn(r.startsAt, b.timezone) ?? "—";
              // Staff may move into kept-for-walk-in places, so only a closed or truly full slot is off.
              const off = r.status === "closed" || r.status === "wrong_weekday" || (r.status === "sold_out" && r.remaining < guests);
              const note = off ? (b.hire !== null ? "Closed" : "Full") : b.hire !== null && r.status === "held" ? "On hold" : b.hire !== null && r.status === "taken" ? "Booked" : null;
              const on = r.windowId === windowId;
              return (
                <Pressable
                  key={r.windowId}
                  onPress={() => (off ? undefined : setWindowId(r.windowId))}
                  disabled={off}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: off }}
                  accessibilityLabel={`${time}${off ? ", not available" : note !== null ? `, ${note}` : ""}`}
                  style={[styles.chip, on ? styles.chipOn : null, off ? styles.chipOff : null]}
                  testID={`venue-booking-date-time-${time}`}
                >
                  <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{time}</Text>
                  {note !== null ? <Text style={styles.chipNote}>{note}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}
        <PreviewBlock summary={p.summary} loading={p.loading} error={p.previewError} testID="venue-booking-date" />
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary={payload === null ? "Move booking" : `Move to ${shortDay(date)}`}
        disabled={payload === null || p.summary === null || p.previewError !== null}
        loading={p.applying}
        error={error}
        testID="venue-booking-date"
        onPrimary={() => {
          setError(null);
          p.apply(() => onDone(`Moved to ${shortDay(date)}`), setError);
        }}
      />
    </>
  );
}

function ExtrasForm({ b, brandId, venueId, onBack, onDone, extras }: FormProps & { extras: Array<{ id: string; name: string; priceMinor: number; per: "booking" | "guest" }> }): React.ReactElement {
  const [picked, setPicked] = useState<string[]>([]);
  const payload = useMemo(() => (picked.length === 0 ? null : { extras: picked.map((id) => ({ id })) }), [picked]);
  const p = usePreview(b, brandId, venueId, "add_extras", payload);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-extras">
        <Text style={styles.meta}>Tick what to add. The guest owes the difference.</Text>
        {extras.map((e) => {
          const on = picked.includes(e.id);
          const already = b.extras.some((x) => x.id === e.id);
          return (
            <Pressable
              key={e.id}
              onPress={() => setPicked((cur) => (on ? cur.filter((x) => x !== e.id) : [...cur, e.id]))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${e.name}, ${money(e.priceMinor, b.currencyCode)} ${e.per === "guest" ? "a guest" : "a booking"}`}
              style={[styles.checkRow, on ? styles.checkRowOn : null]}
              testID={`venue-booking-extra-${e.id}`}
            >
              <View style={[styles.box, on ? styles.boxOn : null]}>{on ? <Icon name="check" size={14} color={color.text1} /> : null}</View>
              <Text style={[styles.actionLabel, styles.grow]}>
                {e.name}
                {already ? " (already added)" : ""}
              </Text>
              <Text style={styles.meta}>
                {money(e.priceMinor, b.currencyCode)} {e.per === "guest" ? "a guest" : ""}
              </Text>
            </Pressable>
          );
        })}
        <PreviewBlock summary={p.summary} loading={p.loading} error={p.previewError} testID="venue-booking-extras" />
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary="Add to booking"
        disabled={payload === null || p.summary === null || p.previewError !== null}
        loading={p.applying}
        error={error}
        testID="venue-booking-extras"
        onPrimary={() => {
          setError(null);
          p.apply((s) => onDone(`Added. ${money(s.amountMinor, s.currencyCode)} more to pay`), setError);
        }}
      />
    </>
  );
}

/** #4490 P4 follow-up — the refundable damage deposit: held, held by the venue, or returned (all or part). */
function DepositSection({ b, canMoney, setMode }: { b: VenueBookingDetail; canMoney: boolean; setMode: (m: Mode) => void }): React.ReactElement | null {
  const d = b.hire?.damageDeposit ?? null;
  if (d === null) return null;
  const words = damageDepositWords(d, b.currencyCode, b.timezone, Date.now());
  const canAct = canMoney && (d.status === "collected" || d.status === "held_by_venue");
  return (
    <View style={styles.section} testID="venue-booking-deposit">
      <Text style={styles.sectionLabel}>Damage deposit</Text>
      <View style={styles.pills}>
        <Pill variant={words.variant}>{words.pill}</Pill>
      </View>
      <Text style={styles.meta}>{words.body}</Text>
      {canAct ? (
        <View style={styles.actionRow}>
          <Button
            label={d.status === "held_by_venue" ? "Return it" : "Return it now"}
            variant="secondary"
            size="md"
            leadingIcon="refund"
            onPress={() => setMode("deposit_release")}
            disabled={!words.ended}
            testID="venue-booking-deposit-release"
          />
          {d.status === "collected" ? (
            <Button label="Hold it" variant="ghost" size="md" onPress={() => setMode("deposit_hold")} testID="venue-booking-deposit-hold" />
          ) : null}
        </View>
      ) : null}
      {canAct && !words.ended ? <Text style={styles.meta}>You can return it once the hire has ended.</Text> : null}
      {!canMoney && (d.status === "collected" || d.status === "held_by_venue") ? (
        <Text style={styles.meta}>Only people who handle money for this venue can return or hold it.</Text>
      ) : null}
    </View>
  );
}

function DepositReleaseForm({ b, brandId, venueId, onBack, onDone }: FormProps): React.ReactElement {
  const d = b.hire?.damageDeposit ?? null;
  const held = d?.paidMinor ?? 0;
  const action = useDamageDeposit(brandId, venueId, b.groupId);
  const [key] = useState(() => `deposit-release-${randomId()}`);
  const [how, setHow] = useState<"all" | "some">("all");
  const [keep, setKeep] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keepMinor = how === "all" ? 0 : keep ?? 0;
  const back = Math.max(0, held - keepMinor);
  const issue =
    how === "some" && (keep === null || keep <= 0)
      ? "Enter how much you're keeping"
      : keepMinor > held
        ? `You can keep at most ${money(held, b.currencyCode)}`
        : how === "some" && reason.trim().length < 3
          ? "Say why you're keeping it"
          : null;
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-deposit-release-form">
        <Text style={styles.meta}>
          {b.guest.name} paid a {money(held, b.currencyCode)} damage deposit. It goes back the way they paid, and they&apos;re told by email.
        </Text>
        <Segmented
          options={[
            { key: "all", label: "Return all of it" },
            { key: "some", label: "Keep some" },
          ]}
          value={how}
          onChange={setHow}
          accessibilityLabel="How much to return"
          testID="venue-booking-deposit-how"
        />
        {how === "some" ? (
          <>
            <MoneyField label="Amount you keep" valueMinor={keep} onChangeMinor={setKeep} currency={b.currencyCode} error={keep !== null && keepMinor > held ? issue : null} testID="venue-booking-deposit-keep" />
            <View style={styles.field}>
              <Text style={styles.label}>Why (the guest sees this)</Text>
              <Input value={reason} onChangeText={(t) => setReason(t.slice(0, 500))} placeholder="e.g. Broken table, invoice attached in email" accessibilityLabel="Why you keep part of the deposit" testID="venue-booking-deposit-reason" />
            </View>
          </>
        ) : null}
        <Banner
          tone={keepMinor > 0 ? "warning" : "info"}
          title={`${money(back, b.currencyCode)} goes back to ${b.guest.name}`}
          body={keepMinor > 0 ? `You keep ${money(keepMinor, b.currencyCode)}. This can't be undone.` : "This can't be undone."}
          testID="venue-booking-deposit-preview"
        />
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary={back > 0 ? `Return ${money(back, b.currencyCode)}` : "Keep all of it"}
        disabled={issue !== null}
        loading={action.isPending}
        error={error}
        testID="venue-booking-deposit-release"
        onPrimary={() => {
          if (issue !== null) return;
          setError(null);
          action.mutate(
            { kind: "release", keepMinor, reason: keepMinor > 0 ? reason.trim() : null, idempotencyKey: key },
            {
              onSuccess: (s) => onDone(s !== null && (s.refundedMinor ?? 0) > 0 ? `${money(s.refundedMinor ?? 0, b.currencyCode)} is on its way back` : "Damage deposit settled"),
              onError: (e) => {
                const err = toVenueOfferError(e);
                setError(offerErrorCopy(err.code, err.detail));
              },
            },
          );
        }}
      />
    </>
  );
}

function DepositHoldForm({ b, brandId, venueId, onBack, onDone }: FormProps): React.ReactElement {
  const action = useDamageDeposit(brandId, venueId, b.groupId);
  const [key] = useState(() => `deposit-hold-${randomId()}`);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const issue = reason.trim().length < 3 ? "Say why you're holding it" : null;
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-deposit-hold-form">
        <Text style={styles.meta}>
          The deposit stops going back by itself. Return it here when it&apos;s sorted, all of it or part.
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>Why</Text>
          <Input value={reason} onChangeText={(t) => setReason(t.slice(0, 500))} placeholder="e.g. Checking a stain on the sofa" accessibilityLabel="Why you are holding the deposit" testID="venue-booking-deposit-hold-reason" />
        </View>
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary="Hold the deposit"
        disabled={issue !== null}
        loading={action.isPending}
        error={error}
        testID="venue-booking-deposit-hold"
        onPrimary={() => {
          if (issue !== null) return;
          setError(null);
          action.mutate(
            { kind: "hold", reason: reason.trim(), idempotencyKey: key },
            {
              onSuccess: () => onDone("Deposit held. It won't go back by itself"),
              onError: (e) => {
                const err = toVenueOfferError(e);
                setError(offerErrorCopy(err.code, err.detail));
              },
            },
          );
        }}
      />
    </>
  );
}

function CancelForm({ b, brandId, venueId, onBack, onDone }: FormProps): React.ReactElement {
  const { preview, cancel } = useStaffCancel(brandId, venueId, b.groupId);
  const [data, setData] = useState<StaffCancelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<"guest" | "venue">("guest");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    preview.mutate(undefined, {
      onSuccess: setData,
      onError: (e) => {
        const err = toVenueOfferError(e);
        setError(offerErrorCopy(err.code, err.detail));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.groupId]);
  const ready = data !== null && typed.trim().toUpperCase() === "CANCEL";
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="venue-booking-cancel-form">
        {data === null && error === null ? <Text style={styles.meta}>Working out the refund…</Text> : null}
        {data !== null ? (
          <Banner
            tone="warning"
            title={data.refundMinor > 0 ? `${money(data.refundMinor, data.currencyCode)} goes back` : "No online refund"}
            body={staffCancelWords({
              paidMinor: data.paidMinor,
              refundMinor: data.refundMinor,
              keepMinor: data.keepMinor,
              paidAtVenueMinor: b.paidAtVenueMinor,
              currency: data.currencyCode,
            })}
            testID="venue-booking-cancel-preview"
          />
        ) : null}
        <Text style={styles.label}>Who is cancelling?</Text>
        <Segmented
          options={[
            { key: "guest", label: "The guest asked" },
            { key: "venue", label: "The venue" },
          ]}
          value={who}
          onChange={setWho}
          accessibilityLabel="Who is cancelling"
        />
        <Text style={styles.meta}>{b.guest.name} is told by email. Their places are freed for others. This can&apos;t be undone.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Type CANCEL to confirm</Text>
          <Input value={typed} onChangeText={setTyped} placeholder="CANCEL" accessibilityLabel="Type CANCEL to confirm" testID="venue-booking-cancel-type" />
        </View>
      </ScrollView>
      <FormFooter
        onBack={onBack}
        primary="Cancel booking"
        danger
        disabled={!ready}
        loading={cancel.isPending}
        error={error}
        testID="venue-booking-cancel"
        onPrimary={() => {
          if (data === null) return;
          setError(null);
          cancel.mutate(
            { preview: data, reason: who === "guest" ? "guest_request" : "venue_cancelled" },
            {
              onSuccess: (r) => onDone(r.refundMinor > 0 ? `Cancelled. ${money(r.refundMinor, data.currencyCode)} is on its way back` : "Booking cancelled"),
              onError: (e) => {
                const err = toVenueOfferError(e);
                setError(offerErrorCopy(err.code, err.detail));
                if (err.code === "offer_cancel_preview_invalid") setData(null);
              },
            },
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  content: { gap: space[3], paddingBottom: space[8] },
  title: { ...type.h2, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  label: { ...type.small, color: color.text2 },
  error: { ...type.caption, color: color.errorText },
  grow: { flex: 1, minWidth: 0 },
  field: { gap: space[1] },
  pills: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  facts: { gap: space[2] },
  factRow: { flexDirection: "row", gap: space[3], alignItems: "flex-start" },
  factLabel: { ...type.small, color: color.text2, width: 110, flexShrink: 0 },
  factValue: { ...type.small, color: color.text1, fontWeight: "600", flex: 1, minWidth: 0 },
  section: { gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.line },
  sectionLabel: { ...type.label, color: color.text3 },
  lineRow: { flexDirection: "row", gap: space[2], alignItems: "baseline" },
  actionRow: { flexDirection: "row", gap: space[2], flexWrap: "wrap", alignItems: "flex-start" },
  actionLine: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48, borderRadius: radius.sm, paddingHorizontal: space[1] },
  actionLabel: { ...type.row, color: color.text1, flex: 1 },
  danger: { color: color.errorText },
  pressed: { backgroundColor: color.fill.pressed },
  footer: { gap: space[2], paddingTop: space[3], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.line },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { borderColor: color.text1, backgroundColor: color.fill.tile },
  chipOff: { opacity: 0.45 },
  chipText: { ...type.small, color: color.text2, fontVariant: ["tabular-nums"] },
  chipTextOn: { color: color.text1, fontWeight: "600" },
  chipNote: { ...type.caption, color: color.text3 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48, paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  checkRowOn: { borderColor: color.text1 },
  box: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5, borderColor: color.text3, alignItems: "center", justifyContent: "center" },
  boxOn: { borderColor: color.text1, backgroundColor: color.fill.tile },
});
