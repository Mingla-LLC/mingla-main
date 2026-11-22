/**
 * #4420 — Help & Support's "A person" side: the host's support conversation
 * as a chat (spec part 2, 4.2).
 *
 * Built from the existing pieces, unchanged in behaviour: the online / away
 * line (`useSupportIsOnline`), the thread (`SupportThread`, embedded: text,
 * photos, keyboard handling), the request list and new-request form
 * (`SupportTabPanel`). Opens on the newest open conversation; past ones stay
 * one tap away. Loaded only through the support chunk (supportScreens.ts).
 */

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { color, space } from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useSupportTickets } from "../../hooks/useSupportTickets";
// #4420 keyboard rule: the past-conversations view holds the new-request form
// (summary + message), so the scroller keeps the focused field above the keyboard.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { isOpenSupportStatus } from "./helpSupportRoute";
import { SupportThread } from "./SupportThread";
import { SupportOnlineBanner, SupportTabPanel } from "./SupportTabPanel";
import { supportCopy } from "./supportRequestModel";

export interface SupportPersonPaneProps {
  /** Open on a new conversation (`new=1`, or a closed thread's "Start a new request"). */
  startNew: boolean;
  /** A conversation the Ari hand-over just wrote into: shown at once. */
  focusTicketId: string | null;
  /** Plain lines from the hand-over (a photo that could not be carried). */
  notices: readonly string[];
  onDismissNotices: () => void;
  onToast: (message: string) => void;
  bottomInset: number;
}

type PaneView =
  | { kind: "auto" }
  | { kind: "thread"; ticketId: string }
  | { kind: "past" }
  | { kind: "new" };

export const SupportPersonPane: React.FC<SupportPersonPaneProps> = ({
  startNew,
  focusTicketId,
  notices,
  onDismissNotices,
  onToast,
  bottomInset,
}) => {
  const { user } = useAuth();
  const { data: tickets, isLoading, isError, refetch } = useSupportTickets();
  const [view, setView] = useState<PaneView>(startNew ? { kind: "new" } : { kind: "auto" });

  useEffect(() => {
    if (focusTicketId !== null) setView({ kind: "thread", ticketId: focusTicketId });
  }, [focusTicketId]);
  useEffect(() => {
    if (startNew) setView({ kind: "new" });
  }, [startNew]);

  const openConversationId = useMemo(() => {
    const own = tickets.find(
      (ticket) => ticket.requester_user_id === (user?.id ?? null) && isOpenSupportStatus(ticket.status),
    );
    return own?.id ?? null;
  }, [tickets, user?.id]);

  const resolved: PaneView =
    view.kind !== "auto"
      ? view
      : openConversationId !== null
        ? { kind: "thread", ticketId: openConversationId }
        : { kind: "past" };

  let body: React.ReactElement;
  if (view.kind === "auto" && isLoading) {
    body = (
      <View style={styles.state} accessibilityRole="progressbar" accessibilityLabel={supportCopy("person.loading")}>
        <ActivityIndicator color={color.text2} />
      </View>
    );
  } else if (view.kind === "auto" && isError) {
    body = (
      <View style={styles.state}>
        <Text style={styles.stateText}>{supportCopy("panel.load_error")}</Text>
        <Button label={supportCopy("panel.try_again")} variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  } else if (resolved.kind === "thread") {
    body = (
      <SupportThread
        key={resolved.ticketId}
        ticketId={resolved.ticketId}
        embedded={{
          onShowPast: () => setView({ kind: "past" }),
          onStartNew: () => setView({ kind: "new" }),
        }}
      />
    );
  } else {
    body = (
      <ScrollView
        key={resolved.kind}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + space[7] }]}
        showsVerticalScrollIndicator={false}
      >
        <SupportTabPanel
          onToast={onToast}
          startNew={resolved.kind === "new"}
          onOpenTicket={(ticketId) => setView({ kind: "thread", ticketId })}
          showOnlineBanner={false}
          singleColumn
        />
      </ScrollView>
    );
  }

  return (
    <View style={styles.pane} testID="support-person-pane">
      <View style={styles.top}>
        <SupportOnlineBanner />
        {notices.length > 0 ? (
          <View style={styles.notice} accessibilityRole="alert">
            <View style={styles.noticeCopy}>
              {notices.map((line) => (
                <Text key={line} style={styles.noticeText}>{line}</Text>
              ))}
            </View>
            <Pressable
              onPress={onDismissNotices}
              accessibilityRole="button"
              accessibilityLabel={supportCopy("person.dismiss")}
              hitSlop={8}
              style={styles.noticeClose}
            >
              <Icon name="close" size={16} color={color.text2} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {body}
    </View>
  );
};

const styles = StyleSheet.create({
  pane: { flex: 1, minHeight: 0 },
  top: { paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[4] },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  stateText: { fontSize: 14, lineHeight: 20, color: color.text2, textAlign: "center" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[4],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
  },
  noticeCopy: { flex: 1, gap: space[1] },
  noticeText: { fontSize: 13, lineHeight: 19, color: color.text1 },
  noticeClose: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
});
