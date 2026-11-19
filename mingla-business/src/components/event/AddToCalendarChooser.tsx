/**
 * AddToCalendarChooser — issue #4420 (C2, C3). The buyer page's "Add to
 * calendar" list. Loaded on first tap (useAddToCalendar), never at boot.
 *
 *   Phones and narrow web: a bottom sheet.
 *   Web >= 1024 with a known trigger: a small anchored menu (Menu popover).
 *
 * What each row opens, and in what order, is decided by the pure model in
 * @mingla/offering-rendering/calendarChooser (user agent in, links out). Every
 * row opens a REAL link synchronously inside its own tap handler — a pop-up
 * blocker only allows a link opened from the gesture, and nothing here depends
 * on a background download (the bug: in-app browsers ignore downloads, so the
 * old button did nothing). Auth-free: this is an anonymous buyer route.
 */
import React, { useMemo, useState } from "react";
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  buildCalendarChooser,
  type CalendarChooserModel,
  type CalendarOption,
} from "@mingla/offering-rendering/calendarChooser";
import type { OfferingCalendarEntry } from "@mingla/offering-rendering/offeringCalendar.cjs";

import { color, radius, shadow, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Icon } from "../ui/Icon";
import { MENU_POPOVER_WIDTH, menuPopoverPosition, type MenuAnchor } from "../ui/Menu";
import { Sheet } from "../ui/Sheet";

export interface AddToCalendarChooserProps {
  visible: boolean;
  onClose: () => void;
  entry: OfferingCalendarEntry;
  /** The absolute https address of this event's calendar.ics. */
  icsUrl: string;
  /**
   * Google and Outlook "add event" links, built by the page (the one owner is
   * offeringCalendar.cjs). Passed in so this on-intent chunk imports no value
   * from that module: sharing it with the page would hoist it into the eager
   * boot chunk of every Host web page.
   */
  googleUrl: string;
  outlookUrl: string;
  /** Page coordinates of the tapped trigger (web popover); null => sheet. */
  anchor: MenuAnchor | null;
  testID?: string;
}

const BADGE: Readonly<Record<CalendarOption["id"], { bg: string; text: string }>> = {
  apple: { bg: "#111111", text: "" },
  google: { bg: "#1a73e8", text: "G" },
  outlook: { bg: "#0a64ad", text: "O" },
  ics: { bg: "#6b625b", text: ".ics" },
};

/** Opens a row's link from the tap itself. Exported for the render test. */
export const openCalendarOption = (option: CalendarOption): void => {
  if (typeof window === "undefined") return;
  if (option.mode === "tab") {
    const opened = window.open(option.href, "_blank");
    if (opened === null) {
      // A blocker refused the new tab: this tab still gets a real link.
      window.location.assign(option.href);
    } else {
      opened.opener = null;
    }
    return;
  }
  window.location.assign(option.href);
};

type CopyState = "idle" | "copied" | "failed";

