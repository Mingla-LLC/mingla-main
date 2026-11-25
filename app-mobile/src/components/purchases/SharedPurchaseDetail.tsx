/**
 * #4473 — a purchase shown on this account because it proved the contact the
 * purchase was made with. Read-only by Seth's decision:
 *
 *   shows   the in-app QR (tickets this account can present, the RSVP pass,
 *           the booking pass), Show at the door, dates, place, the event page,
 *           the group chat and Add to calendar;
 *   never   Send to a friend, Take back, cancel, refund, intake, "show me as
 *           going", the PDF download, amounts, the card or the buyer's
 *           contact (the server does not send them, and nothing here asks).
 *
 * PurchaseShareNote is also used on the BUYER's own purchase when it shows on
 * another account too.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle, Path } from "react-native-svg";

import { DoorModeModal } from "./DoorModeModal";
import { GuestPackCard } from "./GuestPackCard";
import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";
import type { PurchaseTicket } from "../../services/purchasesService";
import {
  fetchEventConversationId,
  sharedPresentableTickets,
  type SharedPurchase,
} from "../../services/sharedPurchasesService";
import {
  isOrderGuestPackEligible,
  isRsvpGuestPackEligible,
} from "../../utils/guestPackDisplay";
import {
  purchaseKindLabel,
  purchaseStatusLabel,
} from "../../utils/purchasePresentation";
import type {
  PurchaseKind,
  PurchaseTimelineItem,
} from "../../utils/purchaseTimeline";
import { formatTicketTimeLine } from "../../utils/zoneLabel";

/** The note's wording per kind: only tickets and RSVP passes claim a QR. */
const NOTE_KIND: Record<PurchaseKind, string> = {
  order: "ticket",
  rsvp: "rsvp",
  reservation: "reservation",
  stay: "stay",
  venue_order: "venue_order",
  // #4490 Explorer W2 — venue items are never shared (decision 4); the
  // owner-side note reads as a booking if one ever carries a flag.
  venue_booking: "reservation",
  venue_membership: "reservation",
  venue_waitlist: "reservation",
};

export function PurchaseShareNote({
  variant,
  kind,
}: {
  variant: "owner" | "shared";
  kind: PurchaseKind;
}): React.ReactElement {
  const { t } = useTranslation("purchases");
  return (
    <View
      accessibilityRole="text"
      style={styles.note}
      testID={`purchase-share-note-${variant}`}
    >
      <Svg height={18} style={styles.noteIcon} viewBox="0 0 24 24" width={18}>
        <Circle cx={12} cy={12} fill="none" r={9} stroke={C.infoIcon} strokeWidth={2} />
        <Path d="M12 11v6M12 7.5v.5" stroke={C.infoIcon} strokeLinecap="round" strokeWidth={2.2} />
      </Svg>
      <View style={styles.noteCopy}>
        <Text style={styles.noteText}>
          {variant === "owner"
            ? t(`shared.ownerNote.${NOTE_KIND[kind]}`)
            : t(`shared.note.${NOTE_KIND[kind]}`)}
        </Text>
        {variant === "shared" ? (
          <Text style={styles.noteSub}>{t("shared.readOnly")}</Text>
        ) : null}
      </View>
    </View>
  );
}

const RESERVATION_PASS_STATES = new Set(["confirmed", "requested", "waitlisted"]);

/** The passes this account may present for a shared purchase. */
export function sharedPasses(
  item: PurchaseTimelineItem,
  labels: { rsvp: string; reservation: string; admission: string },
): PurchaseTicket[] {
  const purchase = item.raw as SharedPurchase;
  const pass = (
    id: string,
    qrCode: string,
    name: string,
    index: number,
  ): PurchaseTicket => ({
    id,
    ticketTypeId: purchase.kind,
    ticketTypeName: name,
    qrCode,
    status: "valid",
    attendeeName: null,
    attendeeEmail: null,
    eventDateIds: [],
    ticketIndex: index,
    transferState: "none",
    holderFirstName: null,
  });
  if (purchase.kind === "order") {
    return sharedPresentableTickets(purchase).map((ticket) => ({
      ...pass(
        ticket.id,
        ticket.qrCode as string,
        ticket.ticketTypeName ?? labels.admission,
        ticket.ticketIndex,
      ),
      status: ticket.status,
      eventDateIds: ticket.eventDateIds,
    }));
  }
  if (purchase.kind === "rsvp" || purchase.kind === "rsvp_guest") {
    return purchase.qrCode && purchase.approvalStatus !== "pending"
      ? [pass(purchase.sourceId, purchase.qrCode, labels.rsvp, 1)]
      : [];
  }
  if (purchase.kind === "reservation") {
    const id = purchase.reservationId ?? purchase.sourceId;
    return RESERVATION_PASS_STATES.has(purchase.status ?? "confirmed")
      ? [pass(id, `mingla://reservation/${id}`, labels.reservation, 1)]
      : [];
  }
  return [];
}

