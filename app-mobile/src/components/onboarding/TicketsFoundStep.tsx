import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { ClaimedEntry } from "../../services/attendanceClaimService";
import { AddIdentitySheet } from "../purchases/AddIdentitySheet";

type Props = {
  items: ClaimedEntry[];
  hadPendingClaim: boolean;
  onItemsChanged: (items: ClaimedEntry[]) => void;
  onContinue: () => void;
};

function itemLine(item: ClaimedEntry, readyCopy: string): string {
  const when = item.startsAt
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: item.timezone,
      }).format(new Date(item.startsAt))
    : readyCopy;
  return item.venueLine ? `${when} · ${item.venueLine}` : when;
}

export function TicketsFoundStep({
  items,
  hadPendingClaim,
  onItemsChanged,
  onContinue,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [addOpen, setAddOpen] = useState(false);
  const hasItems = items.length > 0;
  const only = items.length === 1 ? items[0] : null;
  const foundTitle = only
    ? t(`found.title.${only.noun}`, { count: only.quantity })
    : t("found.title.ticket", { count: 2 });
  const foundCta = only
    ? t(`found.cta.${only.noun}`, { count: only.quantity })
    : t("found.cta.many");

  return (
    <View style={styles.host}>
      <Text accessibilityRole="header" style={styles.title}>
        {hasItems ? foundTitle : t("nothing.title")}
      </Text>
      <Text style={styles.body}>
        {hasItems
          ? t("found.footer")
          : hadPendingClaim
            ? `${t("nothing.differentEmail")} ${t("nothing.addEmail")}`
            : t("nothing.skip")}
      </Text>

      {items.slice(0, 4).map((item) => (
        <View key={`${item.kind}:${item.id}`} style={styles.card}>
          <Text numberOfLines={2} style={styles.cardTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.cardLine}>
            {itemLine(item, t("ticket.readyInPurchases"))}
          </Text>
          <Text style={styles.cardCount}>
            {t("found.itemCount", {
              count: item.quantity,
              noun: item.quantity === 1 ? item.noun : `${item.noun}s`,
            })}
          </Text>
        </View>
      ))}

      {!hasItems && hadPendingClaim ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAddOpen(true)}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>{t("missing.cta")}</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onContinue}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      >
        <Text style={styles.primaryText}>
          {hasItems ? foundCta : t("found.cta.many")}
        </Text>
      </Pressable>

      <Text style={styles.footer}>
        {hasItems ? t("found.footer") : t("nothing.skip")}
      </Text>

      <AddIdentitySheet
        onClose={() => setAddOpen(false)}
        onVerified={(result) => {
          setAddOpen(false);
          onItemsChanged(result.claimed);
        }}
        visible={addOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, paddingHorizontal: 24, paddingTop: 30 },
  title: { color: "#17191e", fontSize: 30, lineHeight: 36, fontWeight: "800" },
  body: {
    color: "#666b73",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 20,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e4e5e8",
    backgroundColor: "#fff",
    padding: 16,
    marginBottom: 11,
  },
  cardTitle: { color: "#17191e", fontSize: 17, fontWeight: "800" },
  cardLine: { color: "#666b73", fontSize: 13, lineHeight: 18, marginTop: 5 },
  cardCount: {
    color: "#eb7825",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 9,
    textTransform: "uppercase",
  },
  primary: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondary: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d5d7db",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  secondaryText: { color: "#31353b", fontSize: 14, fontWeight: "700" },
  footer: {
    color: "#8b8f96",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 15,
  },
  pressed: { opacity: 0.65 },
});
