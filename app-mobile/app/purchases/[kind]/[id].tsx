// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import * as Sharing from "expo-sharing";
import {
  MapsAppChooserDialog,
  useVenueMapsActions,
  type MapsAppId,
  type MapsOpenTarget,
  type ThemePalette,
} from "@mingla/offering-rendering";

import { DoorModeModal } from "../../../src/components/purchases/DoorModeModal";
import { SendTicketSheet } from "../../../src/components/purchases/SendTicketSheet";
import RsvpPassSheet from "../../../src/components/activity/RsvpPassSheet";
import { EarnBySharingCard } from "../../../src/components/wallet/EarnBySharingCard";
import { Icon } from "../../../src/components/ui/Icon";
import { toastManager } from "../../../src/components/ui/Toast";
import { useBrandFollow } from "../../../src/hooks/useBrandFollow";
import {
  cancelMyReservation,
  type MyReservationRow,
} from "../../../src/hooks/useMyReservations";
import { usePurchaseDetail } from "../../../src/hooks/usePurchases";
import type { ConsumerRsvpRow } from "../../../src/services/calendarService";
import type {
  PurchaseOrderRecord,
  PurchaseTicket,
} from "../../../src/services/purchasesService";
import {
  takeBackTicket,
  TicketTransferError,
} from "../../../src/services/purchasesService";
import { useAppStore } from "../../../src/store/appStore";
import { TicketService } from "../../../src/services/ticketService";
import { fetchRsvpPartyPasses } from "../../../src/services/rsvpDeckService";
import { postHogService } from "../../../src/services/postHogService";
import {
  formatPurchaseMoney,
  purchaseCountLabel,
  purchaseKindLabel,
  purchaseRefundLabel,
  purchaseStatusLabel,
} from "../../../src/utils/purchasePresentation";
import type {
  PurchaseKind,
  PurchaseTimelineItem,
} from "../../../src/utils/purchaseTimeline";
import { formatTicketTimeLine } from "../../../src/utils/zoneLabel";
import { parseMapPoint } from "../../../src/utils/mapsUrl";
import { openMapsTarget } from "../../../src/utils/openMapsTarget";

const KINDS = new Set<PurchaseKind>([
  "order",
  "rsvp",
  "reservation",
  "venue_order",
]);

const TICKET_MAPS_PALETTE: ThemePalette = {
  page: "#171a20",
  accent: "#eb7825",
  accentText: "#ffffff",
  primaryText: "#ffffff",
  secondaryText: "rgba(255,255,255,0.64)",
  tertiaryText: "rgba(255,255,255,0.45)",
  panel: "#171a20",
  panelStrong: "#20242c",
  panelBorder: "rgba(255,255,255,0.10)",
  card: "rgba(255,255,255,0.05)",
  cutoutBorder: "rgba(255,255,255,0.12)",
  glass: "rgba(11,13,17,0.92)",
  glassTint: "dark",
  accentWash: "rgba(235,120,37,0.14)",
};

const openTicketMapsTarget = (
  target: MapsOpenTarget,
  app?: MapsAppId,
): void => {
  openMapsTarget(target, { app });
};

function firstParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

function explorerOfferingPath(
  eventType: string | null | undefined,
  brandSlug: string,
  eventSlug: string,
): string {
  const prefix =
    eventType === "trip"
      ? "t"
      : eventType === "experience"
        ? "exp"
        : "e";
  return `/${prefix}/${encodeURIComponent(brandSlug)}/${encodeURIComponent(eventSlug)}`;
}

function detailRows(
  item: PurchaseTimelineItem,
  t: (key: string, options?: Record<string, unknown>) => string,
): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    [t("ticket.details.status"), purchaseStatusLabel(item.status)],
    [t("ticket.details.for"), purchaseCountLabel(item)],
    [
      t("ticket.details.when"),
      formatTicketTimeLine(item.startsAt, item.timezone, null),
    ],
    [t("ticket.details.where"), item.venueLine],
    [
      t("ticket.details.total"),
      formatPurchaseMoney(item.amountCents, item.currency),
    ],
    [t("ticket.details.refund"), purchaseRefundLabel(item)],
    [t("ticket.details.reference"), item.id],
  ];
  return rows.filter(
    (row): row is [string, string] => row[1] !== null && row[1].length > 0,
  );
}

function ticketStatusKey(
  status: string,
): "valid" | "used" | "refunded" | "void" {
  if (status === "valid" || status === "used" || status === "refunded")
    return status;
  return "void";
}

function moneyOrFree(
  amountCents: number,
  currency: string,
  freeLabel: string,
): string {
  return amountCents === 0
    ? freeLabel
    : (formatPurchaseMoney(amountCents, currency) ?? "—");
}

function cardDisplay(order: PurchaseOrderRecord): string | null {
  if (!order.paymentCardLast4) return null;
  const brand = order.paymentCardBrand
    ? order.paymentCardBrand.charAt(0).toUpperCase() +
      order.paymentCardBrand.slice(1)
    : "Card";
  return `${brand} •••• ${order.paymentCardLast4}`;
}

