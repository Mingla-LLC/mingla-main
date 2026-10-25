import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import type { ClaimSweepResult } from "../../services/claimSweep";

type Props = {
  result: ClaimSweepResult | null;
  onDismiss: () => void;
};

function summary(result: ClaimSweepResult): string {
  const first = result.claimed[0];
  if (result.count === 1 && first) {
    return `${first.quantity > 1 ? `${first.quantity} ${first.noun}s` : first.noun} · ${first.title}`;
  }
  return `${result.count} new ${result.count === 1 ? "purchase" : "purchases"} found`;
}

function destination(result: ClaimSweepResult): string {
  if (result.claimed.length !== 1) return "/purchases";
  const item = result.claimed[0];
  if (
    item.routeKind === "order" || item.routeKind === "rsvp" ||
    item.routeKind === "reservation" || item.routeKind === "venue_order"
  ) {
    return `/purchases/${item.routeKind}/${encodeURIComponent(item.routeId)}`;
  }
  return "/purchases";
}

export function TicketFoundBanner({ result, onDismiss }: Props): React.ReactElement | null {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const translateY = useRef(new Animated.Value(-140)).current;
  const message = useMemo(() => result ? summary(result) : "", [result]);

  useEffect(() => {
    if (!result) return;
    translateY.setValue(-140);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 10,
    }).start();
    const timer = setTimeout(onDismiss, 8_000);
    return () => clearTimeout(timer);
  }, [onDismiss, result, translateY]);

  if (!result) return null;
  const first = result.claimed[0];
  const title = first
    ? t(`toast.title.${first.noun}`, { count: result.count })
    : t("toast.title.ticket", { count: result.count });

  const open = (): void => {
    const path = destination(result);
    onDismiss();
    router.push(path as never);
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.host, { transform: [{ translateY }] }]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text numberOfLines={2} style={styles.body}>{message}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("toast.view")}
        hitSlop={8}
        onPress={open}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionText}>{t("toast.view")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        onPress={onDismiss}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    zIndex: 10_000,
    top: 54,
    left: 14,
    right: 14,
    minHeight: 82,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(20,17,19,0.97)",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  copy: { flex: 1, paddingRight: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "800" },
  body: { color: "rgba(255,255,255,0.66)", fontSize: 12, lineHeight: 17, marginTop: 3 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  actionText: { color: "#eb7825", fontSize: 14, fontWeight: "800" },
  close: { minWidth: 40, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: "rgba(255,255,255,0.55)", fontSize: 26, lineHeight: 28 },
  pressed: { opacity: 0.6 },
});