export function SharedPurchaseDetail({
  item,
  qrSize,
  onAddToCalendar,
  onOpenEventPage,
  onOpenChat,
}: {
  item: PurchaseTimelineItem;
  qrSize: number;
  onAddToCalendar: () => void;
  onOpenEventPage: (purchase: SharedPurchase) => void;
  onOpenChat: (conversationId: string, eventId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation("purchases");
  const purchase = item.raw as SharedPurchase;
  const [doorVisible, setDoorVisible] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const passes = useMemo(
    () =>
      sharedPasses(item, {
        rsvp: t("pill.rsvp"),
        reservation: t("pill.reservation"),
        admission: t("ticket.admission"),
      }),
    [item, t],
  );
  const validPasses = passes.filter((ticket) => ticket.status === "valid");

  useEffect(() => {
    let active = true;
    setConversationId(null);
    if (!purchase.eventId) return undefined;
    void fetchEventConversationId(purchase.eventId)
      .then((id) => {
        if (active) setConversationId(id);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [purchase.eventId]);

  const isStay = purchase.kind === "stay_group";
  // A stay is listed by when it was shared, which is not when it happens.
  const timeLine = isStay
    ? null
    : formatTicketTimeLine(item.startsAt, item.timezone, null);
  const place = purchase.isOnline
    ? t("ticket.onlineEvent")
    : purchase.locationText ?? purchase.venueName ?? null;
  const canOpenEvent = !!(purchase.brand?.slug && purchase.eventSlug);

  return (
    <View testID="shared-purchase-detail">
      <Text style={styles.eyebrow}>{purchaseKindLabel(item.kind)}</Text>
      <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
      {item.brandName &&
      item.brandName.trim().toLowerCase() !== item.title.trim().toLowerCase() ? (
        <Text style={styles.brand}>{item.brandName}</Text>
      ) : null}
      <View style={styles.pills}>
        <View style={styles.statusPill}>
          <Text style={styles.statusText}>{purchaseStatusLabel(item.status)}</Text>
        </View>
        <View style={styles.sharedPill}>
          <Text style={styles.sharedPillText}>{t("shared.badge")}</Text>
        </View>
      </View>
      <PurchaseShareNote kind={item.kind} variant="shared" />

      {passes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} testID="shared-pass-title">
            {item.kind === "reservation"
              ? t("shared.passTitle.reservation")
              : item.kind === "rsvp"
              ? t("shared.passTitle.rsvp")
              : t("ticket.yourTickets")}
          </Text>
          <Text style={styles.sectionBody}>
            {item.kind === "reservation"
              ? t("ticket.bookingPassHint")
              : t("ticket.presentCode")}
          </Text>
          {passes.map((ticket, index) => (
            <View key={ticket.id} style={styles.passCard} testID={`shared-pass-${ticket.id}`}>
              <Text style={styles.passNumber}>
                {t("ticket.pageOf", { index: index + 1, total: passes.length })}
              </Text>
              {ticket.status === "valid" ? (
                <View
                  accessible
                  accessibilityLabel={`${ticket.ticketTypeName ?? t("ticket.admission")}, ${t("ticket.pageOf", { index: index + 1, total: passes.length })}`}
                  accessibilityRole="image"
                  style={styles.qr}
                >
                  <QRCode backgroundColor="#fff" size={qrSize} value={ticket.qrCode} />
                </View>
              ) : (
                <Text style={styles.inactive}>{purchaseStatusLabel(ticket.status)}</Text>
              )}
              <Text numberOfLines={1} style={styles.passType}>
                {ticket.ticketTypeName ?? t("ticket.admission")}
              </Text>
            </View>
          ))}
          {validPasses.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDoorVisible(true)}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              testID="shared-show-at-door"
            >
              <Text style={styles.primaryText}>
                {item.kind === "reservation" ? t("ticket.showAtVenue") : t("ticket.showAtDoor")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : purchase.kind === "venue_order" && purchase.pickupCode ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("shared.pickupCode")}</Text>
          <Text selectable style={styles.pickup}>{purchase.pickupCode}</Text>
        </View>
      ) : null}

      <View style={styles.detailCard}>
        <Text style={styles.sectionTitle}>{t("link.details")}</Text>
        {timeLine ? <DetailRow label={t("shared.when")} value={timeLine} /> : null}
        {place ? <DetailRow label={t("shared.where")} value={place} /> : null}
        {item.kind === "reservation" ? (
          <DetailRow label={t("shared.party")} value={String(purchase.partySize)} />
        ) : null}
        {isStay && purchase.publicReference ? (
          <DetailRow label={t("shared.reference")} value={purchase.publicReference} />
        ) : null}
        {isStay && purchase.state ? (
          <DetailRow label={t("shared.state")} value={purchaseStatusLabel(purchase.state)} />
        ) : null}
        {isStay && purchase.mode ? (
          <DetailRow label={t("shared.mode")} value={purchaseStatusLabel(purchase.mode)} />
        ) : null}
      </View>

      {/* #4548 — the host's Guest pack, below the venue (Where) block. */}
      {purchase.kind === "order" || purchase.kind === "rsvp" || purchase.kind === "rsvp_guest" ? (
        <GuestPackCard
          audience={purchase.kind === "order" ? "ticket" : "rsvp"}
          bookedAtIso={purchase.createdAt}
          endsAtIso={purchase.endsAt}
          eventId={purchase.eventId}
          eligible={
            purchase.kind === "order"
              ? isOrderGuestPackEligible({
                  paymentStatus: purchase.paymentStatus,
                  cancelledAt: purchase.cancelledAt,
                })
              : isRsvpGuestPackEligible({
                  status: purchase.rsvpStatus,
                  approvalStatus: purchase.approvalStatus,
                })
          }
          startsAtIso={purchase.startsAt}
        />
      ) : null}

      <View style={styles.actions}>
        {canOpenEvent ? (
          <QuietButton
            label={t("ticket.openEventPage")}
            onPress={() => onOpenEventPage(purchase)}
            testID="shared-open-event"
          />
        ) : null}
        {conversationId && purchase.eventId ? (
          <QuietButton
            label={t("ticket.groupChat")}
            onPress={() => onOpenChat(conversationId, purchase.eventId as string)}
            testID="shared-open-chat"
          />
        ) : null}
        {isStay ? null : (
          <QuietButton
            label={t("ticket.addToCalendar")}
            onPress={onAddToCalendar}
            testID="shared-add-to-calendar"
          />
        )}
      </View>

      {validPasses.length > 0 ? (
        <DoorModeModal
          onClose={() => setDoorVisible(false)}
          source="button"
          subtitle={
            formatTicketTimeLine(item.startsAt, item.timezone, item.venueLine) ??
              t("ticket.readyToScan")
          }
          tickets={validPasses}
          title={item.title}
          visible={doorVisible}
        />
      ) : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function QuietButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.quietText}>{label}</Text>
      <Text aria-hidden style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.infoBorder,
    backgroundColor: C.infoFill,
  },
  noteIcon: { marginTop: 1 },
  noteCopy: { flex: 1, gap: 4 },
  noteText: { color: C.infoText, fontSize: 13, lineHeight: 19 },
  noteSub: { color: "rgba(219,234,254,0.78)", fontSize: 12, lineHeight: 17 },
  eyebrow: {
    color: C.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 18,
  },
  title: { color: C.text, fontSize: 22, lineHeight: 28, fontWeight: "800", marginTop: 7 },
  brand: { color: "rgba(255,255,255,0.64)", fontSize: 16, marginTop: 5 },
  pills: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  statusPill: {
    borderRadius: 999,
    backgroundColor: "rgba(235,120,37,0.14)",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  statusText: { color: "#f8a35f", fontSize: 12, fontWeight: "800" },
  sharedPill: {
    borderRadius: 999,
    backgroundColor: "rgba(59,130,246,0.16)",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  sharedPillText: { color: "#bfdbfe", fontSize: 12, fontWeight: "800" },
  section: { marginTop: 24, gap: 10 },
  sectionTitle: { color: C.text, fontSize: 19, fontWeight: "800" },
  sectionBody: { color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 20 },
  passCard: {
    alignItems: "center",
    gap: 10,
    padding: 18,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  passNumber: { color: "rgba(255,255,255,0.56)", fontSize: 12, fontWeight: "700" },
  qr: { padding: 14, borderRadius: 18, backgroundColor: "#fff" },
  inactive: { color: "rgba(255,255,255,0.62)", fontSize: 15, paddingVertical: 30 },
  passType: { color: C.text, fontSize: 15, fontWeight: "700" },
  pickup: { color: C.text, fontSize: 32, fontWeight: "800", letterSpacing: 2 },
  primary: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  detailCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  detailLabel: { flex: 1, color: "rgba(255,255,255,0.55)", fontSize: 13 },
  detailValue: { flex: 2, color: C.text, fontSize: 13, textAlign: "right" },
  actions: { marginTop: 20, gap: 8 },
  quiet: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  quietText: { flex: 1, color: C.text, fontSize: 15, fontWeight: "600" },
  chevron: { color: "rgba(255,255,255,0.34)", fontSize: 24 },
});