const CALENDAR_EVENT_KEY_PREFIX = "mingla:purchase-calendar:";

function QuietAction({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  disabled?: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quietAction,
        pressed && styles.pressed,
        disabled && styles.quietActionDisabled,
      ]}
    >
      <Icon color="rgba(255,255,255,0.56)" name={icon} size={19} />
      <Text style={styles.quietActionText}>{label}</Text>
      <Text style={styles.quietActionChevron}>›</Text>
    </Pressable>
  );
}

export default function PurchaseDetailRoute(): React.ReactElement {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{
    kind?: string | string[];
    id?: string | string[];
    door?: string | string[];
    ticket?: string | string[];
  }>();
  const kindParam = firstParam(params.kind);
  const id = firstParam(params.id);
  const kind =
    kindParam !== null && KINDS.has(kindParam as PurchaseKind)
      ? (kindParam as PurchaseKind)
      : null;
  const [doorVisible, setDoorVisible] = useState(
    firstParam(params.door) === "1",
  );
  const [doorSource, setDoorSource] = useState<"button" | "push">(
    firstParam(params.door) === "1" ? "push" : "button",
  );
  const [rsvpSheetVisible, setRsvpSheetVisible] = useState(false);
  const [rsvpTickets, setRsvpTickets] = useState<PurchaseTicket[]>([]);
  const [ticketPage, setTicketPage] = useState(0);
  const [sendTicketId, setSendTicketId] = useState<string | null>(null);
  const [pdfPreparing, setPdfPreparing] = useState(false);
  const ticketScrollRef = useRef<ScrollView>(null);
  const viewedItemRef = useRef<string | null>(null);
  const requestedTicketId = firstParam(params.ticket);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const purchase = usePurchaseDetail(userId, kind, id);
  const item = purchase.data ?? null;
  const order =
    item?.kind === "order" ? (item.raw as PurchaseOrderRecord) : null;
  const rsvp = item?.kind === "rsvp" ? (item.raw as ConsumerRsvpRow) : null;
  const reservation =
    item?.kind === "reservation" ? (item.raw as MyReservationRow) : null;
  const allTickets = order?.tickets ?? rsvpTickets;
  const sendTicket =
    allTickets.find((ticket) => ticket.id === sendTicketId) ?? null;
  const validTickets = allTickets.filter((ticket) => ticket.status === "valid");
  const ticketPageWidth = Math.max(280, width - 36);
  const ticketQrSize = Math.max(160, Math.min(ticketPageWidth - 64, 360));
  const mapPoint = parseMapPoint(order?.locationGeo);
  const reservationMapPoint =
    typeof reservation?.brand_lat === "number" &&
    typeof reservation.brand_lng === "number"
      ? { lat: reservation.brand_lat, lng: reservation.brand_lng }
      : null;
  const ticketMapsTarget: MapsOpenTarget | null = order?.locationText
    ? { label: order.locationText, geo: mapPoint }
    : reservation?.brand_address
      ? { label: reservation.brand_address, geo: reservationMapPoint }
      : null;
  const ticketMapsActions = useVenueMapsActions({
    target: ticketMapsTarget,
    onOpenMaps: openTicketMapsTarget,
  });
  const reservationCanShow =
    reservation !== null &&
    ["confirmed", "requested", "waitlisted"].includes(reservation.status);
  const reservationDoorTickets = useMemo<PurchaseTicket[]>(
    () =>
      reservation && reservationCanShow
        ? [
            {
              id: reservation.id,
              ticketTypeId: "reservation",
              ticketTypeName: t("pill.reservation"),
              qrCode: `mingla://reservation/${reservation.id}`,
              status: "valid",
              attendeeName: reservation.brand_name,
              attendeeEmail: null,
              eventDateIds: [],
              ticketIndex: 1,
              transferState: "none",
              holderFirstName: null,
            },
          ]
        : [],
    [reservation, reservationCanShow, t],
  );
  const doorTickets =
    validTickets.length > 0 ? validTickets : reservationDoorTickets;
  const followedBrandId =
    order?.brandId ?? rsvp?.brandId ?? reservation?.brand_id ?? null;
  const followedBrandName =
    order?.brandName ?? rsvp?.brandName ?? reservation?.brand_name ?? null;
  const followedBrandSlug =
    order?.brandSlug ?? rsvp?.brandSlug ?? reservation?.brand_slug ?? null;
  const brandFollow = useBrandFollow(userId, followedBrandId);

  useEffect(() => {
    let active = true;
    if (!rsvp || !rsvp.qrCode || rsvp.approvalStatus === "pending") {
      setRsvpTickets([]);
      return () => {
        active = false;
      };
    }
    const fallback: PurchaseTicket = {
      id: rsvp.guestId ?? rsvp.rsvpId,
      ticketTypeId: "rsvp",
      ticketTypeName: t("pill.rsvp"),
      qrCode: rsvp.qrCode,
      status: "valid",
      attendeeName: rsvp.displayName,
      attendeeEmail: null,
      eventDateIds: [],
      ticketIndex: 1,
      transferState: "none",
      holderFirstName: null,
    };
    setRsvpTickets([fallback]);
    void fetchRsvpPartyPasses(rsvp.rsvpId)
      .then((credentials) => {
        if (!active || credentials.length === 0) return;
        setRsvpTickets(
          credentials.flatMap((credential): PurchaseTicket[] =>
            credential.qrCode
              ? [
                  {
                    id: credential.entityId,
                    ticketTypeId: "rsvp",
                    ticketTypeName: t("pill.rsvp"),
                    qrCode: credential.qrCode,
                    status: "valid",
                    attendeeName: credential.displayName,
                    attendeeEmail: null,
                    eventDateIds: [],
                    ticketIndex: 1,
                    transferState: "none",
                    holderFirstName: null,
                  },
                ]
              : [],
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rsvp, t]);

  useEffect(() => {
    if (firstParam(params.door) === "1" && doorTickets.length > 0) {
      setDoorSource("push");
      setDoorVisible(true);
    }
  }, [doorTickets.length, params.door]);

  useEffect(() => {
    if (!item || allTickets.length === 0) return;
    const index = requestedTicketId
      ? Math.max(
          0,
          allTickets.findIndex((ticket) => ticket.id === requestedTicketId),
        )
      : 0;
    setTicketPage(index);
    requestAnimationFrame(() => {
      ticketScrollRef.current?.scrollTo({
        x: index * ticketPageWidth,
        animated: false,
      });
    });
  }, [allTickets.length, item, requestedTicketId, ticketPageWidth]);

  useEffect(() => {
    if (!item || viewedItemRef.current === item.key) return;
    viewedItemRef.current = item.key;
    postHogService.capture("ticket_viewed", {
      kind: item.kind,
      ticket_count: order?.tickets.length ?? rsvpTickets.length,
      source: item.source,
    });
  }, [item, order?.tickets.length, rsvpTickets.length]);

  const handleTicketScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    const next = Math.round(
      event.nativeEvent.contentOffset.x / ticketPageWidth,
    );
    if (next !== ticketPage) {
      setTicketPage(next);
      postHogService.capture("ticket_pager_swiped", {
        kind: item?.kind ?? kind,
        page: next + 1,
      });
    }
  };

  const captureQuietAction = useCallback(
    (action: string): void => {
      postHogService.capture("ticket_quiet_action", {
        action,
        kind: item?.kind ?? kind,
      });
    },
    [item?.kind, kind],
  );

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/purchases");
  };

  const handleOpenChat = useCallback((): void => {
    if (!order?.conversationId) return;
    captureQuietAction("group_chat");
    router.replace({
      pathname: "/",
      params: {
        tab: "messages",
        conversationId: order.conversationId,
        eventId: order.eventId,
      },
    });
  }, [captureQuietAction, order?.conversationId, order?.eventId, router]);

  const handleAddToCalendar = useCallback(async (): Promise<void> => {
    if (!item) return;
    captureQuietAction("add_to_calendar");
    try {
      const permission = await Calendar.requestCalendarPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(t("ticket.addToCalendar"), t("ticket.calendarPermission"));
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT,
      );
      const calendar = calendars.find(
        (candidate) =>
          candidate.allowsModifications &&
          candidate.source?.name !== "Subscribed Calendars",
      );
      if (!calendar) {
        Alert.alert(t("ticket.addToCalendar"), t("ticket.calendarUnavailable"));
        return;
      }
      const startDate = new Date(item.startsAt);
      const parsedEnd = new Date(item.endsAt);
      const endDate =
        Number.isNaN(parsedEnd.getTime()) || parsedEnd <= startDate
          ? new Date(startDate.getTime() + 3 * 60 * 60 * 1000)
          : parsedEnd;
      if (Number.isNaN(startDate.getTime()))
        throw new Error("invalid purchase date");
      const storageKey = `${CALENDAR_EVENT_KEY_PREFIX}${item.kind}:${item.id}`;
      const existingId = await AsyncStorage.getItem(storageKey);
      const details: Partial<Calendar.Event> = {
        title: item.title,
        startDate,
        endDate,
        location: item.venueLine ?? undefined,
        notes: item.brandName ? `From ${item.brandName}` : undefined,
        timeZone: item.timezone,
      };
      if (existingId) {
        try {
          await Calendar.updateEventAsync(existingId, details);
          toastManager.success(t("ticket.calendarUpdated"), 3000);
          return;
        } catch {
          await AsyncStorage.removeItem(storageKey);
        }
      }
      const eventId = await Calendar.createEventAsync(calendar.id, details);
      await AsyncStorage.setItem(storageKey, eventId);
      toastManager.success(t("ticket.calendarAdded"), 3000);
    } catch (error) {
      console.warn("[#4063] add purchase to calendar failed", error);
      toastManager.error(t("ticket.actionFailed"), 3000);
    }
  }, [captureQuietAction, item, t]);

  const handleDownloadPdf = useCallback(async (): Promise<void> => {
    captureQuietAction("download_pdf");
    if (rsvp) {
      setRsvpSheetVisible(true);
      return;
    }
    if (!order?.ticketPdfPath) {
      toastManager.error(t("ticket.pdfUnavailable"), 3000);
      return;
    }
    setPdfPreparing(true);
    try {
      const { signedUrl } = await TicketService.fetchTicketPdfUrl(order.id);
      const localUri = `${FileSystem.cacheDirectory ?? ""}ticket-pdf-${order.id}.pdf`;
      const result = await FileSystem.downloadAsync(signedUrl, localUri);
      if (result.status >= 400)
        throw new Error(`ticket PDF download failed (${result.status})`);
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("sharing unavailable");
      await Sharing.shareAsync(result.uri, {
        mimeType: "application/pdf",
        dialogTitle: t("ticket.downloadPdf"),
        UTI: "com.adobe.pdf",
      });
    } catch (error) {
      console.warn("[#4063] ticket PDF download failed", error);
      toastManager.error(t("ticket.actionFailed"), 3000);
    } finally {
      setPdfPreparing(false);
    }
  }, [captureQuietAction, order, rsvp, t]);

  const handleOpenBrandPage = useCallback((): void => {
    if (!followedBrandSlug) return;
    captureQuietAction("brand_page");
    router.push(`/b/${encodeURIComponent(followedBrandSlug)}` as never);
  }, [captureQuietAction, followedBrandSlug, router]);

  const handleFollowBrand = useCallback((): void => {
    if (!followedBrandId || !followedBrandSlug || brandFollow.isPending) return;
    if (brandFollow.isFollowing) {
      handleOpenBrandPage();
      return;
    }
    captureQuietAction("follow");
    void brandFollow.follow().catch((error) => {
      console.warn("[#4063] purchase brand follow failed", error);
      toastManager.error(t("ticket.actionFailed"), 3000);
    });
  }, [
    brandFollow,
    captureQuietAction,
    followedBrandId,
    followedBrandSlug,
    handleOpenBrandPage,
    t,
  ]);

  const handleOpenEventPage = useCallback((): void => {
    const brandSlug = order?.brandSlug ?? rsvp?.brandSlug ?? null;
    const eventSlug = order?.eventSlug ?? rsvp?.eventSlug ?? null;
    if (!brandSlug || !eventSlug) return;
    captureQuietAction("event_page");
    router.push(
      explorerOfferingPath(order?.eventType, brandSlug, eventSlug) as never,
    );
  }, [captureQuietAction, order, router, rsvp]);

  const openSendTicket = useCallback((ticket: PurchaseTicket): void => {
    postHogService.capture("ticket_send_opened", {
      ticket_index: ticket.ticketIndex,
    });
    setSendTicketId(ticket.id);
  }, []);

  const confirmTakeBack = useCallback(
    (ticket: PurchaseTicket): void => {
      const name = ticket.holderFirstName ?? t("door.guest");
      Alert.alert(
        t("send.takeBack"),
        t("send.takeBackConfirm", { index: ticket.ticketIndex, name }),
        [
          { text: t("send.takeBackNo", { name }), style: "cancel" },
          {
            text: t("send.takeBackYes"),
            style: "destructive",
            onPress: () => {
              void takeBackTicket(ticket.id)
                .then(async () => {
                  postHogService.capture("ticket_taken_back", {
                    ticket_index: ticket.ticketIndex,
                  });
                  await purchase.refetch();
                })
                .catch((reason) => {
                  const tooLate =
                    reason instanceof TicketTransferError &&
                    reason.code === "too_late";
                  toastManager.error(
                    tooLate
                      ? t("send.errorTooLate", { name })
                      : t("send.errorGeneric"),
                    3000,
                  );
                  if (tooLate) void purchase.refetch();
                });
            },
          },
        ],
      );
    },
    [purchase, t],
  );

  const handleManageReservation = useCallback((): void => {
    if (!reservation) return;
    captureQuietAction("manage_booking");
    const canCancel =
      Date.parse(reservation.reserved_for) > Date.now() &&
      ["confirmed", "requested"].includes(reservation.status);
    if (!canCancel) {
      Alert.alert(t("ticket.manageBooking"), t("ticket.bookingNotCancellable"));
      return;
    }
    Alert.alert(
      t("ticket.cancelBookingTitle"),
      t("ticket.cancelBookingBody", {
        venue: reservation.brand_name ?? t("ticket.venueFallback"),
      }),
      [
        { text: t("ticket.keepBooking"), style: "cancel" },
        {
          text: t("ticket.cancelBooking"),
          style: "destructive",
          onPress: () => {
            void cancelMyReservation(reservation.id)
              .then(async () => {
                toastManager.success(t("ticket.bookingCancelled"), 3000);
                await purchase.refetch();
              })
              .catch((error) => {
                console.warn("[#4063] reservation cancellation failed", error);
                toastManager.error(t("ticket.actionFailed"), 3000);
              });
          },
        },
      ],
    );
  }, [captureQuietAction, purchase, reservation, t]);

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("screen.back")}
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {purchase.isLoading ||
        (purchase.awaitingTickets && !purchase.ticketPollingExpired) ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#eb7825" />
            <Text style={styles.loadingText}>
              {purchase.awaitingTickets
                ? t("ticket.loadPending")
                : t("ticket.loading")}
            </Text>
          </View>
        ) : purchase.awaitingTickets && purchase.ticketPollingExpired ? (
          <View style={styles.missing}>
            <Text style={styles.missingTitle}>{t("ticket.loadError")}</Text>
            <Text style={styles.missingBody}>{t("ticket.loadSafe")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void purchase.retryTicketLoad();
              }}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{t("error.retry")}</Text>
            </Pressable>
          </View>
        ) : item === null ? (
          <View style={styles.missing}>
            <Text style={styles.missingTitle}>{t("ticket.notFound")}</Text>
            <Text style={styles.missingBody}>{t("error.body")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void purchase.refetch();
              }}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{t("error.retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.eyebrow}>{purchaseKindLabel(item.kind)}</Text>
            <Text style={styles.title}>{item.title}</Text>
            {item.brandName ? (
              <Text style={styles.brand}>{item.brandName}</Text>
            ) : null}
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>
                {purchaseStatusLabel(item.status)}
              </Text>
            </View>

            {order?.isOnline ? (
              <View style={styles.venueBlock}>
                <Text style={styles.venueText}>{t("ticket.onlineEvent")}</Text>
                {order.onlineUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void Linking.openURL(order.onlineUrl as string);
                    }}
                    style={({ pressed }) => [
                      styles.venueAction,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.venueActionText}>
                      {t("ticket.openLink")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : order?.locationText ? (
              <View style={styles.venueBlock}>
                <Text style={styles.venueText}>{order.locationText}</Text>
                {ticketMapsActions.canOpenMaps ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={ticketMapsActions.requestOpenMaps}
                    style={({ pressed }) => [
                      styles.venueMapsAction,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.venueMapsActionText}>
                      {t("ticket.openInMaps")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : reservation?.brand_address ? (
              <View style={styles.venueBlock}>
                <Text style={styles.venueText}>
                  {reservation.brand_address}
                </Text>
                {ticketMapsActions.canOpenMaps ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={ticketMapsActions.requestOpenMaps}
                    style={({ pressed }) => [
                      styles.venueMapsAction,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.venueMapsActionText}>
                      {t("ticket.openInMaps")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {allTickets.length > 0 ? (
              <View style={styles.passSection}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>
                    {t("ticket.yourTickets")}
                  </Text>
                  <Text style={styles.pageCount}>
                    {t("ticket.pageOf", {
                      index: ticketPage + 1,
                      total: allTickets.length,
                    })}
                  </Text>
                </View>
                <Text style={styles.sectionBody}>
                  {t("ticket.presentCode")}
                </Text>
                <ScrollView
                  ref={ticketScrollRef}
                  decelerationRate="fast"
                  disableIntervalMomentum
                  horizontal
                  onMomentumScrollEnd={handleTicketScroll}
                  pagingEnabled
                  snapToAlignment="start"
                  snapToInterval={ticketPageWidth}
                  showsHorizontalScrollIndicator={false}
                  style={styles.passList}
                >
                  {allTickets.map((ticket, index) => {
                    const statusKey = ticketStatusKey(ticket.status);
                    return (
                      <View
                        key={ticket.id}
                        style={[styles.passCard, { width: ticketPageWidth }]}
                      >
                        <Text style={styles.passNumber}>
                          {t("ticket.pageOf", {
                            index: index + 1,
                            total: allTickets.length,
                          })}
                        </Text>
                        {statusKey === "valid" ? (
                          <View style={styles.qrCard}>
                            <View
                              accessible
                              accessibilityLabel={`${ticket.ticketTypeName ?? t("ticket.admission")}, ${t("ticket.pageOf", { index: index + 1, total: allTickets.length })}`}
                              accessibilityRole="image"
                            >
                              <QRCode
                                value={ticket.qrCode}
                                size={ticketQrSize}
                                backgroundColor="#fff"
                              />
                            </View>
                          </View>
                        ) : (
                          <View style={styles.unavailableQr}>
                            <Text style={styles.unavailableQrText}>
                              {t(`ticket.status.${statusKey}`)}
                            </Text>
                          </View>
                        )}
                        <Text numberOfLines={1} style={styles.ticketType}>
                          {ticket.ticketTypeName ?? t("ticket.admission")}
                        </Text>
                        {ticket.attendeeName ? (
                          <Text numberOfLines={1} style={styles.attendee}>
                            {ticket.attendeeName}
                          </Text>
                        ) : null}
                        <View
                          style={[
                            styles.ticketStatusChip,
                            statusKey === "valid"
                              ? styles.ticketStatusValid
                              : styles.ticketStatusInactive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.ticketStatusText,
                              statusKey === "valid"
                                ? styles.ticketStatusTextValid
                                : styles.ticketStatusTextInactive,
                            ]}
                          >
                            {t(`ticket.status.${statusKey}`)}
                          </Text>
                        </View>
                        {order?.source !== "transfer" &&
                        statusKey === "valid" &&
                        ticket.ticketIndex >= 2 ? (
                          ticket.transferState === "offered" ? (
                            <View style={styles.sendState}>
                              <View style={styles.sentChip}>
                                <Text style={styles.sentChipText}>
                                  {t("send.with", {
                                    name:
                                      ticket.holderFirstName ?? t("door.guest"),
                                  })}
                                </Text>
                              </View>
                              <Text style={styles.sendHint}>
                                {t("send.takeBackHint", {
                                  name:
                                    ticket.holderFirstName ?? t("door.guest"),
                                })}
                              </Text>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => confirmTakeBack(ticket)}
                                style={({ pressed }) => [
                                  styles.sendTextButton,
                                  pressed && styles.pressed,
                                ]}
                              >
                                <Text style={styles.sendTextButtonCopy}>
                                  {t("send.takeBack")}
                                </Text>
                              </Pressable>
                            </View>
                          ) : (
                            <View style={styles.sendState}>
                              <Text style={styles.sendHint}>
                                {t("send.notSent", {
                                  index: ticket.ticketIndex,
                                  total:
                                    order?.ticketStates.length ||
                                    allTickets.length,
                                })}
                              </Text>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => openSendTicket(ticket)}
                                style={({ pressed }) => [
                                  styles.sendButton,
                                  pressed && styles.pressed,
                                ]}
                              >
                                <Text style={styles.sendButtonCopy}>
                                  {t("send.cta")}
                                </Text>
                              </Pressable>
                            </View>
                          )
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
                {allTickets.length > 1 ? (
                  <View style={styles.dots}>
                    {allTickets.map((ticket, index) => (
                      <View
                        key={`dot:${ticket.id}`}
                        style={[
                          styles.dot,
                          index === ticketPage && styles.dotActive,
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
                {order?.source !== "transfer"
                  ? order?.ticketStates
                      .filter((state) => state.transferState === "claimed")
                      .map((state) => (
                        <View
                          key={`claimed:${state.ticketId}`}
                          style={styles.claimedNote}
                        >
                          <Text style={styles.claimedNoteTitle}>
                            {t("ticket.status.sentOpened", {
                              name: state.holderFirstName ?? t("door.guest"),
                            })}
                          </Text>
                          <Text style={styles.claimedNoteBody}>
                            {t("send.claimedNote", {
                              name: state.holderFirstName ?? t("door.guest"),
                            })}
                          </Text>
                        </View>
                      ))
                  : null}
                {validTickets.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setDoorSource("button");
                      setDoorVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles.doorButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.doorButtonText}>
                      {t("ticket.showAtDoor")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {reservation && reservationCanShow ? (
              <View style={styles.passSection}>
                <Text style={styles.sectionTitle}>
                  {t("ticket.bookingPass")}
                </Text>
                <Text style={styles.sectionBody}>
                  {t("ticket.bookingPassHint")}
                </Text>
                <View style={styles.reservationQrCard}>
                  <View
                    accessible
                    accessibilityLabel={t("ticket.bookingQrLabel", {
                      venue:
                        reservation.brand_name ?? t("ticket.venueFallback"),
                    })}
                    accessibilityRole="image"
                  >
                    <QRCode
                      backgroundColor="#fff"
                      size={ticketQrSize}
                      value={`mingla://reservation/${reservation.id}`}
                    />
                  </View>
                  <Text style={styles.reservationRef}>
                    RES-
                    {reservation.id
                      .replaceAll("-", "")
                      .slice(0, 6)
                      .toUpperCase()}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setDoorSource("button");
                    setDoorVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.doorButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.doorButtonText}>
                    {t("ticket.showAtVenue")}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>{t("link.details")}</Text>
              {detailRows(item, t).map(([label, value], index, rows) => (
                <View
                  key={label}
                  style={[
                    styles.detailRow,
                    index < rows.length - 1 && styles.detailDivider,
                  ]}
                >
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text selectable style={styles.detailValue}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>

            {order?.lineItems.length ? (
              <View style={styles.detailCard}>
                <Text style={styles.sectionTitle}>{t("ticket.receipt")}</Text>
                {order.lineItems.map((line, index) => (
                  <View
                    key={line.id}
                    style={[
                      styles.detailRow,
                      index < order.lineItems.length - 1 &&
                        styles.detailDivider,
                    ]}
                  >
                    <Text style={styles.detailLabel}>
                      {line.quantity} ×{" "}
                      {line.ticketTypeName ?? t("ticket.ticket")}
                    </Text>
                    <Text style={styles.detailValue}>
                      {moneyOrFree(
                        line.totalCents,
                        item.currency ?? "USD",
                        t("ticket.free"),
                      )}
                    </Text>
                  </View>
                ))}
                {order.discountCents > 0 ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {t("ticket.discountLine", { name: t("ticket.discount") })}
                    </Text>
                    <Text style={styles.detailValue}>
                      −
                      {moneyOrFree(
                        order.discountCents,
                        item.currency ?? "USD",
                        t("ticket.free"),
                      )}
                    </Text>
                  </View>
                ) : null}
                {order.buyerFeesCents + order.taxCents > 0 ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {t("ticket.feesTax")}
                    </Text>
                    <Text style={styles.detailValue}>
                      {moneyOrFree(
                        order.buyerFeesCents + order.taxCents,
                        item.currency ?? "USD",
                        t("ticket.free"),
                      )}
                    </Text>
                  </View>
                ) : null}
                {order.buyerTotalCents > 0 ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t("ticket.paid")}</Text>
                    <Text style={styles.detailValue}>
                      {moneyOrFree(
                        order.buyerTotalCents,
                        item.currency ?? "USD",
                        t("ticket.free"),
                      )}
                    </Text>
                  </View>
                ) : null}
                {order.refundedAmountCents > 0 ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {t("ticket.details.refund")}
                    </Text>
                    <Text style={styles.detailValue}>
                      −
                      {moneyOrFree(
                        order.refundedAmountCents,
                        item.currency ?? "USD",
                        t("ticket.free"),
                      )}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.orderLine}>
                  {cardDisplay(order)
                    ? t("ticket.orderLine", {
                        ref: order.id
                          .replaceAll("-", "")
                          .slice(0, 8)
                          .toUpperCase(),
                        card: cardDisplay(order),
                        date: new Date(order.createdAt).toLocaleDateString(),
                      })
                    : t("ticket.orderLineNoCard", {
                        ref: order.id
                          .replaceAll("-", "")
                          .slice(0, 8)
                          .toUpperCase(),
                        date: new Date(order.createdAt).toLocaleDateString(),
                      })}
                </Text>
              </View>
            ) : null}

            {order ? (
              <EarnBySharingCard
                compact
                listingId={order.eventId}
                listingKind="event"
                title={item.title}
              />
            ) : null}

            <View style={styles.quietList}>
              {(order?.brandSlug && order.eventSlug) ||
              (rsvp?.brandSlug && rsvp.eventSlug) ? (
                <QuietAction
                  icon="information-circle-outline"
                  label={t("ticket.openEventPage")}
                  onPress={handleOpenEventPage}
                />
              ) : null}
              {order?.conversationId ? (
                <QuietAction
                  icon="chatbubbles-outline"
                  label={t("ticket.groupChat")}
                  onPress={handleOpenChat}
                />
              ) : null}
              <QuietAction
                icon="calendar-outline"
                label={t("ticket.addToCalendar")}
                onPress={() => {
                  void handleAddToCalendar();
                }}
              />
              {order || rsvp ? (
                <QuietAction
                  disabled={pdfPreparing}
                  icon="download-outline"
                  label={
                    pdfPreparing
                      ? t("ticket.preparingPdf")
                      : t("ticket.downloadPdf")
                  }
                  onPress={() => {
                    void handleDownloadPdf();
                  }}
                />
              ) : null}
              {followedBrandId && followedBrandName && followedBrandSlug ? (
                <QuietAction
                  disabled={brandFollow.isPending}
                  icon={
                    brandFollow.isFollowing
                      ? "checkmark-circle-outline"
                      : "add-circle-outline"
                  }
                  label={t(
                    brandFollow.isFollowing
                      ? "ticket.following"
                      : "ticket.follow",
                    {
                      brand: followedBrandName,
                    },
                  )}
                  onPress={handleFollowBrand}
                />
              ) : null}
              {reservation ? (
                <QuietAction
                  icon="settings-outline"
                  label={t("ticket.manageBooking")}
                  onPress={handleManageReservation}
                />
              ) : null}
              {rsvp ? (
                <QuietAction
                  icon="create-outline"
                  label={t("ticket.manageRsvp")}
                  onPress={() => {
                    captureQuietAction("manage_rsvp");
                    setRsvpSheetVisible(true);
                  }}
                />
              ) : null}
              {order && followedBrandSlug ? (
                <QuietAction
                  icon="help-circle-outline"
                  label={t("ticket.refundsHelp")}
                  onPress={() => {
                    captureQuietAction("refunds_help");
                    handleOpenBrandPage();
                  }}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <MapsAppChooserDialog
        actions={ticketMapsActions}
        palette={TICKET_MAPS_PALETTE}
        placeLabel={ticketMapsTarget?.label}
      />
      {item && doorTickets.length > 0 ? (
        <DoorModeModal
          initialTicketId={requestedTicketId}
          onClose={() => setDoorVisible(false)}
          source={doorSource}
          subtitle={
            formatTicketTimeLine(
              item.startsAt,
              item.timezone,
              item.venueLine,
            ) ?? t("ticket.readyToScan")
          }
          tickets={doorTickets}
          title={item.title}
          visible={doorVisible}
        />
      ) : null}
      {rsvp ? (
        <RsvpPassSheet
          onClose={() => setRsvpSheetVisible(false)}
          row={rsvp}
          visible={rsvpSheetVisible}
        />
      ) : null}
      <SendTicketSheet
        onClose={() => setSendTicketId(null)}
        onSent={async () => {
          await purchase.refetch();
        }}
        ticket={sendTicket}
        total={order?.ticketStates.length || allTickets.length}
        visible={sendTicket !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0b0d11" },
  content: { paddingHorizontal: 18 },
  back: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  backText: { color: "#fff", fontSize: 31, lineHeight: 33, marginTop: -3 },
  pressed: { opacity: 0.68 },
  loading: { alignItems: "center", paddingVertical: 80, gap: 12 },
  loadingText: { color: "rgba(255,255,255,0.62)", fontSize: 14 },
  eyebrow: {
    color: "#eb7825",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 18,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    marginTop: 7,
  },
  brand: { color: "rgba(255,255,255,0.64)", fontSize: 16, marginTop: 5 },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(235,120,37,0.14)",
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginTop: 16,
  },
  statusText: { color: "#f8a35f", fontSize: 12, fontWeight: "800" },
  venueBlock: {
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    marginTop: 18,
    gap: 10,
  },
  venueText: { color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 20 },
  venueAction: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  venueActionText: { color: "#f8a35f", fontSize: 13, fontWeight: "800" },
  venueMapsAction: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#eb7825",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  venueMapsActionText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  passSection: { marginTop: 32 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pageCount: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: { color: "#fff", fontSize: 19, fontWeight: "800" },
  sectionBody: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  passList: { paddingTop: 14 },
  passCard: {
    alignItems: "center",
    borderRadius: 24,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 18,
  },
  passNumber: {
    color: "#eb7825",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  qrCard: {
    borderRadius: 18,
    backgroundColor: "#fff",
    padding: 14,
    marginTop: 14,
  },
  reservationQrCard: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 20,
    backgroundColor: "#fff",
    padding: 18,
    marginTop: 16,
  },
  reservationRef: {
    color: "#15181f",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 12,
  },
  unavailableQr: {
    width: "100%",
    minHeight: 210,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  unavailableQrText: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 18,
    fontWeight: "800",
  },
  ticketType: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 14 },
  attendee: { color: "rgba(255,255,255,0.58)", fontSize: 13, marginTop: 3 },
  ticketStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 12,
  },
  ticketStatusValid: { backgroundColor: "rgba(34,197,94,0.15)" },
  ticketStatusInactive: { backgroundColor: "rgba(239,68,68,0.14)" },
  ticketStatusText: { fontSize: 12, fontWeight: "800" },
  ticketStatusTextValid: { color: "#86efac" },
  ticketStatusTextInactive: { color: "#fca5a5" },
  sendState: { width: "100%", alignItems: "center", marginTop: 14 },
  sendHint: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  sendButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    marginTop: 10,
  },
  sendButtonCopy: { color: "#f8a35f", fontSize: 14, fontWeight: "800" },
  sentChip: {
    borderRadius: 999,
    backgroundColor: "rgba(235,120,37,0.16)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 8,
  },
  sentChipText: { color: "#f8a35f", fontSize: 12, fontWeight: "800" },
  sendTextButton: { minHeight: 40, justifyContent: "center", marginTop: 4 },
  sendTextButtonCopy: { color: "#f8a35f", fontSize: 13, fontWeight: "800" },
  claimedNote: {
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 13,
    marginTop: 12,
  },
  claimedNoteTitle: { color: "#f8a35f", fontSize: 13, fontWeight: "800" },
  claimedNoteBody: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  dots: { flexDirection: "row", alignSelf: "center", gap: 7, marginTop: 14 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  dotActive: { width: 18, backgroundColor: "#eb7825" },
  doorButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  doorButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  detailCard: {
    borderRadius: 22,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 4,
    marginTop: 24,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 18,
    paddingVertical: 14,
  },
  detailDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  detailLabel: { flex: 1, color: "rgba(255,255,255,0.55)", fontSize: 13 },
  detailValue: {
    flex: 1.45,
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  orderLine: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 14,
  },
  quietList: {
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
    marginTop: 24,
  },
  quietAction: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  quietActionDisabled: { opacity: 0.5 },
  quietActionText: {
    flex: 1,
    color: "rgba(255,255,255,0.70)",
    fontSize: 14,
    fontWeight: "600",
  },
  quietActionChevron: { color: "rgba(255,255,255,0.28)", fontSize: 24 },
  missing: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#171a20",
    padding: 26,
    marginTop: 40,
  },
  missingTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  missingBody: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  retry: {
    alignSelf: "flex-start",
    borderRadius: 14,
    backgroundColor: "#eb7825",
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 20,
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
