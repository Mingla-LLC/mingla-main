/**
 * #4490 P4-2 — Requests (`rq`, `rq-quote`, `rq-approve`, `rq-wait`,
 * `rq-declined`, `rq-expired`, `rq-empty`, `ph-rq`, `ph-rq-confirm`).
 *
 * Four tabs (To answer, Waiting for deposit, Confirmed, Closed) from one read
 * (`issue_4490_requests_list`, filter `all`). Wide web: the list and the
 * request side by side; phone: the list opens the request in place with a
 * Back button. A request to answer shows who, the space, the date and
 * session, the guests, whether the space is free that day, the guest's note
 * and the quote; the host approves (with an edited price and a note), declines
 * with a reason and up to three other dates, or — when the space is held for
 * someone else — puts the guest next in line or offers the next free date.
 * A held request says "On hold until <time>" and who is next; the host can
 * give more time or release it. Every refusal is plain words.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { venueLayoutSummary } from "@mingla/brand-rendering/venueOffers/layoutModel";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueBooking } from "../../../../hooks/useVenueBooking";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useNextFreeDates, useStaffRequestAction, useVenueRequests } from "../../../../hooks/useVenueHire";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { VenueStaffError } from "../../../../services/venueOffersService";
import type { RequestTab, VenueBookingDetail, VenueRequest } from "../../../../types/venueOffers";
import type { VenueModule } from "../../../../types/venueReservation";
import { randomId } from "../../../../utils/randomId";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { DayDateField } from "../../../ui/DayDateField";
import { EmptyState } from "../../../ui/EmptyState";
import { GlassCard } from "../../../ui/GlassCard";
import { Icon } from "../../../ui/Icon";
import { IconChrome } from "../../../ui/IconChrome";
import { Input } from "../../../ui/Input";
import { Modal } from "../../../ui/Modal";
import { MoneyField } from "../../../ui/MoneyField";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Pill, Segmented } from "../../../ui/Pill";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { Tabs } from "../../../ui/Tabs";
import { VenueBookingSheet } from "../bookings/VenueBookingSheet";
import { clockIn, dateIn, shortDay } from "../bookings/bookingModel";
import { money } from "../offers/offersModel";
import { venueScrollBottomPad } from "../../venueShellScroll";
import {
  REQUEST_TABS,
  agoWords,
  approveWords,
  closedWords,
  conflictWords,
  countFor,
  emptyWords,
  holdWords,
  momentWords,
  placeStatusWords,
  quotePreview,
  requestDateLine,
  requestPill,
  staffErrorCopy,
} from "./requestsModel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shortBookingReference } from "../../../../utils/venueBookingReference";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});
const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

export interface VenueRequestsModuleProps {
  brandId: string | null;
  venueId: string | null;
  onOpenModule?: (module: VenueModule) => void;
  /** `&item=<groupId>`: open that request on arrival. */
  initialGroupId?: string | null;
}

interface QuoteEdit {
  baseMinor: number;
  note: string;
}

/** The server's editable base is the whole pre-tax hire amount, extras included. */
function hireBaseMinor(booking: VenueBookingDetail | null | undefined): number | null {
  if (booking?.hire === null || booking?.hire === undefined) return null;
  return (
    booking.hire.hireMinor +
    booking.hire.extraGuestMinor +
    booking.hire.overtimeMinor +
    booking.extras.reduce((sum, extra) => sum + extra.amountMinor, 0)
  );
}

