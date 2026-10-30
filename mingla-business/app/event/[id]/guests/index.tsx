/**
 * /event/[id]/guests — J-G1 Guest list view (Cycle 10).
 *
 * Operator-side merged list of orders (sales AND guest-list tickets) + door
 * sales for the event. Buyer-as-attendee model (1 OrderRecord = 1 row, qty =
 * summed lines). issue #3827: guest-list guests are real server orders
 * (source = comp) with a GUEST LIST pill, and every check-in pill comes from
 * the server's tickets, so every door phone agrees.
 *
 * Chrome: search toggle + CSV export + "Add to guest list" "+".
 *
 * I-21: This is operator-side route. Uses useAuth via parent flow.
 *
 * Per Cycle 10 SPEC §5/J-G1.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import { useGuestStore } from "../../../../src/store/guestStore";
import type { OrderRecord } from "../../../../src/store/orderStore";
import { isCompOrder } from "../../../../src/utils/compOrders";
import {
  addTicketTypeForLinkRoute,
  isTicketLinkable,
  type NewTicketPreset,
} from "../../../../src/utils/ticketLinkEligibility";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../src/utils/permissionGates";
import type {
  DoorPaymentMethod,
  DoorSaleRecord,
} from "../../../../src/types/doorSales";
import { useManagedEventRoute } from "../../../../src/hooks/useManagedEventRoute";
import { useGuestRosterAccess } from "../../../../src/hooks/useGuestRoster";
import { useEventGuestList } from "../../../../src/hooks/useEventOrders";
import { useEventDoorSales } from "../../../../src/hooks/useEventDoorSales";
// issue #2160 — the occurrences ride the event payload (same reader that served
// the event, #2161), so the per-day roster needs no extra query.
import { usePublicEventById } from "../../../../src/hooks/usePublicEvents";
import type { PublicEventOccurrence } from "../../../../src/services/publicEventOccurrencesService";
import { formatOccurrenceDayLabel } from "../../../../src/utils/eventDateDisplay";
import {
  dayHeadCount,
  orderMatchesDay,
} from "../../../../src/utils/guestDayFilter";
import {
  capitalizeNoun,
  offeringKindConfig,
  offeringKindFromEventType,
} from "../../../../src/components/offering/offeringKind";
import { useAuth } from "../../../../src/context/AuthContext";
import {
  createGuestRosterRequestId,
  getGuestRosterExport,
  requestGuestRosterExport,
} from "../../../../src/services/guestRosterService";
import type {
  GuestRosterFilter,
  GuestRosterSort,
} from "../../../../src/types/guestRoster";

import {
  AddCompGuestSheet,
  type AddCompGuestSuccess,
  type LegacyCompPrefill,
} from "../../../../src/components/guests/AddCompGuestSheet";
import { Button } from "../../../../src/components/ui/Button";
import { GuestRosterExperience } from "../../../../src/components/guests/GuestRosterExperience";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Input } from "../../../../src/components/ui/Input";
import { Pill } from "../../../../src/components/ui/Pill";
import { Toast } from "../../../../src/components/ui/Toast";

// Issue #3827 — the link manager and its service load only after the host taps
// Private links, preserving the business-web common chunk ceiling.
// issue #3827 — the add-a-ticket-type round trip from New link's empty state.
const LazyAddTicketTypeForLinkTrip = React.lazy(() =>
  import("../../../../src/components/guests/AddTicketTypeForLinkTrip").then((module) => ({
    default: module.AddTicketTypeForLinkTrip,
  }))
);
const LazyTicketLinksSheet = React.lazy(() =>
  import("../../../../src/components/guests/TicketLinksSheet").then((module) => ({
    default: module.TicketLinksSheet,
  }))
);
// issue #3281 PR8 / S24 — >7-date Day selector (month-grouped) stays out of
// the web __common boot chunk until a multi-date roster needs it.
const LazyGuestDaySelector = React.lazy(() =>
  import("../../../../src/components/guests/GuestDaySelector").then((module) => ({
    default: module.GuestDaySelector,
  }))
);

// ---- Merged-row types ----------------------------------------------

type GuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  // Cycle 12 — door sale rows (auto-checked-in by Decision #5).
  | { kind: "door"; id: string; sale: DoorSaleRecord; sortKey: string };

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const summarizeOrderTickets = (lines: OrderRecord["lines"]): string => {
  if (lines.length === 0) return "—";
  if (lines.length === 1) {
    const line = lines[0];
    return `${line.quantity}× ${line.ticketNameAtPurchase}`;
  }
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  return `${totalQty} tickets`;
};

const orderQty = (lines: OrderRecord["lines"]): number =>
  lines.reduce((s, l) => s + l.quantity, 0);

const matchesSearch = (row: GuestRow, q: string): boolean => {
  if (q.trim().length === 0) return true;
  const lower = q.trim().toLowerCase();
  if (row.kind === "order") {
    const o = row.order;
    return (
      o.buyer.name.toLowerCase().includes(lower) ||
      o.buyer.email.toLowerCase().includes(lower) ||
      o.buyer.phone.toLowerCase().includes(lower)
    );
  }
  // Cycle 12 — door sale predicate. Walk-up sales with empty buyerName
  // still match search "walk" so operators can find them.
  const s = row.sale;
  const haystack =
    s.buyerName.length > 0 ? s.buyerName : "Walk-up";
  return (
    haystack.toLowerCase().includes(lower) ||
    s.buyerEmail.toLowerCase().includes(lower) ||
    s.buyerPhone.toLowerCase().includes(lower)
  );
};

interface OrderStatusPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const orderStatusPill = (order: OrderRecord): OrderStatusPillSpec => {
  const status = order.status;
  // issue #3827 — a guest-list ticket is never "PAID".
  if (isCompOrder(order)) {
    return status === "cancelled"
      ? { variant: "draft", label: "CANCELLED" }
      : { variant: "accent", label: "GUEST LIST" };
  }
  switch (status) {
    case "paid":
      return { variant: "info", label: "PAID" };
    case "refunded_full":
      return { variant: "warn", label: "REFUNDED" };
    case "refunded_partial":
      return { variant: "accent", label: "PARTIAL" };
    case "cancelled":
      return { variant: "draft", label: "CANCELLED" };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

// Cycle 12 — door sale payment + status pill (composed from method + status).
const doorPaymentPill = (
  method: DoorPaymentMethod,
  status: DoorSaleRecord["status"],
): OrderStatusPillSpec => {
  if (status === "refunded_full") return { variant: "warn", label: "REFUNDED" };
  if (status === "refunded_partial") {
    return { variant: "accent", label: "PARTIAL" };
  }
  switch (method) {
    case "cash":
      return { variant: "info", label: "CASH" };
    case "card_reader":
      return { variant: "info", label: "CARD" };
    case "nfc":
      return { variant: "info", label: "NFC" };
    case "manual":
      return { variant: "draft", label: "MANUAL" };
    default: {
      const _exhaust: never = method;
      return _exhaust;
    }
  }
};

const summarizeDoorTickets = (lines: DoorSaleRecord["lines"]): string => {
  if (lines.length === 0) return "—";
  if (lines.length === 1) {
    const l = lines[0];
    return `${l.quantity}× ${l.ticketNameAtSale}`;
  }
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  return `${total} tickets`;
};

// issue #2160 — stable empty reference so a single-date roster never produces
// a new array identity per render.
const EMPTY_OCCURRENCES: readonly PublicEventOccurrence[] = [];

export default function EventGuestsListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { isAuthReady, user } = useAuth();

  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );
  const event = routeEvent.event;
  const brand = routeEvent.brand;
  const guestRosterAccess = useGuestRosterAccess(typeof eventId === "string" ? eventId : null);

  // META-ORCH-1059 — kind-aware copy lens. This "Guests" screen is shared with
  // trips + experiences. Read the per-kind headcount metric from the loaded
  // row's event_type. EVENTS keep the established "Guests" wording (this screen
  // predates the offeringKind config, whose event metricPlural is "attendees");
  // trips/experiences read "Travelers"/"Spots". Singular/plural via count.
  const offeringKind = offeringKindFromEventType(event?.event_type);
  const kindCfg = offeringKindConfig(offeringKind);
  // Headcount label: event → "Guests"/"guests" (unchanged); trip → "Travelers";
  // experience → "Spots". Capitalized form for the chrome title + empty-state
  // headings, lowercase plural for inline sentences.
  const headcountPlural =
    offeringKind === "event" ? "guests" : kindCfg.metricPlural;
  const headcountSingular =
    offeringKind === "event" ? "guest" : kindCfg.metricSingular;
  const headcountPluralCap = capitalizeNoun(headcountPlural);
  const headcountLabelForCount = useCallback(
    (count: number): string => (count === 1 ? headcountSingular : headcountPlural),
    [headcountSingular, headcountPlural],
  );

  // Raw subscriptions — merge in useMemo to maintain stable refs.
  const allOrderEntriesRead = useEventGuestList(typeof eventId === "string" ? eventId : null);
  const allOrderEntries = allOrderEntriesRead.data ?? [];
  // issue #3827 — legacy device-only comps, READ ONLY, to offer Re-add.
  const legacyCompEntries = useGuestStore((s) => s.entries);
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canAddGuests = canPerformAction(currentRank, "ADD_COMP_GUEST");
  const canManageTicketLinks = canPerformAction(currentRank, "MANAGE_TICKET_LINKS");
  // Door-sale orders share server truth across every scanner device.
  const doorSalesRead = useEventDoorSales(
    typeof eventId === "string" ? eventId : null,
  );
  const allDoorEntries = doorSalesRead.data ?? [];

  // issue #2160 — the event payload, for its occurrences. Same query key the
  // rest of the app already uses, so this is a cache hit in practice.
  const publicEventQuery = usePublicEventById(
    typeof eventId === "string" ? eventId : null,
  );

  const merged = useMemo<GuestRow[]>(() => {
    if (typeof eventId !== "string") return [];
    const orders = allOrderEntries
      .filter((o) => o.eventId === eventId)
      .map<GuestRow>((o) => ({
        kind: "order",
        id: o.id,
        order: o,
        sortKey: o.paidAt,
      }));
    const doorRows = allDoorEntries
      .filter((s) => s.eventId === eventId)
      .map<GuestRow>((s) => ({
        kind: "door",
        id: s.id,
        sale: s,
        sortKey: s.recordedAt,
      }));
    return [...orders, ...doorRows].sort(
      (a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime(),
    );
  }, [allOrderEntries, allDoorEntries, eventId]);

  // issue #3827 — "Ada +2": a named plus-one's own order points at the guest
  // they came with; the guest's row counts them.
  const plusOneCountByLead = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const order of allOrderEntries) {
      if (order.partyLeadOrderId === null || order.partyLeadOrderId === undefined) continue;
      if (order.status === "cancelled") continue;
      map.set(order.partyLeadOrderId, (map.get(order.partyLeadOrderId) ?? 0) + 1);
    }
    return map;
  }, [allOrderEntries]);

  const legacyComps = useMemo(
    () => (typeof eventId === "string" ? legacyCompEntries.filter((c) => c.eventId === eventId) : []),
    [legacyCompEntries, eventId],
  );
  const [addPrefill, setAddPrefill] = useState<LegacyCompPrefill[] | undefined>(undefined);

  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [addSheetOpen, setAddSheetOpen] = useState<boolean>(false);
  const [linksSheetOpen, setLinksSheetOpen] = useState<boolean>(false);
  // issue #3827 — the link sheet's empty state sends the host to add a ticket
  // type. The sheet closes first (a native Modal would otherwise sit over the
  // editor); on return it reopens on New link with the new type selected.
  const [linksReturn, setLinksReturn] = useState<{ ticketTypeId: string | null } | null>(null);
  const [linkTicketTrip, setLinkTicketTrip] = useState<{
    route: string;
    knownIds: ReadonlySet<string>;
  } | null>(null);
  const openAddSheet = useCallback((prefill?: LegacyCompPrefill[]): void => {
    setAddPrefill(prefill);
    setAddSheetOpen(true);
  }, []);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const pendingRosterExportJob = useRef<string | null>(null);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ══ issue #2160 — THE PER-DAY ROSTER ═════════════════════════════════════
  // An organiser running a two-day exhibition needs to know who is coming on
  // EACH day; a combined list is the thing they already had.
  //
  // The occurrences ride the event payload from the same SECURITY DEFINER
  // reader that served the event (#2161), so an UNLISTED event's roster gets
  // its days exactly like a public one's and this screen issues no extra query.
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [dayFilterSeeded, setDayFilterSeeded] = useState(false);
  const occurrences = publicEventQuery.data?.occurrences ?? EMPTY_OCCURRENCES;
  // Only a REAL multi-day event gets a chip row. A single-date event renders
  // exactly today's screen — no chips, no new column header, nothing.
  const hasDayChips = occurrences.length > 1;
  // issue #3281 PR8 — above 7 dates, default the Day selector to the next upcoming.
  useEffect(() => {
    if (dayFilterSeeded || occurrences.length <= 7) return;
    const now = Date.now();
    const next = occurrences.find((o) => Date.parse(o.endAt) > now) ?? occurrences[0];
    if (next !== undefined) {
      setDayFilter(next.id);
      setDayFilterSeeded(true);
    }
  }, [occurrences, dayFilterSeeded]);
  const dayLabels = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const occ of occurrences) {
      const label = formatOccurrenceDayLabel(occ.startAt, occ.timezone);
      // Never fabricate a day: an unparseable occurrence simply has no chip.
      if (label !== null) map.set(occ.id, label);
    }
    return map;
  }, [occurrences]);

  // The rule itself lives in `src/utils/guestDayFilter.ts` so it can be called
  // by a test with real rows instead of asserted by regex over this screen.
  // Door sales carry no chosen day and are equally admissible on any day, so
  // they show under every chip. Guest-list orders carry their day like sales.
  const rowMatchesDay = useCallback(
    (row: GuestRow, dayId: string): boolean =>
      row.kind !== "order" || orderMatchesDay(row.order.ticketDays, dayId),
    [],
  );

  const dayHeadCounts = useMemo<Map<string, number>>(() => {
    const orders = merged
      .filter((r) => r.kind === "order")
      .map((r) => (r as Extract<GuestRow, { kind: "order" }>).order);
    const counts = new Map<string, number>();
    for (const occ of occurrences) {
      counts.set(occ.id, dayHeadCount(orders, occ.id));
    }
    return counts;
  }, [occurrences, merged]);

  const filtered = useMemo<GuestRow[]>(
    () =>
      merged.filter(
        (r) =>
          matchesSearch(r, search) &&
          (dayFilter === null || rowMatchesDay(r, dayFilter)),
      ),
    [merged, search, dayFilter, rowMatchesDay],
  );


  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleOpenRow = useCallback(
    (row: GuestRow): void => {
      if (typeof eventId !== "string") return;
      const guestId = `${row.kind}-${row.id}`;
      router.push(`/event/${eventId}/guests/${guestId}` as never);
    },
    [router, eventId],
  );

  const handleShareEvent = useCallback((): void => {
    if (event !== null) {
      router.push(`/e/${event.brandSlug}/${event.eventSlug}` as never);
    }
  }, [event, router]);

  const handleExport = useCallback(async (): Promise<void> => {
    if (event === null) return;
    try {
      // Cycle 13 v2 (D-CYCLE13-IMPL-6): honest toast per export result.
      // Native dismissed = silent (no false-positive success).
      // Loaded on press: the CSV writer stays out of the boot chunk (#3827, orch-1083).
      // Day-order / All-N lives in guestCsvDayOrder so guestCsvExport stays
      // off the __common growth path (orch-1083 / #3493).
      const { exportGuestsCsvByOccurrence } = await import(
        "../../../../src/utils/guestCsvDayOrder"
      );
      const result = await exportGuestsCsvByOccurrence({
        event,
        rows: merged,
        // issue #2160 — a roster you cannot export is half a roster. The SAME
        // label map the chips render from, so the file can never disagree with
        // the screen.
        dayLabels,
      });
      if (result.method === "downloaded") {
        showToast(
          `Downloaded ${merged.length} ${headcountLabelForCount(merged.length)}.`,
        );
      } else if (result.method === "shared") {
        showToast(
          `${merged.length} ${headcountLabelForCount(merged.length)} — CSV shared.`,
        );
      }
      // result.method === "dismissed" → silent.
    } catch (_err) {
      showToast("Couldn't export. Tap to try again.");
    }
  }, [event, merged, showToast, headcountLabelForCount]);

  const handleAddSuccess = useCallback(
    (result: AddCompGuestSuccess): void => {
      setAddSheetOpen(false);
      setAddPrefill(undefined);
      // Re-added legacy entries are real tickets now: drop the phone copies.
      for (const localId of result.addedLegacyIds) {
        useGuestStore.getState().removeCompEntry(localId);
      }
      showToast(result.message);
    },
    [showToast],
  );

  const addSheetNode =
    brand !== null && event !== null ? (
      <AddCompGuestSheet
        visible={addSheetOpen}
        event={event}
        brandId={brand.id}
        prefill={addPrefill}
        onClose={() => {
          setAddSheetOpen(false);
          setAddPrefill(undefined);
        }}
        onSuccess={handleAddSuccess}
      />
    ) : null;

  // Ticketed events only: trips, experiences and RSVPs edit elsewhere.
  const canAddTicketTypeForLink =
    event !== null && offeringKind === "event" && event.event_type !== "rsvp";
  const handleAddTicketTypeForLink = useCallback((preset: NewTicketPreset): void => {
    if (event === null || typeof eventId !== "string") return;
    // Close the sheet first (a native Modal would otherwise sit over the
    // editor); the trip component opens the editor on its first focus.
    setLinksSheetOpen(false);
    setLinksReturn(null);
    setLinkTicketTrip({
      route: addTicketTypeForLinkRoute(eventId, preset),
      knownIds: new Set(event.tickets.map((ticket) => ticket.id)),
    });
  }, [event, eventId]);
  const handleLinkTicketTripReturn = useCallback((): void => {
    if (linkTicketTrip === null || event === null) return;
    const added = event.tickets.find(
      (ticket) => !linkTicketTrip.knownIds.has(ticket.id) && isTicketLinkable(ticket),
    );
    setLinkTicketTrip(null);
    setLinksReturn({ ticketTypeId: added?.id ?? null });
    setLinksSheetOpen(true);
  }, [event, linkTicketTrip]);
  const linkTicketTripNode = linkTicketTrip !== null ? (
    <React.Suspense fallback={null}>
      <LazyAddTicketTypeForLinkTrip route={linkTicketTrip.route} onReturn={handleLinkTicketTripReturn} />
    </React.Suspense>
  ) : null;

  const linksSheetNode = event !== null && typeof eventId === "string" && linksSheetOpen ? (
    <React.Suspense fallback={null}>
      <LazyTicketLinksSheet
        visible
        eventId={eventId}
        eventTitle={event.name}
        tickets={event.tickets}
        initialTicketTypeId={linksReturn?.ticketTypeId ?? null}
        startCreating={linksReturn !== null}
        onAddTicketType={canAddTicketTypeForLink ? handleAddTicketTypeForLink : undefined}
        onClose={() => {
          setLinksSheetOpen(false);
          setLinksReturn(null);
        }}
      />
    </React.Suspense>
  ) : null;

  const handleGuestRosterExport = useCallback(async (input: {
    filter: GuestRosterFilter;
    search: string;
    sort: GuestRosterSort;
  }): Promise<void> => {
    if (typeof eventId !== "string") return;
    try {
      const requested = pendingRosterExportJob.current === null
        ? await requestGuestRosterExport({
          eventId,
          filter: input.filter,
          search: input.search,
          sort: input.sort,
          clientRequestId: createGuestRosterRequestId(),
        })
        : null;
      const jobId = pendingRosterExportJob.current ?? (typeof requested?.jobId === "string" ? requested.jobId : null);
      if (jobId === null) throw new Error("guest_roster_export_job_missing");
      pendingRosterExportJob.current = jobId;
      showToast("Preparing the audited guest export…");
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const status = await getGuestRosterExport(jobId);
        if (status.status === "failed") throw new Error("guest_roster_export_failed");
        if (status.status === "ready" && typeof status.signedUrl === "string") {
          await Linking.openURL(status.signedUrl);
          pendingRosterExportJob.current = null;
          showToast("Guest export ready.");
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      }
      showToast("The export is still being prepared. Tap Export again shortly to check it.");
    } catch {
      pendingRosterExportJob.current = null;
      showToast("Couldn't prepare the export. Tap Export to try again.");
    }
  }, [eventId, showToast]);

  useEffect(() => {
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/event/${routeEvent.replacementEventId}/guests` as never);
    }
  }, [routeEvent.replacementEventId, router]);

  if (event === null && routeEvent.isLoading && typeof eventId === "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>{headcountPluralCap}</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          {/* META-ORCH-1059 — kept generic "Loading event..." on purpose: the
              row is still resolving here (event === null), so kind is unknown;
              also the locked shared-route-recovery marker. Kind-aware copy
              applies on the steady-state strings below. */}
          <Text style={styles.emptyLoadingText}>Loading event...</Text>
        </View>
      </View>
    );
  }

  if (event === null || typeof eventId !== "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>{headcountPluralCap}</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title={`${capitalizeNoun(kindCfg.noun)} not found`}
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  const totalCount = merged.length;

  if (guestRosterAccess.isError || (isAuthReady && user === null)) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>Guests</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState illustration="ticket" title="Couldn't load guest status" description="No guest view is shown until access is confirmed." cta={{ label: "Try again", onPress: () => { void guestRosterAccess.refetch(); }, variant: "primary" }} />
        </View>
      </View>
    );
  }

  if (guestRosterAccess.isPending || guestRosterAccess.data === undefined) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>Guests</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost} accessibilityRole="progressbar">
          <Text style={styles.emptyLoadingText}>Loading guest status…</Text>
        </View>
      </View>
    );
  }

  if (guestRosterAccess.data?.enabled === true) {
    return (
      <>
        <GuestRosterExperience
          eventId={eventId}
          onBack={handleBack}
          onOpenOrder={(orderId) => router.push(`/event/${eventId}/orders/${orderId}` as never)}
          onOpenGuestListOrder={(orderId) => router.push(`/event/${eventId}/guests/order-${orderId}` as never)}
          onExport={(input) => { void handleGuestRosterExport(input); }}
          onAddGuests={canAddGuests ? () => openAddSheet() : undefined}
          onOpenPrivateLinks={canManageTicketLinks ? () => setLinksSheetOpen(true) : undefined}
        />
        {addSheetNode}
        {linksSheetNode}
        {linkTicketTripNode}
        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible={toast.visible}
            kind="info"
            message={toast.message}
            onDismiss={() => setToast({ visible: false, message: "" })}
          />
        </View>
      </>
    );
  }

  if (
    allOrderEntriesRead.status === "loading" ||
    allOrderEntriesRead.status === "disabled"
  ) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>{headcountPluralCap}</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost} accessibilityRole="progressbar">
          <Text style={styles.emptyLoadingText}>Loading guests…</Text>
        </View>
      </View>
    );
  }

  if (allOrderEntriesRead.status === "error") {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>{headcountPluralCap}</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Couldn't load guests"
            description="No order-backed guest count is shown until orders load."
            cta={{ label: "Try again", onPress: () => { void allOrderEntriesRead.refetch(); }, variant: "primary" }}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>{headcountPluralCap}</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="search"
            size={36}
            onPress={() => setSearchOpen((v) => !v)}
            accessibilityLabel={`Search ${headcountPlural}`}
          />
          <IconChrome
            icon="download"
            size={36}
            onPress={handleExport}
            accessibilityLabel={`Export ${headcountPlural} list`}
          />
          {canAddGuests ? (
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => openAddSheet()}
              accessibilityLabel="Add to guest list"
            />
          ) : null}
          {canManageTicketLinks ? (
            <IconChrome
              icon="link"
              size={36}
              onPress={() => setLinksSheetOpen(true)}
              accessibilityLabel="Private links"
            />
          ) : null}
        </View>
      </View>

      {/* Search bar (collapsible) */}
      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Buyer name, email, or phone"
            variant="text"
          />
        </View>
      ) : null}

      {/* List */}
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* issue #2160 — the day chip row. Rendered ONLY when the event has
            more than one occurrence, so a single-date roster is untouched. */}
        {hasDayChips ? (
          occurrences.length > 7 ? (
            <React.Suspense fallback={null}>
              <LazyGuestDaySelector
                occurrences={occurrences}
                dayLabels={dayLabels}
                dayHeadCounts={dayHeadCounts}
                dayFilter={dayFilter}
                onSelectDay={setDayFilter}
                allAccessibilityLabel={`All ${headcountPlural}`}
                headcountLabelForCount={headcountLabelForCount}
              />
            </React.Suspense>
          ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dayChipScroll}
            contentContainerStyle={styles.dayChipRow}
            testID="issue-2160-day-chips"
          >
            <Pressable
              onPress={() => setDayFilter(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: dayFilter === null }}
              accessibilityLabel={`All ${headcountPlural}`}
              testID="issue-2160-day-chip-all"
              style={[
                styles.dayChip,
                dayFilter === null ? styles.dayChipActive : null,
              ]}
            >
              <Text
                style={[
                  styles.dayChipLabel,
                  dayFilter === null ? styles.dayChipLabelActive : null,
                ]}
              >
                All
              </Text>
            </Pressable>
            {occurrences.map((occ) => {
              const label = dayLabels.get(occ.id);
              if (label === undefined) return null;
              const active = dayFilter === occ.id;
              const count = dayHeadCounts.get(occ.id) ?? 0;
              return (
                <Pressable
                  key={occ.id}
                  onPress={() => setDayFilter(active ? null : occ.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label} — ${count} ${headcountLabelForCount(count)}`}
                  testID={`issue-2160-day-chip-${occ.id}`}
                  style={[styles.dayChip, active ? styles.dayChipActive : null]}
                >
                  <Text
                    style={[
                      styles.dayChipLabel,
                      active ? styles.dayChipLabelActive : null,
                    ]}
                  >
                    {label} · {count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          )
        ) : null}

        {legacyComps.length > 0 && canAddGuests ? (
          <View style={styles.legacyBanner} testID="issue-3827-legacy-comps-banner">
            <Text style={styles.legacyBannerText}>
              {`${legacyComps.length} ${legacyComps.length === 1 ? "guest" : "guests"} you added before this update ${legacyComps.length === 1 ? "is" : "are"} saved only on this phone and ${legacyComps.length === 1 ? "has" : "have"} no ticket. Re-add them to send real tickets.`}
            </Text>
            <Button
              label="Re-add"
              onPress={() =>
                openAddSheet(
                  legacyComps.map((c) => ({ localId: c.id, name: c.name, email: c.email, phone: c.phone })),
                )}
              variant="secondary"
              size="sm"
              accessibilityLabel="Re-add the guests saved on this phone"
            />
          </View>
        ) : null}

        {totalCount === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="ticket"
              title={`No ${headcountPlural} yet`}
              description="Once people buy tickets or you add them to the guest list, they'll appear here."
              cta={{
                label: `Share ${kindCfg.noun} link`,
                onPress: handleShareEvent,
                variant: "primary",
              }}
            />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="search"
              title="No matches"
              description={`No ${headcountPlural} match "${search.trim()}".`}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((row) => (
              <GuestRowCard
                key={`${row.kind}-${row.id}`}
                row={row}
                plusOneCount={row.kind === "order" ? plusOneCountByLead.get(row.id) ?? 0 : 0}
                onPress={() => handleOpenRow(row)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add to guest list sheet (issue #3827) */}
      {addSheetNode}
      {linksSheetNode}
      {linkTicketTripNode}

      {/* Toast */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ---- GuestRowCard (composed inline) -------------------------------

interface GuestRowCardProps {
  row: GuestRow;
  /** issue #3827 — named plus-ones who came with this guest-list guest. */
  plusOneCount: number;
  onPress: () => void;
}

/**
 * issue #3827 — check-ins come from the server's tickets (status used, or a
 * first admission on a multi-day pass), never from this phone's scan log.
 */
export const serverCheckInCounts = (order: OrderRecord): { live: number; checkedIn: number } => {
  const passes = order.ticketDays ?? [];
  if (passes.length === 0) {
    return {
      live: order.lines.reduce((sum, l) => sum + Math.max(0, l.quantity - l.refundedQuantity), 0),
      checkedIn: 0,
    };
  }
  const live = passes.filter((t) => t.status === "valid" || t.status === "used");
  return {
    live: live.length,
    checkedIn: live.filter((t) => t.status === "used" || t.usedAt !== null).length,
  };
};

const GuestRowCard: React.FC<GuestRowCardProps> = ({
  row,
  plusOneCount,
  onPress,
}) => {
  const isOrder = row.kind === "order";
  // (kind === "door" is the implicit else branch — narrowing handles it.)

  let name: string;
  let email: string;
  let ticketSummary: string;
  let relativeTime: string;

  if (isOrder) {
    name =
      row.order.buyer.name.trim().length > 0
        ? row.order.buyer.name
        : "Anonymous";
    email = row.order.buyer.email;
    ticketSummary = summarizeOrderTickets(row.order.lines);
    relativeTime = formatRelativeTime(row.order.paidAt);
  } else {
    // Door
    name = row.sale.buyerName.trim().length > 0 ? row.sale.buyerName : "Walk-up";
    email = row.sale.buyerEmail;
    ticketSummary = summarizeDoorTickets(row.sale.lines);
    relativeTime = formatRelativeTime(row.sale.recordedAt);
  }

  const hue = hashStringToHue(row.id);
  const initials = getInitials(name);
  const sublineLeft = email.length > 0
    ? `${email} · `
    : isOrder && isCompOrder(row.order) ? "No email · " : "";
  // issue #3827 — guest-list party fragments: "with Ada", "+2 plus-ones".
  const partyFragments: string[] = [];
  if (isOrder && isCompOrder(row.order)) {
    const lead = row.order.partyLeadName ?? null;
    if (row.order.partyLeadOrderId !== null && row.order.partyLeadOrderId !== undefined && lead !== null) {
      partyFragments.push(`with ${lead}`);
    }
    if (plusOneCount > 0) partyFragments.push(`+${plusOneCount} plus-one${plusOneCount === 1 ? "" : "s"}`);
  }
  if (isOrder && row.order.viaLinkLabel) partyFragments.push(`via ${row.order.viaLinkLabel}`);
  const subline = [`${sublineLeft}${ticketSummary}`, ...partyFragments, relativeTime].join(" · ");

  // Cycle 11 J-S6 + Cycle 12 — derived check-in pill state.
  // Door sales are auto-checked-in at sale time per Decision #5 + OBS-1
  // (refund does NOT void check-in). Always CHECKED IN.
  let checkInPillNode: React.ReactElement | null = null;
  if (isOrder) {
    const counts = serverCheckInCounts(row.order);
    const totalLiveQty = counts.live;
    const checkedCount = counts.checkedIn;
    if (totalLiveQty === 0) {
      checkInPillNode = null;
    } else if (checkedCount === 0) {
      checkInPillNode = (
        <View style={styles.checkInPill}>
          <Text style={styles.checkInPillText}>NOT CHECKED IN</Text>
        </View>
      );
    } else if (checkedCount < totalLiveQty) {
      checkInPillNode = (
        <Pill variant="accent">{`${checkedCount} OF ${totalLiveQty} CHECKED IN`}</Pill>
      );
    } else {
      checkInPillNode = <Pill variant="info">ALL CHECKED IN</Pill>;
    }
  } else {
    // Door — always CHECKED IN (auto-check-in at sale; refund doesn't void).
    checkInPillNode = <Pill variant="info">CHECKED IN</Pill>;
  }

  let kindPillNode: React.ReactElement;
  let a11yLabel: string;
  if (isOrder) {
    const spec = orderStatusPill(row.order);
    kindPillNode = <Pill variant={spec.variant}>{spec.label}</Pill>;
    a11yLabel = isCompOrder(row.order) && row.order.status !== "cancelled"
      ? `Guest-list guest ${name}, ${ticketSummary}`
      : `Guest ${name}, ${ticketSummary}, ${spec.label}`;
  } else {
    const spec = doorPaymentPill(row.sale.paymentMethod, row.sale.status);
    kindPillNode = <Pill variant={spec.variant}>{spec.label}</Pill>;
    a11yLabel = `Door sale ${name}, ${ticketSummary}, ${spec.label}`;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: `hsl(${hue}, 60%, 45%)` },
        ]}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowSubline} numberOfLines={1}>
          {subline}
        </Text>
        <View style={styles.rowPills}>
          {kindPillNode}
          {checkInPillNode}
        </View>
      </View>
    </Pressable>
  );
};

// ---- Styles --------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRight: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  chromeRightSlot: {
    width: 36,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  // issue #2160 — the per-day chip row. Only mounted on a multi-day event, so
  // a single-date roster renders exactly today's screen.
  dayChipScroll: { flexGrow: 0, marginBottom: spacing.sm },
  dayChipRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: 16 },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  dayChipActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
  },
  dayChipLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.72)",
  },
  dayChipLabelActive: { color: "rgba(255, 255, 255, 0.98)" },
  emptyHost: {
    paddingTop: spacing.xl,
  },
  emptyLoadingText: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  rowPills: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  checkInPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(120, 120, 120, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(120, 120, 120, 0.32)",
  },
  checkInPillText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: textTokens.tertiary,
  },
  legacyBanner: {
    gap: spacing.sm,
    padding: spacing.md - 2,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  legacyBannerText: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.primary,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
