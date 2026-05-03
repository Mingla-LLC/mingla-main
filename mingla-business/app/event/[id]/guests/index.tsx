/**
 * /event/[id]/guests — J-G1 Guest list view (Cycle 10).
 *
 * Operator-side merged list of paid orders + comp guests for the event.
 * Buyer-as-attendee model (1 OrderRecord = 1 row, qty = summed lines).
 * Comps from useGuestStore distinguish via "COMP" status pill.
 *
 * Chrome: search toggle + CSV export + add-comp "+".
 *
 * I-21: This is operator-side route. Uses useAuth via parent flow.
 *
 * Per Cycle 10 SPEC §5/J-G1.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
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
import type { CompGuestEntry } from "../../../../src/store/guestStore";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";
import {
  useOrderStore,
  type OrderRecord,
} from "../../../../src/store/orderStore";
import { useScanStore } from "../../../../src/store/scanStore";
import {
  useDoorSalesStore,
  type DoorPaymentMethod,
  type DoorSaleRecord,
} from "../../../../src/store/doorSalesStore";
import { useCurrentBrandStore } from "../../../../src/store/currentBrandStore";
import { useAuth } from "../../../../src/context/AuthContext";
import { exportGuestsCsv } from "../../../../src/utils/guestCsvExport";

import { AddCompGuestSheet } from "../../../../src/components/guests/AddCompGuestSheet";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Input } from "../../../../src/components/ui/Input";
import { Pill } from "../../../../src/components/ui/Pill";
import { Toast } from "../../../../src/components/ui/Toast";

// ---- Merged-row types ----------------------------------------------

type GuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  | { kind: "comp"; id: string; comp: CompGuestEntry; sortKey: string }
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
  if (row.kind === "comp") {
    const c = row.comp;
    return (
      c.name.toLowerCase().includes(lower) ||
      c.email.toLowerCase().includes(lower) ||
      c.phone.toLowerCase().includes(lower)
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

const orderStatusPill = (status: OrderRecord["status"]): OrderStatusPillSpec => {
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

export default function EventGuestsListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );
  const brand = useCurrentBrandStore((s) =>
    event !== null ? s.brands.find((b) => b.id === event.brandId) ?? null : null,
  );

  // Raw subscriptions — merge in useMemo to maintain stable refs.
  const allOrderEntries = useOrderStore((s) => s.entries);
  const allCompEntries = useGuestStore((s) => s.entries);
  // Cycle 12 — door sale entries merged into the J-G1 list.
  const allDoorEntries = useDoorSalesStore((s) => s.entries);

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
    const comps = allCompEntries
      .filter((c) => c.eventId === eventId)
      .map<GuestRow>((c) => ({
        kind: "comp",
        id: c.id,
        comp: c,
        sortKey: c.addedAt,
      }));
    const doorRows = allDoorEntries
      .filter((s) => s.eventId === eventId)
      .map<GuestRow>((s) => ({
        kind: "door",
        id: s.id,
        sale: s,
        sortKey: s.recordedAt,
      }));
    return [...orders, ...comps, ...doorRows].sort(
      (a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime(),
    );
  }, [allOrderEntries, allCompEntries, allDoorEntries, eventId]);

  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [addSheetOpen, setAddSheetOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const filtered = useMemo<GuestRow[]>(
    () => merged.filter((r) => matchesSearch(r, search)),
    [merged, search],
  );

  // Cycle 11 J-S6 — derived check-in counts per order + comp.
  // Raw subscription + useMemo per selector pattern rule.
  const allScanEntries = useScanStore((s) => s.entries);
  const orderCheckInCounts = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const scan of allScanEntries) {
      if (scan.scanResult !== "success") continue;
      // Skip comp manual scans (orderId === "" for comps).
      if (scan.orderId === "") continue;
      map.set(scan.orderId, (map.get(scan.orderId) ?? 0) + 1);
    }
    return map;
  }, [allScanEntries]);
  const compCheckInIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const scan of allScanEntries) {
      if (scan.scanResult !== "success") continue;
      if (scan.via !== "manual") continue;
      if (!scan.ticketId.startsWith("cg_")) continue;
      set.add(scan.ticketId);
    }
    return set;
  }, [allScanEntries]);

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
      await exportGuestsCsv({
        event,
        rows: merged,
      });
      showToast(`Exported ${merged.length} guests.`);
    } catch (_err) {
      showToast("Couldn't export. Tap to try again.");
    }
  }, [event, merged, showToast]);

  const handleAddSuccess = useCallback(
    (entry: CompGuestEntry): void => {
      setAddSheetOpen(false);
      showToast(`${entry.name} added as comp guest.`);
    },
    [showToast],
  );

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
          <Text style={styles.chromeTitle}>Guests</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  const totalCount = merged.length;

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
        <Text style={styles.chromeTitle}>Guests</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="search"
            size={36}
            onPress={() => setSearchOpen((v) => !v)}
            accessibilityLabel="Search guests"
          />
          <IconChrome
            icon="download"
            size={36}
            onPress={handleExport}
            accessibilityLabel="Export guest list"
          />
          <IconChrome
            icon="plus"
            size={36}
            onPress={() => setAddSheetOpen(true)}
            accessibilityLabel="Add comp guest"
          />
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
        {totalCount === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="ticket"
              title="No guests yet"
              description="Once buyers buy tickets — or you add comp guests manually — they'll appear here."
              cta={{
                label: "Share event link",
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
              description={`No guests match "${search.trim()}".`}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((row) => (
              <GuestRowCard
                key={`${row.kind}-${row.id}`}
                row={row}
                orderCheckInCounts={orderCheckInCounts}
                compCheckInIds={compCheckInIds}
                onPress={() => handleOpenRow(row)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add comp guest sheet */}
      {brand !== null ? (
        <AddCompGuestSheet
          visible={addSheetOpen}
          event={event}
          brandId={brand.id}
          operatorAccountId={operatorAccountId}
          onClose={() => setAddSheetOpen(false)}
          onSuccess={handleAddSuccess}
        />
      ) : null}

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
  orderCheckInCounts: Map<string, number>;
  compCheckInIds: Set<string>;
  onPress: () => void;
}