export function VenueRequestsModule({ brandId, venueId, onOpenModule, initialGroupId = null }: VenueRequestsModuleProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const bottomPad = venueScrollBottomPad(insets.bottom);
  const listQuery = useVenueRequests(brandId, venueId, "all");
  const offersQuery = useVenueOffers(brandId, venueId);
  const venueQuery = useVenueListing(venueId);
  const [tab, setTab] = useState<RequestTab>("to_answer");
  const [selected, setSelected] = useState<string | null>(initialGroupId);
  const [toast, setToast] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const data = listQuery.data;
  const all = useMemo(() => data?.requests ?? [], [data?.requests]);
  const rows = useMemo(() => all.filter((r) => r.tab === tab), [all, tab]);
  const timezone = offersQuery.data?.settings?.timezone ?? "Africa/Lagos";
  const hireOffer = (offersQuery.data?.offers ?? []).find((o) => o.kind === "private_hire" && o.hire !== null) ?? null;
  const replyHours = hireOffer?.hire?.requestResponseHours ?? 48;
  const venueName = venueQuery.data?.name ?? "your venue";

  // Arriving on a request: show its tab.
  useEffect(() => {
    if (initialGroupId === null) return;
    const r = all.find((x) => x.groupId === initialGroupId);
    if (r !== undefined) setTab(r.tab);
  }, [all, initialGroupId]);
  // The request just answered stays open while the list catches up with its new tab.
  const pinned = useRef<string | null>(null);
  // Wide web keeps one request open: the first of the tab when nothing is picked.
  useEffect(() => {
    if (!isWideDesktop) return;
    if (selected !== null && rows.some((r) => r.groupId === selected)) {
      if (pinned.current === selected) pinned.current = null;
      return;
    }
    if (pinned.current !== null && pinned.current === selected) return;
    setSelected(rows[0]?.groupId ?? null);
  }, [isWideDesktop, rows, selected]);

  const current = all.find((r) => r.groupId === selected) ?? null;

  if (listQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-requests-loading" accessibilityLabel="Loading requests">
        <Skeleton height={28} width="30%" />
        <Skeleton height={44} radius="md" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={72} radius="md" />
        ))}
      </View>
    );
  }
  if (listQuery.isError || data === undefined) {
    return (
      <CenteredState title="Couldn't load requests" body="Nothing was lost. Check your connection and try again." tone="error" testID="venue-requests-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void listQuery.refetch()} />
      </CenteredState>
    );
  }

  const tabs = REQUEST_TABS.map((t) => ({ key: t.key, label: t.label, count: countFor(t.key, data.counts), testID: `venue-requests-tab-${t.key}` }));
  const empty = emptyWords(tab, replyHours);
  const list =
    rows.length === 0 ? (
      <GlassCard variant="base" padding={space[5]} testID="venue-requests-empty">
        <EmptyState
          illustration="inbox"
          title={empty.title}
          description={empty.body}
          cta={
            tab === "to_answer" && hireOffer === null && onOpenModule !== undefined
              ? { label: "Set up private hire", onPress: () => onOpenModule("offers") }
              : undefined
          }
        />
      </GlassCard>
    ) : (
      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-requests-list">
        {rows.map((r, i) => {
          const pill = requestPill(r, now);
          const active = r.groupId === selected && isWideDesktop;
          return (
            <Pressable
              key={r.groupId}
              onPress={() => setSelected(r.groupId)}
              accessibilityRole="button"
              accessibilityLabel={`${r.guestName}, ${r.placeName ?? r.offerName}, ${r.guests} guests, ${requestDateLine(r, timezone)}, ${pill.label}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.row, i > 0 ? styles.rowBorder : null, active ? styles.rowActive : null, pressed ? styles.pressed : null]}
              testID={`venue-request-row-${r.groupId}`}
            >
              <View style={styles.iconTile}>
                <Icon name={r.offerKind === "private_hire" ? "home" : "users"} size={18} color={color.text2} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{r.guestName}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    r.placeName ?? r.offerName,
                    `${r.guests.toLocaleString("en-GB")} guests`,
                    r.layout !== null && r.layoutCapacity !== null ? venueLayoutSummary(r.layout, r.layoutCapacity) : null,
                  ].filter(Boolean).join(" · ")}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>{requestDateLine(r, timezone)}</Text>
              </View>
              <Pill variant={pill.variant}>{pill.label}</Pill>
            </Pressable>
          );
        })}
      </GlassCard>
    );

  const detail =
    current !== null ? (
      <RequestDetail
        key={current.groupId}
        brandId={brandId}
        venueId={venueId}
        r={current}
        all={all}
        timezone={timezone}
        venueName={venueName}
        replyHours={replyHours}
        now={now}
        onBack={isWideDesktop ? undefined : () => setSelected(null)}
        onDone={(text, nextTab) => {
          setToast(text);
          if (nextTab !== undefined) {
            pinned.current = current.groupId;
            setTab(nextTab);
            setSelected(current.groupId);
          }
        }}
        onOpenBooking={() => setBookingOpen(current.groupId)}
        onOpenCalendar={onOpenModule !== undefined ? () => onOpenModule("calendar") : undefined}
      />
    ) : null;

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">Requests</Text>
      {listQuery.isFetching ? <Text style={styles.meta}>Updating…</Text> : null}
    </View>
  );

  const overlays = (
    <>
      <VenueBookingSheet brandId={brandId} venueId={venueId} groupId={bookingOpen} onClose={() => setBookingOpen(null)} />
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-requests-toast" />
        </React.Suspense>
      ) : null}
    </>
  );

  if (!isWideDesktop && detail !== null) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} keyboardShouldPersistTaps="handled" testID="venue-requests-phone-detail">
        {detail}
        {overlays}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} keyboardShouldPersistTaps="handled" testID="venue-requests-module">
      {header}
      <Tabs items={tabs} value={tab} onChange={(next) => setTab(next)} testID="venue-requests-tabs" />
      {isWideDesktop ? (
        <View style={styles.split}>
          <View style={styles.listCol}>{list}</View>
          <View style={styles.detailCol}>
            {detail ?? (
              <GlassCard variant="base" padding={space[5]}>
                <Text style={styles.meta}>Pick a request to see it here.</Text>
              </GlassCard>
            )}
          </View>
        </View>
      ) : (
        list
      )}
      {overlays}
    </ScrollView>
  );
}

// =================================================================== detail

interface DetailProps {
  brandId: string | null;
  venueId: string | null;
  r: VenueRequest;
  all: VenueRequest[];
  timezone: string;
  venueName: string;
  replyHours: number;
  now: number;
  onBack?: () => void;
  onDone: (toast: string, nextTab?: RequestTab) => void;
  onOpenBooking: () => void;
  onOpenCalendar?: () => void;
}

type Dialog =
  | { kind: "approve" }
  | { kind: "quote" }
  | { kind: "decline"; date: string | null; reason: string | null }
  | { kind: "conflict"; code: string; capacity: { sold: number; limitAfterHire: number } | null }
  | { kind: "more_time" }
  | { kind: "release" }
  | null;

function RequestDetail({ brandId, venueId, r, all, timezone, venueName, replyHours, now, onBack, onDone, onOpenBooking, onOpenCalendar }: DetailProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const bookingQuery = useVenueBooking(brandId, venueId, r.groupId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const currencyFallback = useBrandCurrency(brandId);
  const action = useStaffRequestAction(brandId, venueId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [quote, setQuote] = useState<QuoteEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => randomId());
  const b = bookingQuery.data;
  const currency = r.currencyCode || currencyFallback || "NGN";
  const offer = (offersQuery.data?.offers ?? []).find((o) => o.id === b?.offer.id) ?? null;
  const settings = offersQuery.data?.settings ?? null;
  const priceOptionId = b?.lines[0]?.priceOptionId ?? null;
  const today = dateIn(new Date(now).toISOString(), timezone) ?? new Date(now).toISOString().slice(0, 10);
  const freeDates = useNextFreeDates(brandId, venueId, {
    offeringId: r.state === "request_pending" && (r.placeStatus === "held" || r.placeStatus === "taken" || dialog?.kind === "conflict" || dialog?.kind === "decline") ? b?.offer.id ?? null : null,
    priceOptionId,
    from: today,
  });
  const nextFree = (freeDates.data ?? []).find((d) => d.localDate !== r.localDate) ?? null;
  const first = r.guestName.split(" ")[0] ?? r.guestName;
  const canAnswer = access.canManageBookings;
  const canEditPrice = access.canManageMoney && (b?.hire !== null && b?.hire !== undefined);
  const originalBaseMinor = hireBaseMinor(b);

  // The request holding the same space that day (for "next in line" words).
  const blocker = useMemo(() => {
    if (r.queue !== null && r.queue.blockedByGroupId !== null) {
      return { guestName: r.queue.blockedByGuestName, holdUntil: r.queue.blockedByHoldUntil };
    }
    const other = all.find(
      (x) =>
        x.groupId !== r.groupId &&
        x.localDate === r.localDate &&
        (x.state === "approved_payment_required" || x.state === "confirmed") &&
        x.spaceIds.some((s) => r.spaceIds.includes(s)),
    );
    return other === undefined ? null : { guestName: other.guestName, holdUntil: other.holdUntil };
  }, [all, r]);

  const preview =
    b !== undefined && b.hire !== null && originalBaseMinor !== null
      ? quotePreview({
          totalDueMinor: b.totalDueMinor,
          hireMinor: originalBaseMinor,
          newHireMinor: quote?.baseMinor ?? originalBaseMinor,
          taxMinor: b.taxMinor,
          vatMode: b.vatMode,
          vatRateBps: settings?.vatRateBps ?? null,
          damageDepositMinor: b.hire.damageDepositMinor,
          // Inside the balance window the server asks for everything (no deposit on the request).
          deposit: b.depositMinor === null ? null : offer?.deposit ?? null,
        })
      : null;

  const run = (input: Parameters<typeof action.mutate>[0], done: { toast: string; tab?: RequestTab }): void => {
    setError(null);
    action.mutate(
      { ...input, idempotencyKey: attemptKey },
      {
        onSuccess: (res) => {
          setDialog(null);
          setAttemptKey(randomId());
          if (input.action === "approve") {
            const total = res.totalDueMinor !== null ? money(res.totalDueMinor, currency) : null;
            const dep = res.depositMinor !== null ? money(res.depositMinor, currency) : null;
            onDone(
              `Quote sent to ${first}${total !== null ? ` · ${total}` : ""}${dep !== null ? `, ${dep} to pay` : ""}. ${holdWords(res.holdUntil, timezone) ?? ""}`.trim(),
              "waiting_for_deposit",
            );
            return;
          }
          if (input.action === "queue") {
            onDone(`${first} is next in line${res.position !== null && res.position > 1 ? ` (number ${res.position})` : ""}. We'll tell you when the space frees up.`);
            return;
          }
          onDone(done.toast, done.tab);
        },
        onError: (e) => {
          const code = e instanceof VenueStaffError ? e.code : "staff_action_failed";
          setAttemptKey(randomId());
          if (input.action === "approve" && (code === "offer_space_taken" || code === "offer_capacity_conflict")) {
            setDialog({ kind: "conflict", code, capacity: e instanceof VenueStaffError && e.capacity !== null ? e.capacity : null });
            return;
          }
          if (code === "stale_write" || code === "offer_invalid_transition" || code === "offer_hold_expired") {
            void bookingQuery.refetch();
          }
          setError(staffErrorCopy(code));
        },
      },
    );
  };

  const pill = requestPill(r, now);
  const place = placeStatusWords(r.placeStatus);
  const asked = agoWords(r.requestedAt, now);
  const hold = holdWords(r.holdUntil, timezone);
  const queued = r.queue !== null && r.queue.releasedAt === null && !r.nextInLine;
  const isPending = r.state === "request_pending";
  const isWaiting = r.state === "approved_payment_required";

  const facts: Array<{ key: string; label: string; value: string; tone?: "ok" | "warn" | "error" }> = [
    { key: "space", label: "Space", value: r.placeName ?? r.offerName },
    { key: "date", label: "Date", value: requestDateLine(r, timezone) },
    { key: "guests", label: "Guests", value: r.guests.toLocaleString("en-GB") },
  ];
  const factLayout = b?.hire?.layout ?? r.layout;
  const factLayoutCapacity = b?.hire?.layoutCapacity ?? r.layoutCapacity;
  if (factLayout !== null && factLayoutCapacity !== null) {
    facts.push({ key: "layout", label: "Layout", value: venueLayoutSummary(factLayout, factLayoutCapacity) });
  }
  if (b?.hire?.setupFrom && b.hire.cleanupUntil) {
    facts.push({
      key: "setup",
      label: "Setup",
      value: `From ${clockIn(b.hire.setupFrom, timezone) ?? "—"} · cleanup until ${clockIn(b.hire.cleanupUntil, timezone) ?? "—"}`,
    });
  }
  if (isPending && place !== null) facts.push({ key: "calendar", label: "Calendar", value: place.label, tone: place.tone });
  if (r.occasion !== null) facts.push({ key: "occasion", label: "Occasion", value: r.occasion });
  if (r.siteVisit) facts.push({ key: "visit", label: "Site visit", value: `${first} would like to see the space first` });
  const contact = [r.guestPhone, r.guestEmail].filter(Boolean).join(" · ");
  if (contact.length > 0) facts.push({ key: "contact", label: "Contact", value: contact });
  facts.push({ key: "ref", label: "Reference", value: shortBookingReference(r.reference) });

  const quoteRows: Array<{ key: string; label: string; value: string; strong?: boolean; muted?: boolean }> = [];
  if (b !== undefined && b.hire !== null && preview !== null) {
    const h = b.hire;
    const base = quote?.baseMinor ?? h.hireMinor;
    // Once approved with an edited price, the server keeps the change on top of the
    // first quote: show the agreed price as one exact line (server total − damage deposit).
    const agreed = !isPending && b.totalDueMinor !== b.totalMinor;
    if (agreed) {
      quoteRows.push({ key: "agreed", label: `${h.placeName ?? "Hire"} · agreed price${b.taxMinor > 0 ? " (with VAT)" : ""}`, value: money(b.totalDueMinor - h.damageDepositMinor, currency) });
      if (h.damageDepositMinor > 0) quoteRows.push({ key: "damage", label: "Refundable damage deposit", value: money(h.damageDepositMinor, currency) });
    }
    if (!agreed && quote !== null) {
      quoteRows.push({ key: "hire", label: "Hire and extras · edited", value: money(base, currency) });
    } else if (!agreed) {
      quoteRows.push({ key: "hire", label: `${h.placeName ?? "Hire"}${h.sessionLabel !== null ? ` · ${h.sessionLabel.toLowerCase()}` : ""}`, value: money(base, currency) });
      if (h.extraGuests > 0) quoteRows.push({ key: "extra", label: `${h.extraGuests} extra guests`, value: money(h.extraGuestMinor, currency) });
      if (h.overtimeHours > 0) quoteRows.push({ key: "over", label: `${h.overtimeHours} hours running over`, value: money(h.overtimeMinor, currency) });
      for (const extra of b.extras) {
        quoteRows.push({ key: `picked-extra-${extra.id}`, label: extra.name, value: money(extra.amountMinor, currency) });
      }
    }
    if (!agreed && preview.vatMinor > 0) quoteRows.push({ key: "vat", label: b.vatMode === "included" ? "Includes VAT" : "VAT", value: money(preview.vatMinor, currency) });
    if (!agreed && h.damageDepositMinor > 0) quoteRows.push({ key: "damage", label: "Refundable damage deposit", value: money(h.damageDepositMinor, currency) });
    quoteRows.push({ key: "total", label: "Total", value: money(isPending ? preview.totalMinor : b.totalDueMinor, currency), strong: true });
    const dep = isPending ? preview.depositMinor : b.depositMinor;
    if (dep !== null && dep < (isPending ? preview.totalMinor : b.totalDueMinor)) {
      quoteRows.push({ key: "deposit", label: "Deposit to hold the date", value: money(dep, currency) });
    }
    if (!isPending && b.paidMinor > 0) quoteRows.push({ key: "paid", label: "Paid", value: money(b.paidMinor, currency), muted: true });
    if (!isPending && b.balanceDueMinor > 0 && r.state === "confirmed") quoteRows.push({ key: "balance", label: "Still to pay", value: money(b.balanceDueMinor, currency), strong: true });
  }

  const closed = r.tab === "closed" ? closedWords(r, replyHours) : null;
  const approve = approveWords({
    guestName: r.guestName,
    placeName: r.placeName,
    localDate: r.localDate,
    totalMinor: preview?.totalMinor ?? r.totalDueMinor,
    depositMinor: preview?.depositMinor ?? r.depositMinor,
    currency,
    payWithinMinutes: offer?.hire?.approvedPaymentMinutes ?? 4320,
  });

  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.detail} testID="venue-request-detail">
      {onBack !== undefined ? (
        <View>
          <Button label="Back to requests" variant="ghost" size="sm" leadingIcon="chevL" onPress={onBack} testID="venue-request-back" />
        </View>
      ) : null}
      <View style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{r.guestName.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.grow}>
          <Text style={styles.whoName} accessibilityRole="header">{r.guestName}</Text>
          <Text style={styles.meta}>{[r.occasion, asked !== null ? `asked ${asked}` : null].filter(Boolean).join(" · ") || r.offerName}</Text>
        </View>
        <Pill variant={pill.variant}>{pill.label}</Pill>
      </View>

      {isWaiting && hold !== null ? (
        <Banner
          tone="warning"
          title={hold}
          body={
            r.waitingBehind > 0 && r.nextInLineGuest !== null
              ? `Then the space frees up and ${r.nextInLineGuest}, next in line, is offered it. ${first} gets a reminder 12 hours before.`
              : `Then the space frees up. ${first} gets a reminder 12 hours before.`
          }
          testID="venue-request-hold"
        />
      ) : null}
      {isPending && queued ? (
        <Banner
          tone="info"
          title={`Next in line${r.queue !== null && r.queue.position > 1 ? ` (number ${r.queue.position})` : ""}`}
          body={
            r.placeStatus === "taken"
              ? `${blocker?.guestName ?? "Someone"} has booked the space that day, so it won't free up by itself. Offer ${first} another date, or decline.`
              : `${blocker?.guestName ?? "Someone"} has the space${blocker?.holdUntil ? ` until ${momentWords(blocker.holdUntil, timezone) ?? ""}` : ""}. If they don't pay, ${first} is offered it and you're told.`
          }
          testID="venue-request-queued"
        />
      ) : null}
      {isPending && r.nextInLine ? (
        <Banner tone="ok" title="The space is free again" body={`The earlier hold ended. Approve ${first} now, or decline.`} testID="venue-request-next" />
      ) : null}
      {isPending && !queued && (r.placeStatus === "held" || r.placeStatus === "taken") ? (
        <Banner
          tone="warning"
          title={r.placeStatus === "held" ? `${r.placeName ?? "The space"} is on hold that day` : `${r.placeName ?? "The space"} is booked that day`}
          body={`${blocker?.guestName ? `${blocker.guestName} has it. ` : ""}${r.placeStatus === "held" ? `Put ${first} next in line, or offer another date.` : `Offer ${first} another date.`}`}
          testID="venue-request-collides"
        />
      ) : null}
      {closed !== null ? <Banner tone={r.closedReason === "needs_checking" ? "warning" : "info"} title={closed.title} body={closed.body} testID="venue-request-closed" /> : null}
      {r.state === "declined" && b?.hire?.alternatives !== undefined && b.hire.alternatives.length > 0 ? (
        <Text style={styles.meta}>Other dates you offered: {b.hire.alternatives.map((d) => shortDay(d)).join(", ")}</Text>
      ) : null}

      <View style={styles.facts} testID="venue-request-facts">
        {facts.map((f) => (
          <View key={f.key} style={styles.factRow}>
            <Text style={styles.factLabel}>{f.label}</Text>
            <Text style={[styles.factValue, f.tone === "ok" ? styles.okText : f.tone === "warn" ? styles.warnText : f.tone === "error" ? styles.errorText : null]}>{f.value}</Text>
          </View>
        ))}
      </View>
      {r.note !== null ? (
        <View style={styles.note} testID="venue-request-note">
          <Text style={styles.noteText}>“{r.note}”</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>{isPending ? "Quote" : "Money"}</Text>
      {bookingQuery.isLoading ? (
        <Skeleton height={96} radius="md" />
      ) : bookingQuery.isError || b === undefined ? (
        <View style={styles.inline}>
          <Text style={[styles.meta, styles.grow]}>Couldn&apos;t load the quote.</Text>
          <Button label="Try again" variant="secondary" size="sm" onPress={() => void bookingQuery.refetch()} />
        </View>
      ) : (
        <View style={styles.quote} testID="venue-request-quote">
          {quoteRows.map((q) => (
            <View key={q.key} style={[styles.quoteRow, q.strong ? styles.quoteStrong : null]}>
              <Text style={[styles.quoteLabel, q.muted ? styles.mutedText : null]}>{q.label}</Text>
              <Text style={[styles.quoteValue, q.strong ? styles.quoteValueStrong : null]}>{q.value}</Text>
            </View>
          ))}
          {quote !== null ? (
            <Text style={styles.meta} testID="venue-request-quote-edited">
              You changed the price{quote.note.trim().length > 0 ? " and added a note" : ""}. {first} sees this when you approve.
            </Text>
          ) : null}
          {b.policyText !== null ? <Text style={styles.meta}>Terms saved on this request: {b.policyText}</Text> : null}
        </View>
      )}

      {error !== null ? (
        <Text style={styles.errorLine} accessibilityLiveRegion="polite" testID="venue-request-error">
          {error}
        </Text>
      ) : null}

      {!canAnswer && (isPending || isWaiting) ? (
        <Text style={styles.meta}>Only people who run bookings at this venue can answer requests.</Text>
      ) : null}

      {isPending && canAnswer ? (
        <View style={styles.actions}>
          <Button
            label="Decline"
            variant="secondary"
            size="md"
            onPress={() => setDialog({ kind: "decline", date: null, reason: null })}
            disabled={action.isPending}
            testID="venue-request-decline"
          />
          {canEditPrice ? (
            <Button label="Edit quote" variant="secondary" size="md" onPress={() => setDialog({ kind: "quote" })} disabled={action.isPending || b === undefined} testID="venue-request-edit-quote" />
          ) : null}
          <View style={styles.grow} />
          {queued ? (
            <Button
              label={nextFree !== null ? `Offer ${shortDay(nextFree.localDate)}` : "Offer another date"}
              variant="primary"
              size="md"
              onPress={() =>
                setDialog({
                  kind: "decline",
                  date: nextFree?.localDate ?? null,
                  reason: `${r.placeName ?? "The space"} is booked that day.`,
                })
              }
              testID="venue-request-offer-date"
            />
          ) : (
            <Button
              label="Approve and send"
              variant="primary"
              size="md"
              onPress={() => setDialog({ kind: "approve" })}
              disabled={action.isPending || b === undefined}
              loading={action.isPending && dialog === null}
              testID="venue-request-approve"
            />
          )}
        </View>
      ) : null}
      {isPending && canAnswer && !queued && r.placeStatus === "held" ? (
        <View style={styles.inline}>
          <Button
            label={`Put ${first} next in line`}
            variant="secondary"
            size="md"
            onPress={() => run({ action: "queue", groupId: r.groupId, expectedVersion: b?.version ?? r.version }, { toast: "" })}
            loading={action.isPending}
            testID="venue-request-queue"
          />
        </View>
      ) : null}

      {isWaiting && canAnswer ? (
        <View style={styles.actions}>
          <Button label="Release the hold" variant="ghost" size="md" onPress={() => setDialog({ kind: "release" })} disabled={action.isPending} testID="venue-request-release" />
          <View style={styles.grow} />
          <Button label="Give more time" variant="secondary" size="md" onPress={() => setDialog({ kind: "more_time" })} disabled={action.isPending} testID="venue-request-more-time" />
        </View>
      ) : null}

      {r.tab === "confirmed" ? (
        <View style={styles.actions}>
          <View style={styles.grow} />
          <Button label="Open booking" variant="primary" size="md" onPress={onOpenBooking} testID="venue-request-open-booking" />
        </View>
      ) : null}
      {r.tab === "closed" || r.tab === "confirmed" ? (
        <View style={styles.actions}>
          {r.guestEmail !== null ? (
            <Button
              label={`Email ${first}`}
              variant="secondary"
              size="md"
              leadingIcon="mail"
              onPress={() => void Linking.openURL(`mailto:${r.guestEmail}?subject=${encodeURIComponent(`${venueName}: your request ${shortBookingReference(r.reference)}`)}`).catch(() => setError("Couldn't open your email app."))}
              testID="venue-request-email"
            />
          ) : null}
          {r.guestPhone !== null ? (
            <Button
              label={`Call ${first}`}
              variant="ghost"
              size="md"
              leadingIcon="phone"
              onPress={() => void Linking.openURL(`tel:${r.guestPhone}`).catch(() => setError("Couldn't start a call on this device."))}
              testID="venue-request-call"
            />
          ) : null}
        </View>
      ) : null}
      {onOpenCalendar !== undefined && r.tab !== "closed" ? (
        <View>
          <Button label="See it on the calendar" variant="secondary" size="sm" leadingIcon="calendar" onPress={onOpenCalendar} testID="venue-request-calendar" />
        </View>
      ) : null}

      {/* ------------------------------------------------------- dialogs */}
      {dialog?.kind === "approve" ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            title={approve.title}
            description={approve.body}
            confirmLabel="Send quote"
            cancelLabel="Not yet"
            confirmLoading={action.isPending}
            errorMessage={error}
            onClose={() => {
              setDialog(null);
              setError(null);
            }}
            onConfirm={() =>
              run(
                {
                  action: "approve",
                  groupId: r.groupId,
                  expectedVersion: b?.version ?? r.version,
                  quoteEdit: quote !== null && originalBaseMinor !== null && quote.baseMinor !== originalBaseMinor ? { baseMinor: quote.baseMinor, note: quote.note } : null,
                  note: quote !== null && quote.note.trim().length > 0 ? quote.note : null,
                },
                { toast: "" },
              )
            }
            testID="venue-request-approve-dialog"
          />
        </React.Suspense>
      ) : null}
      {dialog?.kind === "release" ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            title={`Release ${first}'s hold?`}
            description={`${r.placeName ?? "The space"} becomes free for ${shortDay(r.localDate)}. ${first} is told and can't pay any more. ${r.waitingBehind > 0 && r.nextInLineGuest !== null ? `${r.nextInLineGuest}, next in line, is offered it.` : ""}`.trim()}
            confirmLabel="Release the hold"
            cancelLabel="Keep holding"
            destructive
            confirmLoading={action.isPending}
            errorMessage={error}
            onClose={() => {
              setDialog(null);
              setError(null);
            }}
            onConfirm={() => run({ action: "release_hold", groupId: r.groupId, expectedVersion: b?.version ?? r.version }, { toast: `Hold released. ${first} was told.`, tab: "closed" })}
            testID="venue-request-release-dialog"
          />
        </React.Suspense>
      ) : null}
      <MoreTimeModal
        visible={dialog?.kind === "more_time"}
        first={first}
        hold={hold}
        busy={action.isPending}
        error={error}
        onClose={() => {
          setDialog(null);
          setError(null);
        }}
        onConfirm={(hours) =>
          run({ action: "extend_hold", groupId: r.groupId, expectedVersion: b?.version ?? r.version, hours }, { toast: `${first} has ${hours} more hours to pay.` })
        }
      />
      <QuoteSheet
        visible={dialog?.kind === "quote"}
        wide={isWideDesktop}
        first={first}
        booking={b ?? null}
        initial={quote}
        currency={currency}
        vatRateBps={settings?.vatRateBps ?? null}
        deposit={b?.depositMinor === null ? null : offer?.deposit ?? null}
        onClose={() => setDialog(null)}
        onSave={(next) => {
          setQuote(next);
          setDialog(null);
        }}
      />
      <DeclineModal
        visible={dialog?.kind === "decline"}
        first={first}
        today={today}
        initialDate={dialog?.kind === "decline" ? dialog.date : null}
        initialReason={dialog?.kind === "decline" ? dialog.reason : null}
        busy={action.isPending}
        error={error}
        onClose={() => {
          setDialog(null);
          setError(null);
        }}
        onConfirm={(reason, dates) =>
          run(
            { action: "decline", groupId: r.groupId, expectedVersion: b?.version ?? r.version, reason, alternatives: dates },
            { toast: `Declined. ${first} was told${dates.length > 0 ? " and offered other dates" : ""}.`, tab: "closed" },
          )
        }
      />
      <ConflictModal
        visible={dialog?.kind === "conflict"}
        words={
          dialog?.kind === "conflict"
            ? conflictWords({
                code: dialog.code,
                placeName: r.placeName,
                localDate: r.localDate,
                guestName: r.guestName,
                blocker,
                capacity: dialog.capacity,
                timezone,
              })
            : { title: "", body: "" }
        }
        canQueue={dialog?.kind === "conflict" && dialog.code === "offer_space_taken"}
        first={first}
        nextFreeLabel={nextFree !== null ? `${shortDay(nextFree.localDate)}${nextFree.sessionLabel !== null ? ` · ${nextFree.sessionLabel}` : ""}` : null}
        busy={action.isPending}
        error={error}
        onClose={() => {
          setDialog(null);
          setError(null);
        }}
        onQueue={() => run({ action: "queue", groupId: r.groupId, expectedVersion: b?.version ?? r.version }, { toast: "" })}
        onOffer={() =>
          setDialog({
            kind: "decline",
            date: nextFree?.localDate ?? null,
            reason: `${r.placeName ?? "The space"} is booked that day.`,
          })
        }
      />
    </GlassCard>
  );
}

