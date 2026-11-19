import React, { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, scrim, space } from "../../../../constants/designSystem";
import { Sheet } from "../../../ui/Sheet";
import { Chip, ui } from "../ui";
import { WebsiteIcon, type WebsiteIconName } from "../WebsiteIcon";
import { WORKSPACE_DETAIL_LABELS, type WorkspaceDetail } from "../../../../sites/workspaceRoute";

/*
 * #4453 — the "more" menu: everything that is not editing the page. A small
 * menu under the button on desktop (arrow keys move, Escape closes, focus
 * returns to the button); a bottom sheet on phones.
 */
export type MoreItem =
  | { kind: "detail"; detail: WorkspaceDetail; icon: WebsiteIconName; note?: string | null; tone?: "ok" | "warn" }
  | { kind: "action"; key: string; label: string; icon: WebsiteIconName; onPress: () => void };

export function moreItems(input: {
  content: readonly WorkspaceDetail[];
  requestsReady: number;
  requestsOpen: number;
  showSetup: boolean;
  onSetup: () => void;
  onFullScreen: () => void;
}): MoreItem[] {
  const requestNote = input.requestsReady > 0 ? `${input.requestsReady} ready` : input.requestsOpen > 0 ? `${input.requestsOpen} with the team` : null;
  return [
    { kind: "detail", detail: "stats", icon: "home" },
    { kind: "detail", detail: "history", icon: "history" },
    { kind: "detail", detail: "addresses", icon: "globe" },
    { kind: "detail", detail: "settings", icon: "cog" },
    { kind: "detail", detail: "requests", icon: "team", note: requestNote, tone: input.requestsReady > 0 ? "ok" : "warn" },
    { kind: "detail", detail: "pages", icon: "pages" },
    ...input.content.map((detail): MoreItem => ({ kind: "detail", detail, icon: detail === "destinations" ? "pin" : detail === "stories" ? "book" : detail === "reviews" ? "quote" : "clock" })),
    { kind: "action", key: "fullscreen", label: "Open the draft full screen", icon: "eye", onPress: input.onFullScreen },
    ...(input.showSetup ? [{ kind: "action", key: "setup", label: "Website setup", icon: "plan", onPress: input.onSetup } satisfies MoreItem] : []),
  ];
}

export function MoreMenu({ visible, phone, items, onDetail, onClose }: {
  visible: boolean;
  phone: boolean;
  items: MoreItem[];
  onDetail: (detail: WorkspaceDetail) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const refs = useRef<(View | null)[]>([]);
  const focusAt = (index: number) => {
    const node = refs.current[(index + items.length) % items.length] as unknown as { focus?: () => void } | null;
    node?.focus?.();
  };
  useEffect(() => {
    if (!visible || phone) return undefined;
    const timer = setTimeout(() => focusAt(0), 40);
    if (Platform.OS !== "web" || typeof window === "undefined") return () => clearTimeout(timer);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
    // focusAt reads refs; items length is stable while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, phone, visible]);

  const rows = items.map((item, index) => {
    const label = item.kind === "detail" ? WORKSPACE_DETAIL_LABELS[item.detail] : item.label;
    const note = item.kind === "detail" ? item.note ?? null : null;
    return (
      <Pressable
        key={item.kind === "detail" ? item.detail : item.key}
        ref={(node) => { refs.current[index] = node; }}
        onPress={() => {
          onClose();
          if (item.kind === "detail") onDetail(item.detail);
          else item.onPress();
        }}
        role="menuitem"
        accessibilityRole="menuitem"
        accessibilityLabel={note ? `${label}, ${note}` : label}
        {...({ onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key === "ArrowDown") { event.preventDefault?.(); focusAt(index + 1); }
          if (event.key === "ArrowUp") { event.preventDefault?.(); focusAt(index - 1); }
        } } as object)}
        testID={`more-${item.kind === "detail" ? item.detail : item.key}`}
        style={({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered || pressed ? styles.itemHover : null]}
      >
        <WebsiteIcon name={item.icon} size={18} color={ui.t2} />
        <Text style={styles.itemText} numberOfLines={1}>{label}</Text>
        {note ? <Chip label={note} tone={item.kind === "detail" ? item.tone ?? "neutral" : "neutral"} /> : null}
      </Pressable>
    );
  });

  if (phone) {
    return (
      <Sheet visible={visible} onClose={onClose} snapPoint="full" testID="more-sheet">
        <View style={styles.sheet} role="menu" accessibilityLabel="More for your website">{rows}</View>
      </Sheet>
    );
  }
  if (!visible) return null;
  return (
    <>
      <Pressable style={styles.away} onPress={onClose} accessibilityLabel="Close the menu" role="button" {...({ tabIndex: -1 } as object)} testID="more-away" />
      <View style={styles.menu} role="menu" accessibilityLabel="More for your website" testID="more-menu">{rows}</View>
    </>
  );
}

const styles = StyleSheet.create({
  away: { ...StyleSheet.absoluteFillObject, zIndex: 30 },
  menu: {
    position: "absolute", top: 52, right: space[4], zIndex: 31, width: 300, padding: 6, borderRadius: radius.md,
    backgroundColor: color.card3, borderWidth: 1, borderColor: ui.border2, boxShadow: `0 12px 40px ${scrim.modal}`,
  } as object,
  sheet: { padding: space[4], gap: 2 },
  item: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 12, borderRadius: radius.xs },
  itemHover: { backgroundColor: color.fill.railOn },
  itemText: { flex: 1, fontSize: 15, color: ui.t1 },
});