const GuestRowCard: React.FC<GuestRowCardProps> = ({
  row,
  orderCheckInCounts,
  compCheckInIds,
  onPress,
}) => {
  const isOrder = row.kind === "order";
  const isComp = row.kind === "comp";
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
  } else if (isComp) {
    name = row.comp.name;
    email = row.comp.email;
    ticketSummary = `1× ${row.comp.ticketNameAtCreation ?? "Comp"}`;
    relativeTime = formatRelativeTime(row.comp.addedAt);
  } else {
    // Door
    name = row.sale.buyerName.trim().length > 0 ? row.sale.buyerName : "Walk-up";
    email = row.sale.buyerEmail;
    ticketSummary = summarizeDoorTickets(row.sale.lines);
    relativeTime = formatRelativeTime(row.sale.recordedAt);
  }

  const hue = hashStringToHue(row.id);
  const initials = getInitials(name);
  const sublineLeft = email.length > 0 ? `${email} · ` : "";
  const subline = `${sublineLeft}${ticketSummary} · ${relativeTime}`;

  // Cycle 11 J-S6 + Cycle 12 — derived check-in pill state.
  // Door sales are auto-checked-in at sale time per Decision #5 + OBS-1
  // (refund does NOT void check-in). Always CHECKED IN.
  let checkInPillNode: React.ReactElement | null = null;
  if (isOrder) {
    const totalLiveQty = row.order.lines.reduce(
      (sum, l) => sum + Math.max(0, l.quantity - l.refundedQuantity),
      0,
    );
    const checkedCount = orderCheckInCounts.get(row.order.id) ?? 0;
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
  } else if (isComp) {
    const compChecked = compCheckInIds.has(row.comp.id);
    checkInPillNode = compChecked ? (
      <Pill variant="info">CHECKED IN</Pill>
    ) : (
      <View style={styles.checkInPill}>
        <Text style={styles.checkInPillText}>NOT CHECKED IN</Text>
      </View>
    );
  } else {
    // Door — always CHECKED IN (auto-check-in at sale; refund doesn't void).
    checkInPillNode = <Pill variant="info">CHECKED IN</Pill>;
  }

  let kindPillNode: React.ReactElement;
  let a11yLabel: string;
  if (isOrder) {
    const spec = orderStatusPill(row.order.status);
    kindPillNode = <Pill variant={spec.variant}>{spec.label}</Pill>;
    a11yLabel = `Guest ${name}, ${ticketSummary}, ${spec.label}`;
  } else if (isComp) {
    kindPillNode = <Pill variant="accent">COMP</Pill>;
    a11yLabel = `Comp guest ${name}, ${ticketSummary}`;
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
  emptyHost: {
    paddingTop: spacing.xl,
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
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