// =================================================================== dialogs

function QuoteSheet({
  visible,
  wide,
  first,
  booking,
  initial,
  currency,
  vatRateBps,
  deposit,
  onClose,
  onSave,
}: {
  visible: boolean;
  wide: boolean;
  first: string;
  booking: VenueBookingDetail | null;
  initial: QuoteEdit | null;
  currency: string;
  vatRateBps: number | null;
  deposit: { kind: "none" | "percent" | "fixed"; value: number | null } | null;
  onClose: () => void;
  onSave: (q: QuoteEdit) => void;
}): React.ReactElement {
  const hire = booking?.hire ?? null;
  const originalBaseMinor = hireBaseMinor(booking);
  const [base, setBase] = useState<number | null>(initial?.baseMinor ?? originalBaseMinor);
  const [note, setNote] = useState(initial?.note ?? "");
  useEffect(() => {
    if (!visible) return;
    setBase(initial?.baseMinor ?? originalBaseMinor);
    setNote(initial?.note ?? "");
  }, [visible, initial, originalBaseMinor]);
  const p =
    booking !== null && hire !== null && originalBaseMinor !== null
      ? quotePreview({
          totalDueMinor: booking.totalDueMinor,
          hireMinor: originalBaseMinor,
          newHireMinor: base ?? originalBaseMinor,
          taxMinor: booking.taxMinor,
          vatMode: booking.vatMode,
          vatRateBps,
          damageDepositMinor: hire.damageDepositMinor,
          deposit,
        })
      : null;
  const invalid = base === null || base < 0;
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.85} presentation={wide ? "panel" : undefined} testID="venue-request-quote-sheet">
      <PickerSheetHead title={`Quote for ${first}`} onClose={onClose} plain={wide} />
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        <MoneyField
          label="Hire and extras"
          valueMinor={base}
          onChangeMinor={setBase}
          currency={currency}
          error={invalid ? "Enter the price" : null}
          testID="venue-request-quote-price"
        />
        {booking !== null && booking.extras.length > 0 ? (
          <View style={styles.field} testID="venue-request-quote-included-extras">
            <Text style={styles.fieldLabel}>Included in this amount</Text>
            {booking.extras.map((extra) => (
              <Text key={extra.id} style={styles.meta}>{`Includes ${extra.name} · ${money(extra.amountMinor, currency)}`}</Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.meta}>Lower it to take money off, or raise it to cover anything you add (food, drinks, staff).</Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Note to {first}</Text>
          <Input
            value={note}
            onChangeText={(v) => setNote(v.slice(0, 500))}
            placeholder="e.g. Yes, we have two wireless mics. The stage is yours from 6:30."
            accessibilityLabel={`Note to ${first}`}
            testID="venue-request-quote-note"
          />
          <Text style={styles.meta}>{500 - note.length} characters left. {first} sees it with the quote.</Text>
        </View>
        {p !== null && hire !== null ? (
          <View style={styles.quote}>
            {p.vatMinor > 0 ? (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>{booking?.vatMode === "included" ? "Includes VAT" : "VAT"}</Text>
                <Text style={styles.quoteValue}>{money(p.vatMinor, currency)}</Text>
              </View>
            ) : null}
            {hire.damageDepositMinor > 0 ? (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Refundable damage deposit</Text>
                <Text style={styles.quoteValue}>{money(hire.damageDepositMinor, currency)}</Text>
              </View>
            ) : null}
            <View style={[styles.quoteRow, styles.quoteStrong]}>
              <Text style={styles.quoteLabel}>Total</Text>
              <Text style={[styles.quoteValue, styles.quoteValueStrong]}>{money(p.totalMinor, currency)}</Text>
            </View>
            {p.depositMinor !== null ? (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Deposit to hold the date</Text>
                <Text style={styles.quoteValue}>{money(p.depositMinor, currency)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Button label="Cancel" variant="secondary" size="md" onPress={onClose} testID="venue-request-quote-cancel" />
        <Button
          label="Save quote"
          variant="primary"
          size="md"
          onPress={() => {
            if (base === null) return;
            onSave({ baseMinor: base, note });
          }}
          disabled={invalid}
          testID="venue-request-quote-save"
        />
      </View>
    </Sheet>
  );
}

function DeclineModal({
  visible,
  first,
  today,
  initialDate,
  initialReason,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  first: string;
  today: string;
  initialDate: string | null;
  initialReason: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string, dates: string[]) => void;
}): React.ReactElement {
  const [reason, setReason] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setReason(initialReason ?? "");
    setDates(initialDate !== null ? [initialDate] : []);
    setTouched(false);
  }, [visible, initialDate, initialReason]);
  const reasonIssue = reason.trim().length < 3 ? "Say why, in a few words. The guest sees it." : null;
  const clean = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return (
    <Modal visible={visible} onClose={onClose} maxWidth={560} testID="venue-request-decline-modal">
      <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle} accessibilityRole="header">Decline {first}&apos;s request</Text>
          <IconChrome icon="close" size={36} accessibilityLabel="Close" onPress={onClose} testID="venue-request-decline-close" />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Why</Text>
          <Input
            value={reason}
            onChangeText={(v) => setReason(v.slice(0, 500))}
            placeholder="e.g. We have a wedding in the whole park that day"
            accessibilityLabel="Why you're declining"
            error={touched && reasonIssue !== null ? reasonIssue : null}
            testID="venue-request-decline-reason"
          />
        </View>
        <Text style={styles.fieldLabel}>Offer other dates (up to 3)</Text>
        {dates.map((d, i) => (
          <View key={`alt-${i}`} style={styles.inline}>
            <View style={styles.grow}>
              <DayDateField
                label={`Date ${i + 1}`}
                value={d}
                onChangeValue={(v) => setDates(dates.map((x, j) => (j === i ? v : x)))}
                accessibilityLabel={`Other date ${i + 1}`}
                min={today}
                today={today}
                testID={`venue-request-decline-date-${i}`}
              />
            </View>
            <Button label="Remove" variant="ghost" size="sm" onPress={() => setDates(dates.filter((_, j) => j !== i))} accessibilityLabel={`Remove date ${i + 1}`} />
          </View>
        ))}
        {dates.length < 3 ? (
          <View>
            <Button label="Add a date" variant="secondary" size="sm" leadingIcon="plus" onPress={() => setDates([...dates, ""])} testID="venue-request-decline-add-date" />
          </View>
        ) : null}
        <Text style={styles.meta}>{first} is told by email, with your reason{clean.length > 0 ? " and the dates" : ""}. Nothing was charged.</Text>
        {error !== null ? <Text style={styles.errorLine}>{error}</Text> : null}
        <View style={styles.sheetFooterInline}>
          <Button label="Keep the request" variant="secondary" size="md" onPress={onClose} disabled={busy} />
          <Button
            label={`Decline and tell ${first}`}
            variant="destructive"
            size="md"
            onPress={() => {
              setTouched(true);
              if (reasonIssue !== null) return;
              onConfirm(reason.trim(), clean);
            }}
            loading={busy}
            testID="venue-request-decline-confirm"
          />
        </View>
      </ScrollView>
    </Modal>
  );
}

function MoreTimeModal({
  visible,
  first,
  hold,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  first: string;
  hold: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (hours: 12 | 24 | 48) => void;
}): React.ReactElement {
  const [hours, setHours] = useState<"12" | "24" | "48">("24");
  return (
    <Modal visible={visible} onClose={onClose} maxWidth={480} testID="venue-request-more-time-modal">
      <View style={styles.modalBody}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle} accessibilityRole="header">Give {first} more time</Text>
          <IconChrome icon="close" size={36} accessibilityLabel="Close" onPress={onClose} />
        </View>
        {hold !== null ? <Text style={styles.meta}>{hold} now.</Text> : null}
        <Segmented
          options={[
            { key: "12", label: "12 hours" },
            { key: "24", label: "24 hours" },
            { key: "48", label: "48 hours" },
          ]}
          value={hours}
          onChange={setHours}
          accessibilityLabel="More time"
          testID="venue-request-more-time-hours"
        />
        <Text style={styles.meta}>The hold can&apos;t run past the start of the hire. {first} is emailed the new time.</Text>
        {error !== null ? <Text style={styles.errorLine}>{error}</Text> : null}
        <View style={styles.sheetFooterInline}>
          <Button label="Cancel" variant="secondary" size="md" onPress={onClose} disabled={busy} />
          <Button label={`Give ${hours} more hours`} variant="primary" size="md" onPress={() => onConfirm(Number(hours) as 12 | 24 | 48)} loading={busy} testID="venue-request-more-time-confirm" />
        </View>
      </View>
    </Modal>
  );
}

function ConflictModal({
  visible,
  words,
  canQueue,
  first,
  nextFreeLabel,
  busy,
  error,
  onClose,
  onQueue,
  onOffer,
}: {
  visible: boolean;
  words: { title: string; body: string };
  canQueue: boolean;
  first: string;
  nextFreeLabel: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onQueue: () => void;
  onOffer: () => void;
}): React.ReactElement {
  return (
    <Modal visible={visible} onClose={onClose} maxWidth={480} testID="venue-request-conflict">
      <View style={styles.modalBody}>
        <View style={styles.modalHead}>
          <View style={styles.inlineIcon}>
            <Icon name="shield" size={20} color={color.warning} />
            <Text style={styles.modalTitle} accessibilityRole="header">{words.title}</Text>
          </View>
          <IconChrome icon="close" size={36} accessibilityLabel="Close" onPress={onClose} />
        </View>
        <Text style={styles.body}>{words.body}</Text>
        {error !== null ? <Text style={styles.errorLine}>{error}</Text> : null}
        <View style={styles.sheetFooterInline}>
          <Button
            label={nextFreeLabel !== null ? `Offer ${first} ${nextFreeLabel}` : `Offer ${first} another date`}
            variant={canQueue ? "secondary" : "primary"}
            size="md"
            onPress={onOffer}
            disabled={busy}
            testID="venue-request-conflict-offer"
          />
          {canQueue ? (
            <Button label={`Put ${first} next in line`} variant="primary" size="md" onPress={onQueue} loading={busy} testID="venue-request-conflict-queue" />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.caption, color: color.text3 },
  body: { ...type.body, color: color.text2 },
  grow: { flex: 1, minWidth: 0 },
  split: { flexDirection: "row", alignItems: "flex-start", gap: space[4] },
  listCol: { flex: 1, minWidth: 0 },
  detailCol: { flex: 1.35, minWidth: 0 },
  listCard: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 72 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  rowActive: { backgroundColor: color.fill.pressed },
  pressed: { backgroundColor: color.fill.pressed },
  iconTile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  detail: { gap: space[3] },
  who: { flexDirection: "row", alignItems: "center", gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  avatarText: { ...type.row, color: color.text1 },
  whoName: { ...type.h2, color: color.text1 },
  facts: { gap: space[2] },
  factRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  factLabel: { ...type.small, color: color.text2, width: 110 },
  fieldLabel: { ...type.small, color: color.text2 },
  factValue: { ...type.small, color: color.text1, flex: 1, minWidth: 160 },
  okText: { color: color.successText },
  warnText: { color: color.warningText },
  errorText: { color: color.errorText },
  mutedText: { color: color.text3 },
  note: { padding: space[3], borderRadius: radius.md, backgroundColor: color.fill.inset },
  noteText: { ...type.small, color: color.text2 },
  sectionLabel: { ...type.label, color: color.text3, marginTop: space[2] },
  quote: { gap: space[2] },
  quoteRow: { flexDirection: "row", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  quoteStrong: { borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[2] },
  quoteLabel: { ...type.small, color: color.text2, flex: 1, minWidth: 140 },
  quoteValue: { ...type.small, color: color.text1, fontVariant: ["tabular-nums"] },
  quoteValueStrong: { fontWeight: "700" },
  errorLine: { ...type.small, color: color.errorText },
  actions: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  inline: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  inlineIcon: { flexDirection: "row", alignItems: "center", gap: space[2], flex: 1, minWidth: 0 },
  field: { gap: space[1] },
  sheetScroll: { flex: 1 },
  sheetBody: { gap: space[3], padding: space[4], paddingBottom: space[6] },
  sheetFooter: { flexDirection: "row", justifyContent: "flex-end", gap: space[2], padding: space[4], borderTopWidth: 1, borderTopColor: color.line },
  sheetFooterInline: { flexDirection: "row", justifyContent: "flex-end", gap: space[2], flexWrap: "wrap", marginTop: space[2] },
  modalScroll: { maxHeight: 640 },
  modalBody: { gap: space[3], padding: space[5] },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  modalTitle: { ...type.h2, color: color.text1, flex: 1 },
});
