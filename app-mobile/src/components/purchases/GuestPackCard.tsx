/**
 * #4548 — the host's Guest pack on a ticket or RSVP pass: a note guests can
 * select and copy, then one row per link in the host's order. Shown below the
 * venue block on the order ticket screen, the shared purchase detail and the
 * RSVP pass sheet.
 *
 * Renders NOTHING (never a skeleton or an error) when: the booking is refunded,
 * cancelled or pending; the read returns null; the read fails (logged); or it
 * is more than 24 hours after the event ended (the server does not enforce that
 * cut-off, so it is applied here from the event's end time). Links open only
 * through the in-app opener, after a connection check.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../../store/appStore";
import { useMyEventGuestPack } from "../../hooks/useMyEventGuestPack";
import { isOnline } from "../../services/networkMonitor";
import {
  guestPackRowKind,
  guestPackSite,
  hasGuestPackContent,
  isGuestPackUpdatedAfter,
  isGuestPackWindowOpen,
  openableGuestPackItems,
} from "../../utils/guestPackDisplay";
import { classifyLink } from "../../utils/inAppLink";
import { useOpenInMingla } from "../InAppBrowserProvider";
import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";

export interface GuestPackCardProps {
  eventId: string | null;
  /** The caller's booking rule (not refunded, cancelled or pending). */
  eligible: boolean;
  startsAtIso?: string | null;
  endsAtIso?: string | null;
  /** When the booking was made; "Updated <date>" shows when the pack changed after it. */
  bookedAtIso?: string | null;
  /** RSVP passes say "approved guests" in the footer. */
  audience?: "ticket" | "rsvp";
}

export function GuestPackCard({
  eventId,
  eligible,
  startsAtIso = null,
  endsAtIso = null,
  bookedAtIso = null,
  audience = "ticket",
}: GuestPackCardProps): React.ReactElement | null {
  const { t, i18n } = useTranslation("purchases");
  const userId = useAppStore((state) => state.user?.id ?? null);
  const open = useOpenInMingla().open;
  const windowOpen = isGuestPackWindowOpen({ endsAtIso, startsAtIso });
  const query = useMyEventGuestPack(userId, eventId, eligible && windowOpen);
  const [offlineKey, setOfflineKey] = useState<string | null>(null);

  const pack = query.data ?? null;
  const items = useMemo(
    () =>
      pack === null
        ? []
        : openableGuestPackItems(pack.items, classifyLink, (item) =>
            console.warn("[guest-pack] hidden link that failed classifyLink", item.url),
          ),
    [pack],
  );

  const onRowPress = useCallback(
    async (url: string, label: string, key: string): Promise<void> => {
      let online = true;
      try {
        online = await isOnline();
      } catch (error) {
        console.warn("[guest-pack] connection check failed; trying to open", error);
      }
      if (!online) {
        setOfflineKey(key);
        return;
      }
      setOfflineKey(null);
      open(url, label);
    },
    [open],
  );

  if (!eligible || !windowOpen || eventId === null) return null;
  if (pack === null || !hasGuestPackContent(pack.note, items)) return null;

  const updated =
    pack.updatedAt !== null && isGuestPackUpdatedAfter(pack.updatedAt, bookedAtIso)
      ? new Date(pack.updatedAt).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "short",
        })
      : null;

  return (
    <View style={styles.card} testID="guest-pack-card">
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("guestPack.title")}
        </Text>
        {updated !== null ? (
          <View style={styles.updatedPill}>
            <Text style={styles.updatedText}>{t("guestPack.updated", { date: updated })}</Text>
          </View>
        ) : null}
      </View>

      {pack.note !== null ? (
        <Text selectable style={styles.note} testID="guest-pack-note">
          {pack.note}
        </Text>
      ) : null}

      {items.map((item, index) => {
        const kind = guestPackRowKind(item.url);
        const key = `${index}:${item.url}`;
        return (
          <View key={key}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                kind === "pdf"
                  ? t("guestPack.rowPdfLabel", { label: item.label })
                  : t("guestPack.rowPageLabel", { label: item.label })
              }
              onPress={() => {
                void onRowPress(item.url, item.label, key);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`guest-pack-row-${index}`}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text numberOfLines={1} style={styles.rowSite}>
                  {guestPackSite(item.url)}
                </Text>
              </View>
              <View style={styles.rowAction}>
                <Text style={styles.rowActionText}>
                  {kind === "pdf" ? t("guestPack.openPdf") : t("guestPack.open")}
                </Text>
              </View>
            </Pressable>
            {offlineKey === key ? (
              <Text accessibilityLiveRegion="polite" style={styles.offline}>
                {t("guestPack.offline")}
              </Text>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.footer}>
        {audience === "rsvp" ? t("guestPack.footerRsvp") : t("guestPack.footer")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { color: C.text, fontSize: 16, fontWeight: "800" },
  updatedPill: {
    backgroundColor: C.tabSelected,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  updatedText: { color: C.textSecondary, fontSize: 12, fontWeight: "700" },
  note: { color: C.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  row: {
    alignItems: "center",
    backgroundColor: C.field,
    borderColor: C.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.8 },
  rowCopy: { flex: 1 },
  rowLabel: { color: C.text, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowSite: { color: C.textMeta, fontSize: 12, marginTop: 2 },
  rowAction: {
    alignItems: "center",
    backgroundColor: C.tabSelected,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: 14,
  },
  rowActionText: { color: C.text, fontSize: 13, fontWeight: "800" },
  offline: { color: C.textLabel, fontSize: 12, lineHeight: 17, marginTop: 6, paddingHorizontal: 4 },
  footer: { color: C.textMeta, fontSize: 12, lineHeight: 17, marginTop: 12 },
});
