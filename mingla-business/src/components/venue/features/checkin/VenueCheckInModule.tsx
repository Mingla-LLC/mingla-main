/**
 * #4490 P2-5 — Check-in (`ci`, `ci-ok`, `ci-id`, `ci-wrong`, `ci-sell`,
 * `ci-empty`): one gate list for the day (Entry passes and event tickets at
 * this venue), search, scan, ID check, undo, and sell at the gate.
 *
 * Scan a pass: on wide web an inspector panel with the camera where the
 * browser can read QR codes, plus a code field that keyboard-wedge scanners
 * type into (or paste a code, or type a booking code or a name to find the
 * guest). On a phone browser the same panel is a sheet. On the native apps
 * Scan opens the camera screen. Results come from `venueCheckInResult`.
 * Usable end to end by the check-in-only role (no money buttons beyond the
 * gate sale it is allowed to make).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useDoorAction, useVenueCheckIns } from "../../../../hooks/useVenueCheckIns";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { useTillReleased } from "../../../../hooks/useTillReleased";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import { useAdmitMember } from "../../../../hooks/useVenueMembers";
import type { CheckInMember, CheckInPass, CheckInTicket, ScanOutcome, VenueGuestListEntry, VenueOffer } from "../../../../types/venueOffers";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { Icon } from "../../../ui/Icon";
import { Input } from "../../../ui/Input";
import { KpiTile } from "../../../ui/KpiTile";
import { Pill, Segmented } from "../../../ui/Pill";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { dayHeadline } from "../today/todayModel";
import { ScanCamera, scanCameraSupported } from "./ScanCamera";
import { checkInResultView, doorErrorCopy, matchTypedCode, memberIdFromCode, type CheckInAction } from "./venueCheckInResult";
import { VenueMemberCheckIn } from "./VenueMemberCheckIn";
import { VenueGateSale } from "./VenueGateSale";
import { doorSaleEntry, guestListDoorSale } from "./doorSaleEntry";
import { VenueGroupCheckIn, needsGroupStep, passIdFromCode } from "./VenueGroupCheckIn";
import { VenueBookingSheet } from "../bookings/VenueBookingSheet";
import { money } from "../offers/offersModel";
import { shortBookingReference } from "../../../../utils/venueBookingReference";
import { normalizeVenueMemberCode } from "../../../../utils/venueMemberCode";

const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

type Filter = "all" | "entry" | "hour" | "events" | "members" | "guestlist";

type Row =
  | { kind: "pass"; key: string; pass: CheckInPass }
  | { kind: "ticket"; key: string; ticket: CheckInTicket }
  | { kind: "member"; key: string; member: CheckInMember }
  | { kind: "guestlist"; key: string; entry: VenueGuestListEntry };

/** "18:30" in the venue's own timezone (not the device's). */
function timeOf(iso: string | null, timezone?: string): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function passStatus(p: CheckInPass, timezone: string): { label: string; variant: "ok" | "warn" | "info" | "muted" | "error" } {
  if (p.status !== "valid") return { label: "Cancelled", variant: "error" };
  if ((p.balanceDueMinor ?? 0) > 0 && p.admittedCount < p.admits) return { label: "Balance due", variant: "warn" };
  if (p.admittedCount >= p.admits) return { label: `In · ${timeOf(p.lastAdmittedAt, timezone) ?? "today"}`, variant: "ok" };
  if (p.admittedCount > 0) return { label: `${p.admittedCount} of ${p.admits} in`, variant: "info" };
  if (p.idCheckLabel !== null) return { label: "Check ID", variant: "warn" };
  return { label: "To arrive", variant: "muted" };
}

export interface VenueCheckInModuleProps {
  brandId: string | null;
  venueId: string | null;
}

