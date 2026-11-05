/**
 * Issue #4261 — the comments on one plan (spec 5.5 #6; prototype Main.dc.html
 * comments sheet). Comments are ordinary chat messages that quote the plan;
 * this view only gathers them (`planKeys.comments`, refreshed by the plan
 * channel when a comment lands). "Reply to this plan" closes the sheet and
 * starts a reply on the plan.
 */
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { chatTokens } from "../../constants/chatTokens";
import { usePlanComments } from "../../hooks/useChatPlans";
import { formatPlanTime, parsePlanQuote, planQuoteNote } from "./planModel";
import type { ChatPlan } from "../../types/chatPlans";

const SNAP_POINTS = ["70%"];

interface PlanCommentsSheetProps {
  plan: ChatPlan | null;
  onClose: () => void;
  nameOf: (userId: string | null) => string;
  viewerId: string | null;
  onReply: (plan: ChatPlan) => void;
}

export function PlanCommentsSheet({ plan, onClose, nameOf, viewerId, onReply }: PlanCommentsSheetProps): React.ReactElement {
  const { t, i18n } = useTranslation(["chat", "common"]);
  const comments = usePlanComments(plan?.id ?? null);
  const rows = comments.data ?? [];
  const translate = (key: string, params?: Record<string, unknown>) => t(`chat:${key}`, params);
  const sub = plan?.status === "scheduled" && plan.scheduledAt
    ? formatPlanTime(plan.scheduledAt, i18n.language)
    : t("chat:plan_quote_voting");

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.eyebrow}>{t("chat:plan_comments_heading")}</Text>
        <Text style={styles.title} numberOfLines={2}>{plan?.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <TouchableOpacity style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:done")} testID="plan-comments-done">
        <Text style={styles.doneText}>{t("common:done")}</Text>
      </TouchableOpacity>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{t("chat:plan_comments_footer")}</Text>
      <TouchableOpacity
        style={styles.reply}
        onPress={() => {
          if (!plan) return;
          onClose();
          onReply(plan);
        }}
        accessibilityRole="button"
        accessibilityLabel={t("chat:plan_comments_reply")}
        testID="plan-comments-reply"
      >
        <Text style={styles.replyText}>{t("chat:plan_comments_reply")}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={plan !== null}
      onClose={onClose}
      theme="dark"
      wrapInRNModal
      snapPoints={SNAP_POINTS}
      backdropOpacity={0.48}
      backgroundStyle={styles.sheetBackground}
      scrollMode="scroll"
      scrollProps={{ contentContainerStyle: styles.list, showsVerticalScrollIndicator: false }}
      header={header}
      stickyFooter={footer}
      accessibilityLabel={t("chat:plan_comments_heading")}
    >
      {comments.isLoading ? (
        <ActivityIndicator style={styles.loading} color={chatTokens.accent} />
      ) : comments.isError ? (
        <TouchableOpacity style={styles.empty} onPress={() => void comments.refetch()} accessibilityRole="button" accessibilityLabel={t("chat:mediaLoadFailed")}>
          <Text style={styles.emptyText}>{t("chat:mediaLoadFailed")}</Text>
        </TouchableOpacity>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t("chat:plan_comments_empty")}</Text>
        </View>
      ) : (
        rows.map((row) => {
          const name = row.sender_id === viewerId ? t("chat:you") : nameOf(row.sender_id);
          const quote = parsePlanQuote(row.plan_quote);
          return (
            <View key={row.id} style={styles.comment} testID={`plan-comment-${row.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase() || "?"}</Text>
              </View>
              <View style={styles.commentBody}>
                <Text style={styles.name}>{name}</Text>
                {quote ? (
                  <Text style={styles.quote} numberOfLines={2}>
                    {planQuoteNote(quote, i18n.language, undefined, translate)}
                  </Text>
                ) : null}
                <Text style={styles.text}>{row.content}</Text>
              </View>
            </View>
          );
        })
      )}
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: chatTokens.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { color: chatTokens.tagDeck, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  title: { color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700" },
  sub: { color: chatTokens.textSoft, fontSize: 12 },
  done: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  doneText: { color: chatTokens.accent, fontSize: 15, fontWeight: "700" },
  list: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, gap: 14 },
  loading: { paddingVertical: 28 },
  empty: { paddingVertical: 28, alignItems: "center" },
  emptyText: { color: chatTokens.textSecondary, fontSize: 14, textAlign: "center" },
  comment: { flexDirection: "row", gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: chatTokens.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarText: { color: chatTokens.textPrimary, fontSize: 12, fontWeight: "700" },
  commentBody: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "700" },
  quote: { color: chatTokens.tagDeck, fontSize: 12 },
  text: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 19 },
  footer: { paddingHorizontal: 18, paddingTop: 10, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: chatTokens.hairline },
  footerText: { color: chatTokens.textSoft, fontSize: 12, lineHeight: 17 },
  reply: { minHeight: 48, borderRadius: 14, backgroundColor: chatTokens.accent, alignItems: "center", justifyContent: "center" },
  replyText: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: "700" },
});