const copyLink = async (link: string): Promise<boolean> => {
  try {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
};

const Row: React.FC<{ option: CalendarOption; onPress: () => void; compact: boolean }> = ({
  option,
  onPress,
  compact,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="menuitem"
    accessibilityLabel={`Add to ${option.label}`}
    testID={`add-to-calendar-${option.id}`}
    style={({ pressed }) => [styles.row, compact ? styles.rowCompact : null, pressed ? styles.pressed : null]}
  >
    <View style={[styles.badge, { backgroundColor: BADGE[option.id].bg }]}>
      {option.id === "apple" ? (
        <Icon name="calendar" size={16} color="#ffffff" />
      ) : (
        <Text style={styles.badgeText}>{BADGE[option.id].text}</Text>
      )}
    </View>
    <View style={styles.rowText}>
      <Text style={styles.rowLabel} numberOfLines={1}>{option.label}</Text>
      {compact ? null : <Text style={styles.rowSub} numberOfLines={2}>{option.sub}</Text>}
    </View>
  </Pressable>
);

export const AddToCalendarChooser: React.FC<AddToCalendarChooserProps> = ({
  visible,
  onClose,
  entry,
  icsUrl,
  googleUrl,
  outlookUrl,
  anchor,
  testID = "add-to-calendar-chooser",
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const viewport = useWindowDimensions();
  const [followUp, setFollowUp] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const model: CalendarChooserModel = useMemo(
    () =>
      buildCalendarChooser({
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        maxTouchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0,
        googleUrl,
        outlookUrl,
        icsUrl,
      }),
    [googleUrl, outlookUrl, icsUrl],
  );

  const close = (): void => {
    setFollowUp(false);
    setCopyState("idle");
    onClose();
  };

  const choose = (option: CalendarOption): void => {
    // Synchronous, inside the tap: open first, then update state.
    openCalendarOption(option);
    if (option.followUp && model.followUp !== null) {
      setFollowUp(true);
      void copyLink(model.followUp.copyLink).then((ok) => setCopyState(ok ? "copied" : "idle"));
      return;
    }
    close();
  };

  const onCopy = (): void => {
    if (model.followUp === null) return;
    void copyLink(model.followUp.copyLink).then((ok) => setCopyState(ok ? "copied" : "failed"));
  };

  const popover = isWideDesktop && anchor !== null && !followUp;

  if (popover && anchor !== null) {
    if (!visible) return null;
    const pos = menuPopoverPosition(anchor, model.options.length, viewport);
    return (
      <RNModal visible transparent animationType="none" onRequestClose={close}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close calendar options"
        />
        <View
          style={[styles.popover, shadow.menu, { left: pos.left, top: pos.top }]}
          accessibilityRole="menu"
          testID={testID}
        >
          {model.options.map((option) => (
            <Row key={option.id} option={option} compact onPress={() => choose(option)} />
          ))}
        </View>
      </RNModal>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} snapPoint={followUp ? 300 : model.note !== null ? 470 : 400} testID={testID}>
      <View style={styles.sheetBody}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Add to calendar</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} testID="add-to-calendar-close">
            <Icon name="close" size={16} color={color.text2} />
          </Pressable>
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>{entry.title}</Text>
        {followUp && model.followUp !== null ? (
          <View testID="add-to-calendar-followup">
            <Text style={styles.followTitle}>{model.followUp.title}</Text>
            <Text style={styles.followBody}>{model.followUp.body}</Text>
            <Pressable
              onPress={onCopy}
              accessibilityRole="button"
              accessibilityLabel="Copy link"
              style={({ pressed }) => [styles.copyButton, pressed ? styles.pressed : null]}
              testID="add-to-calendar-copy"
            >
              <Text style={styles.copyLabel}>{copyState === "copied" ? "Link copied" : "Copy link"}</Text>
            </Pressable>
            {copyState === "failed" ? (
              <Text style={styles.followBody} selectable>
                Could not copy automatically. Press and hold the link to copy it: {model.followUp.copyLink}
              </Text>
            ) : null}
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Done" style={styles.done}>
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <View accessibilityRole="menu">
            {model.note !== null ? (
              <View style={styles.note} testID="add-to-calendar-note">
                <Text style={styles.noteText}>{model.note}</Text>
              </View>
            ) : null}
            {model.options.map((option) => (
              <Row key={option.id} option={option} compact={false} onPress={() => choose(option)} />
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
};

export default AddToCalendarChooser;

const styles = StyleSheet.create({
  popover: {
    position: "absolute",
    width: MENU_POPOVER_WIDTH,
    borderRadius: radius.md,
    backgroundColor: color.card2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingVertical: space[2],
  },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[6] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  title: { ...type.row, color: color.text1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  subtitle: { ...type.small, color: color.text2, marginBottom: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56, paddingHorizontal: space[1] },
  rowCompact: { minHeight: 44, paddingHorizontal: space[4] },
  pressed: { backgroundColor: color.fill.pressed },
  badge: { width: 34, height: 34, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
  badgeText: { ...type.caption, color: "#ffffff", fontWeight: "700" },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text2 },
  note: { backgroundColor: color.accentTint, borderRadius: radius.sm, padding: space[3], marginBottom: space[2] },
  noteText: { ...type.small, color: color.text1 },
  followTitle: { ...type.row, color: color.text1, marginBottom: space[1] },
  followBody: { ...type.small, color: color.text2, marginBottom: space[3] },
  copyButton: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    marginBottom: space[2],
  },
  copyLabel: { ...type.row, color: color.text1 },
  done: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  doneLabel: { ...type.row, color: color.text2 },
});