export function VenueCheckInModule({ brandId, venueId }: VenueCheckInModuleProps): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const currency = useBrandCurrency(brandId);
  const listQuery = useVenueCheckIns(brandId, venueId);
  const dayQuery = useVenueDay(brandId, venueId, null, { live: true });
  const offersQuery = useVenueOffers(brandId, venueId);
  const door = useDoorAction(brandId, venueId);
  const access = useVenueEditAccess(brandId, venueId);
  // #4490 P3 — a group, or a booking that still owes money, gets a step before going in.
  const [groupStep, setGroupStep] = useState<{ passId: string; qr: string | null } | null>(null);
  const [openBooking, setOpenBooking] = useState<string | null>(null);
  // #4490 P6 — a member from the list or a scanned member pass, before going in.
  const [memberStep, setMemberStep] = useState<{ subscriptionId: string; qr: string | null } | null>(null);
  const admitMember = useAdmitMember(brandId, venueId);

  const [filter, setFilter] = useState<Filter>("all");
  // #4490 fix 2 (N60): By the hour and Members get their own filter when those features are on.
  const featureSet = useVenueFeatures(brandId, venueId).data?.features;
  const hourOn = featureSet?.by_the_hour?.enabled === true;
  const membersOn = featureSet?.memberships?.enabled === true;
  const guestListOn = featureSet?.guest_list?.enabled === true;
  // #4490 spec 08 §13: door sales work with or without the Till. The one
  // switch (venueOrderEntry, as for the order pad): Till off → the gate sale
  // sheet as before O1; Till on → the Till's Entry tab.
  const tillReleased = useTillReleased();
  const doorSale = doorSaleEntry({ tillReleased, tillFeatureOn: featureSet?.till?.enabled === true });
  const openTill = useCallback(
    (prefill: { offerId?: string | null; priceOptionId?: string; count?: number; entryId?: string } = {}): void => {
      if (venueId === null) return;
      const query = [
        "tab=entry",
        prefill.offerId ? `offer=${prefill.offerId}` : null,
        prefill.priceOptionId ? `option=${prefill.priceOptionId}` : null,
        prefill.count ? `count=${prefill.count}` : null,
        prefill.entryId ? `entry=${prefill.entryId}` : null,
      ].filter(Boolean).join("&");
      router.push(`/venue/${venueId}/till?${query}`);
    },
    [router, venueId],
  );
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [memberCode, setMemberCode] = useState("");
  const [memberCodeFocused, setMemberCodeFocused] = useState(false);
  const memberCodeInput = useRef<TextInput | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [lastQr, setLastQr] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // [TRANSITIONAL] the gate sale sheet while the Till is off; exits when every venue is on the Till.
  const [sale, setSale] = useState<{ open: boolean; offerId: string | null }>({ open: false, offerId: null });
  const [guestListSale, setGuestListSale] = useState<{
    entryId: string;
    count: number;
    priceOptionId: string;
    guestName: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const busyRef = useRef(false);

  const list = listQuery.data;
  const day = dayQuery.data;
  const pool = day?.pools[0] ?? null;
  const liveOffers: VenueOffer[] = useMemo(
    () => (offersQuery.data?.offers ?? []).filter((o) => o.status === "live" && o.kind === "entry"),
    [offersQuery.data?.offers],
  );
  const walkInLine =
    pool !== null && pool.keptForWalkIns > 0
      ? `${pool.walkInLeft.toLocaleString("en-GB")} of the ${pool.keptForWalkIns.toLocaleString("en-GB")} kept for walk-ins are left today.`
      : null;
  // Sell at the gate: the gate sale sheet (Till off) or the Till (Till on).
  const sellAtDoor = useCallback(
    (offerId: string | null = null): void => {
      if (doorSale === "till") openTill({ offerId });
      else setSale({ open: true, offerId });
    },
    [doorSale, openTill],
  );

  const rows: Row[] = useMemo(() => {
    const allPasses: Row[] = (list?.passes ?? []).map((pass) => ({ kind: "pass", key: `p-${pass.passId}`, pass }));
    const isHour = (r: Row): boolean => r.kind === "pass" && r.pass.offerKind === "by_the_hour";
    const passes: Row[] = hourOn ? allPasses.filter((r) => !isHour(r)) : allPasses;
    const hours: Row[] = allPasses.filter(isHour);
    const tickets: Row[] = (list?.tickets ?? []).map((ticket) => ({ kind: "ticket", key: `t-${ticket.ticketId}`, ticket }));
    const members: Row[] = (list?.members ?? []).map((member) => ({ kind: "member", key: `m-${member.subscriptionId}`, member }));
    const guestList: Row[] = (list?.guestList ?? []).map((entry) => ({ kind: "guestlist", key: `g-${entry.id}`, entry }));
    const all =
      filter === "entry"
        ? passes
        : filter === "hour"
          ? hours
          : filter === "events"
            ? tickets
            : filter === "members"
              ? members
              : filter === "guestlist"
                ? guestList
                : [...allPasses, ...guestList, ...members, ...tickets];
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter((r) =>
      r.kind === "guestlist"
        ? r.entry.guestName.toLowerCase().includes(needle) ||
          (r.entry.phone ?? "").toLowerCase().includes(needle) ||
          (r.entry.promoterName ?? "").toLowerCase().includes(needle)
        : r.kind === "pass"
        ? r.pass.holderName.toLowerCase().includes(needle) ||
          (r.pass.reference ?? "").toLowerCase().includes(needle) ||
          r.pass.offerName.toLowerCase().includes(needle)
        : r.kind === "member"
          ? r.member.holderName.toLowerCase().includes(needle) || r.member.planName.toLowerCase().includes(needle)
          : r.ticket.holderName.toLowerCase().includes(needle) || r.ticket.eventTitle.toLowerCase().includes(needle),
    );
  }, [filter, hourOn, list?.guestList, list?.members, list?.passes, list?.tickets, search]);

  const runDoor = useCallback(
    (action: Parameters<typeof door.mutate>[0], onDone?: (o: ScanOutcome) => void): void => {
      if (busyRef.current) return;
      busyRef.current = true;
      setScanError(null);
      door.mutate(action, {
        onSuccess: (o) => {
          setOutcome(o);
          onDone?.(o);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setScanError(doorErrorCopy(err.code, err.detail));
        },
        onSettled: () => {
          busyRef.current = false;
        },
      });
    },
    [door],
  );

  const openScan = useCallback((): void => {
    if (Platform.OS !== "web" && venueId !== null) {
      router.push(`/venue/${venueId}/check-in/scan` as never);
      return;
    }
    setOutcome(null);
    setScanError(null);
    setCode("");
    setMemberCode("");
    setCameraNote(null);
    setCameraOn(scanCameraSupported());
    setScanOpen(true);
  }, [router, venueId]);

  const submitMemberCode = useCallback((): void => {
    if (memberCode.length !== 6) {
      setScanError("Type all 6 characters from the member's code.");
      return;
    }
    runDoor({ kind: "admit_code", memberCode }, () => setMemberCode(""));
  }, [memberCode, runDoor]);

  const submitCode = useCallback(
    (raw: string): void => {
      // #4490 P6 — a member pass, or a member's name.
      const typed = raw.trim();
      const scannedMember = memberIdFromCode(typed);
      if (scannedMember !== null) {
        setCode("");
        const known = (list?.members ?? []).find((m) => m.subscriptionId === scannedMember);
        if (known !== undefined && !known.inToday) {
          setMemberStep({ subscriptionId: known.subscriptionId, qr: typed });
          return;
        }
        setLastQr(typed);
        runDoor({ kind: "scan", qrPayload: typed });
        return;
      }
      if (typed.length > 1 && !/^mingla:/i.test(typed)) {
        const needle = typed.toLowerCase();
        const passHits = (list?.passes ?? []).filter((p) => p.holderName.toLowerCase().includes(needle) || (p.reference ?? "").toLowerCase().startsWith(needle));
        const memberHits = (list?.members ?? []).filter((m) => m.holderName.toLowerCase().includes(needle));
        if (passHits.length === 0 && memberHits.length === 1) {
          setCode("");
          setMemberStep({ subscriptionId: (memberHits[0] as CheckInMember).subscriptionId, qr: null });
          return;
        }
      }
      const match = matchTypedCode(raw, list?.passes ?? []);
      if (match.kind === "none") {
        setScanError("Type or paste a code, a booking code like VB-1A2B, or a name.");
        return;
      }
      if (match.kind === "many") {
        setScanError(`${match.count} guests match. Type more of the name or the booking code.`);
        return;
      }
      setCode("");
      if (match.kind === "qr") {
        const id = passIdFromCode(match.payload);
        const known = id === null ? undefined : (list?.passes ?? []).find((p) => p.passId === id);
        if (known !== undefined && needsGroupStep(known)) {
          setGroupStep({ passId: known.passId, qr: match.payload });
          return;
        }
        setLastQr(match.payload);
        runDoor({ kind: "scan", qrPayload: match.payload });
      } else {
        setLastQr(null);
        if (needsGroupStep(match.pass)) {
          setGroupStep({ passId: match.pass.passId, qr: null });
          return;
        }
        runDoor({ kind: "admit", passId: match.pass.passId });
      }
    },
    [list?.members, list?.passes, runDoor],
  );

  const onAction = useCallback(
    (action: CheckInAction): void => {
      if (outcome === null) return;
      if (action === "scan_next") {
        setOutcome(null);
        setScanError(null);
        setLastQr(null);
        if (!scanOpen) setScanOpen(true);
        return;
      }
      if (action === "close") {
        setOutcome(null);
        setScanOpen(false);
        return;
      }
      if (action === "undo" && outcome.logId !== null) {
        runDoor({ kind: "undo", logId: outcome.logId }, () => setToast("Check-in undone"));
        return;
      }
      if (action === "id_seen") {
        if (lastQr !== null) runDoor({ kind: "scan", qrPayload: lastQr, idChecked: true });
        else if (outcome.pass !== null) runDoor({ kind: "admit", passId: outcome.pass.passId, idChecked: true });
        return;
      }
      if (action === "sell_walk_in") {
        setScanOpen(false);
        setOutcome(null);
        const walkIn = liveOffers.find((o) => o.entryStyle === "walk_in") ?? liveOffers[0] ?? null;
        sellAtDoor(walkIn?.id ?? null);
      }
    },
    [lastQr, liveOffers, outcome, runDoor, scanOpen, sellAtDoor],
  );

  const admitRow = useCallback(
    (pass: CheckInPass): void => {
      setRowError(null);
      setLastQr(null);
      if (needsGroupStep(pass)) {
        setOutcome(null);
        setScanError(null);
        setCameraOn(false);
        setGroupStep({ passId: pass.passId, qr: null });
        setScanOpen(true);
        return;
      }
      // A row admission needs the same durable result as a scan: the operator
      // must be able to undo a mistaken tap before moving to the next guest.
      runDoor({ kind: "admit", passId: pass.passId }, () => setScanOpen(true));
    },
    [runDoor],
  );

  const admitGuestListRow = useCallback(
    (entry: VenueGuestListEntry): void => {
      const count = Math.max(1, 1 + entry.plusOnes - entry.arrived);
      setRowError(null);
      setOutcome(null);
      runDoor({ kind: "admit_guest_list", entryId: entry.id, count }, (next) => {
        // Spec 08 §13: the server answers by the same switch. Till on (spec 07
        // §11 B3): the Till's Entry tab, prefilled with the option and count.
        // Till off (spec 07 §I): the gate sale sheet at the list price.
        const route = guestListDoorSale(next.result as string);
        if (route !== null && next.priceOptionId !== null && next.priceOptionId !== undefined) {
          setOutcome(null);
          if (route === "till") {
            openTill({ offerId: next.offeringId ?? null, priceOptionId: next.priceOptionId, count: next.count ?? count, entryId: entry.id });
            return;
          }
          setGuestListSale({
            entryId: entry.id,
            count: next.count ?? count,
            priceOptionId: next.priceOptionId,
            guestName: entry.guestName,
          });
          setSale({ open: true, offerId: next.offeringId ?? null });
          return;
        }
        if (next.result === "list_closed_for_price") {
          setOutcome(null);
          setRowError("List price has ended. Sell normal Entry instead.");
          const walkIn = liveOffers.find((offer) => offer.entryStyle === "walk_in") ?? liveOffers[0] ?? null;
          setGuestListSale(null);
          sellAtDoor(walkIn?.id ?? null);
          return;
        }
        setScanOpen(true);
      });
    },
    [liveOffers, openTill, runDoor, sellAtDoor],
  );

  // ---------------------------------------------------------------- states
  if (listQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-checkin-loading" accessibilityLabel="Loading the gate list">
        <Skeleton height={28} width="30%" />
        <View style={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={84} radius="md" style={styles.tileSkeleton} />
          ))}
        </View>
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </View>
    );
  }
  if (listQuery.isError || list === undefined) {
    const err = listQuery.error === null ? null : toVenueOfferError(listQuery.error);
    return (
      <CenteredState
        title="Couldn't load the gate list"
        body={err !== null && err.code !== "unknown" && err.code !== "network" ? doorErrorCopy(err.code) : "Check your connection and try again."}
        tone="error"
        testID="venue-checkin-error"
      >
        <Button label="Try again" variant="secondary" size="md" onPress={() => void listQuery.refetch()} />
      </CenteredState>
    );
  }

  const admitted = day?.checkIn.admitted ?? list.totals.admitted;
  const expected = day?.checkIn.expected ?? list.totals.admits;
  const idWaiting = list.passes.filter((p) => p.status === "valid" && p.idCheckLabel !== null && p.admittedCount === 0).length;
  const ticketsIn = list.tickets.reduce((s, t) => s + t.admittedCount, 0);

  // -------------------------------------------------------------- scan UI
  const view = outcome !== null ? checkInResultView(outcome, list.timezone) : null;
  const actionLabel = (a: CheckInAction): string =>
    a === "undo"
      ? "Undo"
      : a === "scan_next"
        ? "Scan next"
        : a === "id_seen"
          ? "ID seen · check in"
          : a === "sell_walk_in"
            ? "Sell walk-in entry"
            : "Close";
  const toneColor = view === null ? color.text3 : view.tone === "success" ? color.success : view.tone === "warning" ? color.warning : view.tone === "danger" ? color.danger : color.text3;
  const groupPass = groupStep === null ? null : list.passes.find((p) => p.passId === groupStep.passId) ?? null;
  const stepMember = memberStep === null ? null : (list.members ?? []).find((m) => m.subscriptionId === memberStep.subscriptionId) ?? null;
  const admitMemberNow = (guests: number): void => {
    if (memberStep === null) return;
    const step = memberStep;
    if (step.qr !== null) {
      setLastQr(step.qr);
      runDoor({ kind: "scan", qrPayload: step.qr, admitCount: 1 + guests }, () => setMemberStep(null));
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setScanError(null);
    admitMember.mutate(
      { subscriptionId: step.subscriptionId, guests },
      {
        onSuccess: (o) => {
          setMemberStep(null);
          setOutcome(o);
          if (!scanOpen) setScanOpen(true);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setScanError(doorErrorCopy(err.code, err.detail));
        },
        onSettled: () => {
          busyRef.current = false;
        },
      },
    );
  };
  const scanBody = (
    <View style={styles.scanBody} testID="venue-checkin-scan">
      {view === null && stepMember !== null ? (
        <VenueMemberCheckIn
          member={stepMember}
          admitting={door.isPending || admitMember.isPending}
          onAdmit={admitMemberNow}
          onClose={() => {
            setMemberStep(null);
            setScanOpen(false);
            setScanError(null);
          }}
        />
      ) : view === null && groupPass !== null && groupStep !== null ? (
        <VenueGroupCheckIn
          pass={groupPass}
          brandId={brandId}
          venueId={venueId}
          currency={currency}
          canManageMoney={access.canManageMoney}
          admitting={door.isPending}
          onAdmit={(count) => {
            const step = groupStep;
            if (step.qr !== null) {
              setLastQr(step.qr);
              runDoor({ kind: "scan", qrPayload: step.qr, admitCount: count }, () => setGroupStep(null));
            } else {
              runDoor({ kind: "admit", passId: groupPass.passId, count }, () => setGroupStep(null));
            }
          }}
          onOpenBooking={(groupId) => setOpenBooking(groupId)}
          onClose={() => {
            setGroupStep(null);
            setScanOpen(false);
          }}
          onToast={setToast}
          onRefresh={() => void listQuery.refetch()}
          refreshing={listQuery.isFetching}
        />
      ) : view === null ? (
        <>
          {cameraOn ? (
            <ScanCamera
              active={scanOpen && view === null && groupStep === null && memberStep === null}
              onCode={(payload) => {
                const memberId = memberIdFromCode(payload);
                const knownMember = memberId === null ? undefined : (list?.members ?? []).find((m) => m.subscriptionId === memberId);
                if (knownMember !== undefined && !knownMember.inToday) {
                  setMemberStep({ subscriptionId: knownMember.subscriptionId, qr: payload });
                  return;
                }
                const id = passIdFromCode(payload);
                const known = id === null ? undefined : (list?.passes ?? []).find((p) => p.passId === id);
                if (known !== undefined && needsGroupStep(known)) {
                  setGroupStep({ passId: known.passId, qr: payload });
                  return;
                }
                setLastQr(payload);
                runDoor({ kind: "scan", qrPayload: payload });
              }}
              onUnavailable={(reason) => {
                setCameraOn(false);
                setCameraNote(
                  reason === "denied"
                    ? "Camera access was refused. Allow the camera in your browser, or type the code."
                    : "This browser can't scan with the camera. Type or paste the code instead.",
                );
              }}
            />
          ) : null}
          {!cameraOn ? (
            <Text style={styles.meta}>
              {cameraNote ?? (Platform.OS === "web" && !scanCameraSupported()
                ? "This browser can't scan with the camera. A handheld scanner types the code here; you can also paste it, or type a booking code or name."
                : "Type or paste the code, or a booking code or name.")}
            </Text>
          ) : null}
          <View style={styles.codeRow}>
            <View style={styles.grow}>
              <Input
                value={code}
                onChangeText={setCode}
                placeholder="Code, booking code or name"
                accessibilityLabel="Pass code, booking code or name"
                autoFocus={!cameraOn}
                onSubmitEditing={() => submitCode(code)}
                returnKeyType="go"
                testID="venue-checkin-code"
              />
            </View>
            <Button label="Check" variant="primary" size="md" onPress={() => submitCode(code)} loading={door.isPending} testID="venue-checkin-code-submit" />
          </View>
          {scanCameraSupported() && !cameraOn ? (
            <Button label="Use the camera" variant="ghost" size="sm" leadingIcon="scan" onPress={() => { setCameraNote(null); setCameraOn(true); }} />
          ) : null}
          {membersOn ? (
            <View style={styles.memberCodeSection} testID="venue-checkin-member-code-section">
              <View style={styles.memberCodeCopy}>
                <Text style={styles.rowTitle}>Type a code</Text>
                <Text style={styles.hint}>Use the 6 characters shown below their member pass.</Text>
              </View>
              <View style={styles.memberCodeRow}>
                <Pressable
                  accessible={false}
                  accessibilityLabel="Type the member code"
                  style={styles.memberCodePressable}
                  onPress={() => memberCodeInput.current?.focus()}
                >
                  <View style={styles.memberCodeBoxes} pointerEvents="none">
                    {Array.from({ length: 6 }, (_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.memberCodeBox,
                          memberCodeFocused && index === Math.min(memberCode.length, 5)
                            ? styles.memberCodeBoxFocused
                            : null,
                        ]}
                      >
                        <Text style={styles.memberCodeCharacter}>{memberCode[index] ?? ""}</Text>
                      </View>
                    ))}
                  </View>
                  <TextInput
                    ref={memberCodeInput}
                    value={memberCode}
                    onChangeText={(value) => setMemberCode(normalizeVenueMemberCode(value))}
                    onFocus={() => setMemberCodeFocused(true)}
                    onBlur={() => setMemberCodeFocused(false)}
                    onSubmitEditing={submitMemberCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="go"
                    accessibilityLabel="Six-character member code"
                    testID="venue-checkin-member-code"
                    style={styles.memberCodeInput}
                  />
                </Pressable>
                <Button
                  label="Check member"
                  variant="secondary"
                  size="md"
                  onPress={submitMemberCode}
                  loading={door.isPending}
                  disabled={memberCode.length !== 6}
                  testID="venue-checkin-member-code-submit"
                />
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.result} testID={`venue-checkin-result-${view.state}`}>
          <View style={[styles.resultIcon, { borderColor: toneColor }]}>
            <Icon name={view.tone === "success" ? "check" : view.tone === "danger" ? "close" : view.state === "needs_id" ? "shield" : "flag"} size={28} color={toneColor} />
          </View>
          <Text style={styles.resultTitle} accessibilityRole="header" accessibilityLiveRegion="assertive">{view.title}</Text>
          {view.subject !== null ? <Text style={styles.resultSubject}>{view.subject}</Text> : null}
          {view.body !== null ? (
            view.state === "needs_id" || view.state === "wrong_day" ? (
              <Banner tone={view.tone === "danger" ? "danger" : "warning"} title={view.body} />
            ) : (
              <Text style={styles.meta}>{view.body}</Text>
            )
          ) : null}
          <View style={styles.resultActions}>
            {view.secondary !== null && !(view.secondary === "sell_walk_in" && liveOffers.length === 0) ? (
              <Button label={actionLabel(view.secondary)} variant="secondary" size="md" onPress={() => onAction(view.secondary as CheckInAction)} disabled={door.isPending} testID={`venue-checkin-action-${view.secondary}`} />
            ) : null}
            <Button label={actionLabel(view.primary)} variant="primary" size="md" onPress={() => onAction(view.primary)} loading={door.isPending} testID={`venue-checkin-action-${view.primary}`} />
          </View>
        </View>
      )}
      {scanError !== null ? <Banner tone="danger" title="That didn't go through" body={scanError} testID="venue-checkin-scan-error" /> : null}
      {pool !== null ? (
        <Text style={styles.hint}>
          {admitted} in · {pool.walkInLeft} kept for walk-ins left
        </Text>
      ) : null}
    </View>
  );

  const rowsView =
    rows.length === 0 ? (
      <GlassCard variant="base" padding={space[5]} contentStyle={styles.emptyCard} testID="venue-checkin-empty">
        <Icon name="scan" size={28} color={color.text3} />
        <Text style={styles.emptyTitle}>{search.trim().length > 0 ? "No one matches" : "Nobody expected yet"}</Text>
        <Text style={styles.meta}>
          {search.trim().length > 0
            ? "Check the spelling, or scan their pass."
            : "Today's bookings appear here. Walk-ups can pay at the gate."}
        </Text>
        {search.trim().length === 0 && liveOffers.length > 0 ? (
          <Button label="Sell at the gate" variant="primary" size="md" onPress={() => sellAtDoor()} />
        ) : null}
      </GlassCard>
    ) : (
      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-checkin-list">
        {rows.map((r, index) => {
          if (r.kind === "guestlist") {
            const entry = r.entry;
            const total = 1 + entry.plusOnes;
            const inNow = entry.arrived >= total;
            return (
              <View key={r.key} style={[styles.row, index > 0 ? styles.rowBorder : null]} testID={`venue-checkin-guest-list-${entry.id}`}>
                <View style={styles.cellText}>
                  <View style={styles.memberName}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{entry.guestName}</Text>
                    <Pill variant="info">Guest list</Pill>
                  </View>
                  <Text style={styles.meta} numberOfLines={2}>
                    {entry.promoterName ?? "Venue team"}{entry.phone ? ` · ${entry.phone}` : ""}{entry.note ? ` · ${entry.note}` : ""}
                  </Text>
                </View>
                <Text style={styles.guests}>{entry.arrived > 0 ? `${entry.arrived} of ${total}` : total}</Text>
                {inNow ? (
                  <Pill variant="ok">In</Pill>
                ) : (
                  <Button
                    label="Check in"
                    variant="secondary"
                    size="sm"
                    onPress={() => admitGuestListRow(entry)}
                    disabled={door.isPending}
                    accessibilityLabel={`Check in ${entry.guestName} from the guest list`}
                    testID={`venue-checkin-guest-list-admit-${entry.id}`}
                  />
                )}
              </View>
            );
          }
          if (r.kind === "member") {
            const m = r.member;
            return (
              <View key={r.key} style={[styles.row, index > 0 ? styles.rowBorder : null]} testID={`venue-checkin-member-${m.subscriptionId}`}>
                <View style={styles.cellText}>
                  <View style={styles.memberName}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{m.holderName}</Text>
                    <Pill variant="info">Member</Pill>
                  </View>
                  <Text style={styles.meta} numberOfLines={2}>
                    {m.planName}
                    {m.paymentDue ? " · payment due" : ""}
                    {m.guestPassesLeft > 0 ? ` · ${m.guestPassesLeft} guest ${m.guestPassesLeft === 1 ? "pass" : "passes"}` : ""}
                    {m.inToday && m.guests > 0 ? ` · came with ${m.guests}` : ""}
                  </Text>
                </View>
                {m.inToday ? (
                  <Pill variant="ok">{`In · ${timeOf(m.checkedInAt, list.timezone) ?? "today"}`}</Pill>
                ) : (
                  <Button
                    label="Check in"
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      setRowError(null);
                      setOutcome(null);
                      setScanError(null);
                      setCameraOn(false);
                      setMemberStep({ subscriptionId: m.subscriptionId, qr: null });
                      setScanOpen(true);
                    }}
                    disabled={door.isPending || admitMember.isPending}
                    accessibilityLabel={`Check in ${m.holderName}, member`}
                    testID={`venue-checkin-member-admit-${m.subscriptionId}`}
                  />
                )}
              </View>
            );
          }
          if (r.kind === "ticket") {
            const t = r.ticket;
            const inNow = t.admittedCount >= t.admits;
            return (
              <View key={r.key} style={[styles.row, index > 0 ? styles.rowBorder : null]}>
                <View style={styles.cellText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{t.holderName}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t.eventTitle}
                    {t.ticketName.length > 0 ? ` · ${t.ticketName}` : ""}
                    {timeOf(t.time, list.timezone) !== null ? ` · ${timeOf(t.time, list.timezone)}` : ""}
                  </Text>
                </View>
                <Text style={styles.guests}>{t.admits}</Text>
                <Pill variant={inNow ? "ok" : "muted"}>{inNow ? "In" : "Scan ticket"}</Pill>
              </View>
            );
          }
          const p = r.pass;
          const st = passStatus(p, list.timezone);
          const canAdmit = p.status === "valid" && p.admittedCount < p.admits;
          return (
            <View key={r.key} style={[styles.row, index > 0 ? styles.rowBorder : null]} testID={`venue-checkin-row-${p.passId}`}>
              <View style={styles.cellText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{p.holderName}</Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {p.offerKind === "by_the_hour" ? `${p.offerName}${timeOf(p.time, list.timezone) !== null ? ` · from ${timeOf(p.time, list.timezone)}` : ""}` : `${p.offerName} × ${p.admits}`}
                  {p.reference !== null ? ` · ${shortBookingReference(p.reference)}` : ""}
                  {p.source === "gate" || p.source === "gate_sale" ? " · gate sale" : ""}
                  {p.idCheckLabel !== null ? ` · ${p.idCheckLabel}` : ""}
                  {(p.balanceDueMinor ?? 0) > 0 ? ` · Balance due ${money(p.balanceDueMinor ?? 0, p.currencyCode ?? currency)}` : ""}
                </Text>
              </View>
              <Text style={styles.guests}>
                {p.admittedCount > 0 ? `${p.admittedCount} of ${p.admits}` : p.admits}
              </Text>
              {isWideDesktop ? <Pill variant={st.variant}>{st.label}</Pill> : null}
              {canAdmit ? (
                <Button
                  label={
                    (p.balanceDueMinor ?? 0) > 0
                      ? `Take ${money(p.balanceDueMinor ?? 0, p.currencyCode ?? currency)}`
                      : p.idCheckLabel !== null && p.admittedCount === 0
                        ? "Check ID"
                        : "Check in"
                  }
                  variant="secondary"
                  size="sm"
                  onPress={() => admitRow(p)}
                  disabled={door.isPending}
                  accessibilityLabel={`Check in ${p.holderName}`}
                  testID={`venue-checkin-admit-${p.passId}`}
                />
              ) : !isWideDesktop ? (
                <Pill variant={st.variant}>{st.label}</Pill>
              ) : null}
            </View>
          );
        })}
      </GlassCard>
    );

  return (
    <View style={styles.host} testID="venue-checkin-module">
      <View style={styles.header}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header">Check-in</Text>
          {day !== undefined ? <Text style={styles.meta}>{dayHeadline(day)}</Text> : null}
        </View>
        <View style={styles.headActions}>
          <Button
            label="Sell at the gate"
            variant="secondary"
            size="sm"
            leadingIcon="plus"
            onPress={() => sellAtDoor()}
            disabled={liveOffers.length === 0}
            testID="venue-checkin-sell"
          />
          <Button label="Scan a pass" variant="primary" size="sm" leadingIcon="scan" onPress={openScan} testID="venue-checkin-scan-open" />
        </View>
      </View>
      {liveOffers.length === 0 && !offersQuery.isLoading ? (
        <Text style={styles.hint}>Sell at the gate opens once an Entry offer is live.</Text>
      ) : null}

      <View style={styles.tiles}>
        <KpiTile label="In the venue" value={admitted + ticketsIn} sub={pool !== null ? `of ${pool.dailyLimit.toLocaleString("en-GB")} today` : undefined} style={styles.tile} testID="venue-checkin-tile-in" />
        <KpiTile label="Still to arrive" value={Math.max(0, expected - admitted)} sub={(() => {
            const n = list.passes.filter((p) => p.status === "valid" && p.admittedCount < p.admits).length;
            return n === 1 ? "1 pass" : `${n} passes`;
          })()} style={styles.tile} />
        <KpiTile label="Kept for walk-ins" value={pool?.walkInLeft ?? 0} sub={pool !== null ? `of ${pool.keptForWalkIns} left` : "No day limit set"} style={styles.tile} testID="venue-checkin-tile-walkins" />
        <KpiTile label="ID checks" value={idWaiting} sub="waiting" style={styles.tile} />
      </View>

      <View style={[styles.filters, !isWideDesktop ? styles.filtersStacked : null]}>
        <View style={styles.grow}>
          <Input value={search} onChangeText={setSearch} variant="search" placeholder="Name, phone or booking code" accessibilityLabel="Search the gate list" clearable testID="venue-checkin-search" />
        </View>
        <Segmented
          options={[
            { key: "all", label: "Everyone", count: list.passes.length + list.tickets.length + (list.members ?? []).length + (list.guestList ?? []).length },
            { key: "entry", label: "Entry", count: hourOn ? list.passes.filter((p) => p.offerKind !== "by_the_hour").length : list.passes.length },
            ...(hourOn ? [{ key: "hour" as const, label: "By the hour", count: list.passes.filter((p) => p.offerKind === "by_the_hour").length }] : []),
            ...(membersOn || (list.members ?? []).length > 0 ? [{ key: "members" as const, label: "Members", count: (list.members ?? []).length }] : []),
            ...(guestListOn || (list.guestList ?? []).length > 0 ? [{ key: "guestlist" as const, label: "Guest list", count: (list.guestList ?? []).length }] : []),
            { key: "events", label: "Events", count: list.tickets.length },
          ]}
          value={filter}
          onChange={setFilter}
          full={!isWideDesktop}
          accessibilityLabel="Show"
          testID="venue-checkin-filter"
        />
      </View>
      {rowError !== null ? <Text style={styles.error}>{rowError}</Text> : null}
      {rowsView}

      <Sheet
        visible={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setOutcome(null);
          setCameraOn(false);
          setGroupStep(null);
          setMemberStep(null);
        }}
        snapPoint={0.85}
        presentation={isWideDesktop ? "panel" : undefined}
        testID="venue-checkin-scan-sheet"
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead
            title={memberStep !== null ? "Check in a member" : groupStep !== null ? "Check in a group" : "Scan a pass"}
            onClose={() => {
              setScanOpen(false);
              setOutcome(null);
              setCameraOn(false);
              setGroupStep(null);
              setMemberStep(null);
            }}
            plain={isWideDesktop}
            testID="venue-checkin-scan-head"
          />
          <ScrollView style={styles.grow} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {scanBody}
          </ScrollView>
        </View>
      </Sheet>
      <VenueBookingSheet brandId={brandId} venueId={venueId} groupId={openBooking} onClose={() => setOpenBooking(null)} />
      {/* [TRANSITIONAL] #4490 spec 08 §13: the gate sale sheet while the Till is off; exits when every venue is on the Till. */}
      <VenueGateSale
        visible={sale.open}
        onClose={() => {
          setSale({ open: false, offerId: null });
          setGuestListSale(null);
        }}
        brandId={brandId}
        venueId={venueId}
        offers={liveOffers}
        settings={offersQuery.data?.settings ?? null}
        currency={currency}
        walkInLine={guestListSale === null ? walkInLine : null}
        initialOfferId={sale.offerId}
        guestListSale={guestListSale}
        onSold={(result, summary) => {
          if (result.method !== "pay_link") {
            setSale({ open: false, offerId: null });
            setGuestListSale(null);
          }
          setToast(summary);
        }}
      />
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-checkin-toast" />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  headText: { gap: 2, flexShrink: 1 },
  headActions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  grow: { flex: 1, minWidth: 0 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { flexGrow: 1, flexBasis: 160, minWidth: 150 },
  tileSkeleton: { flexGrow: 1, flexBasis: 160 },
  filters: { flexDirection: "row", gap: space[3], alignItems: "center" },
  filtersStacked: { flexDirection: "column", alignItems: "stretch" },
  listCard: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 60 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  cellText: { flex: 1, minWidth: 0, gap: 2 },
  memberName: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  rowTitle: { ...type.row, color: color.text1 },
  guests: { ...type.small, color: color.text2, minWidth: 40, textAlign: "right" },
  emptyCard: { gap: space[2], alignItems: "center" },
  emptyTitle: { ...type.h2, color: color.text1 },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  sheetTitle: { ...type.h1, color: color.text1, marginBottom: space[2] },
  sheetScroll: { paddingBottom: space[10] },
  scanBody: { gap: space[3] },
  codeRow: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  memberCodeSection: { gap: space[2], borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[3] },
  memberCodeCopy: { gap: 2 },
  memberCodeRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  memberCodePressable: { position: "relative" },
  memberCodeBoxes: { flexDirection: "row", gap: space[1] },
  memberCodeBox: {
    width: 38,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    backgroundColor: color.fill.tile,
  },
  memberCodeBoxFocused: { borderColor: color.lineStrong },
  memberCodeCharacter: { ...type.h2, color: color.text1 },
  memberCodeInput: { ...StyleSheet.absoluteFillObject, opacity: 0 },
  result: { alignItems: "center", gap: space[3], paddingVertical: space[2] },
  resultIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: { ...type.h1, color: color.text1, textAlign: "center" },
  resultSubject: { ...type.row, color: color.text1, textAlign: "center" },
  resultActions: { flexDirection: "row", gap: space[2], flexWrap: "wrap", justifyContent: "center" },
});
