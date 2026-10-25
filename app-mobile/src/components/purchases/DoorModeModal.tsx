import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";

import type { PurchaseTicket } from "../../services/purchasesService";
import { postHogService } from "../../services/postHogService";

type Props = {
  visible: boolean;
  title: string;
  subtitle: string;
  tickets: PurchaseTicket[];
  initialTicketId?: string | null;
  source?: "button" | "push";
  onClose: () => void;
};

export function DoorModeModal({
  visible,
  title,
  subtitle,
  tickets,
  initialTicketId,
  source = "button",
  onClose,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const openedAtRef = useRef<number | null>(null);
  const pageWidth = width;
  const qrSize = Math.max(180, Math.min(width - 72, height * 0.46));

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) return;
    openedAtRef.current = Date.now();
    postHogService.capture("ticket_door_opened", {
      ticket_count: tickets.length,
      from: source,
    });
    void activateKeepAwakeAsync("door-mode").catch(() => undefined);
    return () => {
      void deactivateKeepAwake("door-mode").catch(() => undefined);
      const openedAt = openedAtRef.current;
      if (openedAt !== null) {
        postHogService.capture("ticket_door_closed", {
          seconds_open: Math.max(0, Math.round((Date.now() - openedAt) / 1000)),
        });
      }
      openedAtRef.current = null;
    };
  }, [source, tickets.length, visible]);

  useEffect(() => {
    if (!visible) return;
    const index = initialTicketId
      ? Math.max(
          0,
          tickets.findIndex((ticket) => ticket.id === initialTicketId),
        )
      : 0;
    setPage(index);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: index * pageWidth, animated: false });
    });
  }, [initialTicketId, pageWidth, tickets, visible]);

  return (
    <Modal
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <View style={styles.host}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("door.close")}
          hitSlop={10}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          <Text numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          accessibilityRole="adjustable"
          horizontal
          onMomentumScrollEnd={(event) => {
            setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
          }}
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
        >
          {tickets.map((ticket, index) => (
            <View
              accessibilityLabel={`Ticket QR code for ${ticket.attendeeName ?? t("door.guest")}, ticket ${index + 1} of ${tickets.length}`}
              accessibilityRole="image"
              key={ticket.id}
              style={[styles.page, { width: pageWidth }]}
            >
              <View style={styles.qrCard}>
                <QRCode
                  backgroundColor="#fff"
                  ecl="M"
                  size={qrSize}
                  value={ticket.qrCode}
                />
              </View>
              <Text numberOfLines={1} style={styles.holder}>
                {ticket.attendeeName ?? t("door.guest")}
              </Text>
              <Text style={styles.ticketLine}>
                {t("door.ticketLine", {
                  ticketType: ticket.ticketTypeName ?? t("door.admission"),
                  index: index + 1,
                  total: tickets.length,
                })}
              </Text>
              <View style={styles.validPill}>
                <Text style={styles.validText}>{t("ticket.status.valid")}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          {tickets.length > 1 && page < tickets.length - 1 ? (
            <Text style={styles.pageHint}>
              {t("ticket.pageOf", { index: page + 1, total: tickets.length })} ·{" "}
              {t("door.swipeNext", { next: page + 2 })}
            </Text>
          ) : null}
          <Text style={styles.awakeHint}>{t("door.awake")}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#fff", paddingTop: 54 },
  close: {
    position: "absolute",
    zIndex: 2,
    top: 48,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f2f2",
  },
  closeText: { color: "#15181f", fontSize: 30, lineHeight: 32 },
  pressed: { opacity: 0.55 },
  heading: { alignItems: "center", paddingHorizontal: 70, minHeight: 86 },
  title: {
    color: "#15181f",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: "#5b6068",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 5,
  },
  pager: { flexGrow: 0 },
  page: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  qrCard: { backgroundColor: "#fff", padding: 16 },
  holder: {
    color: "#15181f",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 14,
    paddingHorizontal: 20,
  },
  ticketLine: { color: "#646971", fontSize: 14, marginTop: 5 },
  validPill: {
    borderRadius: 999,
    backgroundColor: "#dff6e8",
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginTop: 10,
  },
  validText: { color: "#197342", fontSize: 12, fontWeight: "800" },
  footer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 28,
    marginTop: "auto",
  },
  pageHint: { color: "#353a42", fontSize: 13, fontWeight: "700" },
  awakeHint: {
    color: "#777d86",
    fontSize: 12,
    textAlign: "center",
    marginTop: 7,
  },
});
