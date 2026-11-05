/**
 * Issue #4261 — the plan quote inside a comment bubble (spec 5.5 #8):
 * "Plan: {title}" and the sender's own picks at send time. Tapping it opens
 * the plan's comments. Replaces ReplyQuoteBlock for messages about a plan.
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { receivedBubbleTokens } from "../../constants/chatTokens";

interface PlanQuoteBlockProps {
  title: string;
  note: string;
  variant: "sent" | "received";
  onPress?: () => void;
}

export function PlanQuoteBlock({ title, note, variant, onPress }: PlanQuoteBlockProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const sent = variant === "sent";
  const heading = t("chat:plan_quote_title", { title });
  return (
    <TouchableOpacity
      style={[styles.container, sent ? styles.containerSent : styles.containerReceived]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${note}`}
      testID="chat-plan-quote"
    >
      <View style={[styles.bar, sent ? styles.barSent : styles.barReceived]} />
      <View style={styles.content}>
        <Text style={[styles.title, sent ? styles.titleSent : styles.titleReceived]} numberOfLines={1}>
          {heading}
        </Text>
        {note ? (
          <Text style={[styles.note, sent ? styles.noteSent : styles.noteReceived]} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 8,
    paddingRight: 8,
    paddingVertical: 6,
    marginBottom: 6,
    overflow: "hidden",
  },
  containerSent: { backgroundColor: "rgba(0, 0, 0, 0.18)" },
  containerReceived: { backgroundColor: receivedBubbleTokens.quoteBg },
  bar: { width: 3, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, marginRight: 8 },
  barSent: { backgroundColor: "#FFFFFF" },
  barReceived: { backgroundColor: receivedBubbleTokens.quoteBar },
  content: { flexShrink: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "700" },
  titleSent: { color: "#FFFFFF" },
  titleReceived: { color: receivedBubbleTokens.quoteName },
  note: { fontSize: 12, marginTop: 1 },
  noteSent: { color: "rgba(255, 255, 255, 0.78)" },
  noteReceived: { color: receivedBubbleTokens.quoteText },
});
