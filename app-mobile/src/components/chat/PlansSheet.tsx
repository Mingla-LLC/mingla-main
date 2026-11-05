/**
 * Issue #4261 — Plans (spec 5.5 #5): what the group has locked in, from the
 * deck or the chat, grouped Upcoming (soonest first) and Past (latest first,
 * dimmed). Replaces ScheduleSheet in the chat.
 *
 * A chat plan row closes the sheet and scrolls the chat to its card. A deck
 * plan row opens the place card with Book through the chat's one plan-card
 * state (`useCollabPlanCard`), whose ExpandedCardModal lives here, exactly as
 * the Plans sheet did before (#1672 / #3281 dismiss rule unchanged).
 */
import React, { useMemo } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import ExpandedCardModal from "../ExpandedCardModal";
import { openExpandedCardContentShare } from "../../services/contentShareController";
import { chatTokens } from "../../constants/chatTokens";
import { resolvePlacePhotoThumbSource } from "../../utils/placePhotoThumb";
import type { CollabPlanCard } from "./CollabSessionChatBanners";
import { groupPlans } from "./chatHeaderModel";
import { formatPlanTime, planPhoto, rsvpSummary, scheduledPlans } from "./planModel";
import type { ChatPlan, ChatPlansPayload } from "../../types/chatPlans";

const SNAP_POINTS = ["46%", "78%"];

interface PlansSheetProps {
  visible: boolean;
  onClose: () => void;
  payload: ChatPlansPayload | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  nameOf: (userId: string | null) => string;
  /** A chat plan row: close the sheet and scroll the chat to its card. */
  onOpenChatPlan: (plan: ChatPlan) => void;
  /** The chat's plan-card state, shared with the header strip and the thread. */
  planCard: CollabPlanCard;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}

function PlanRow({
  plan,
  past,
  viewerId,
  nameOf,
  onPress,
}: {
  plan: ChatPlan & { scheduledAt: string };
  past: boolean;
  viewerId: string;
  nameOf: (userId: string | null) => string;
  onPress: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation(["chat"]);
  const deck = plan.source === "deck";
  const photo = resolvePlacePhotoThumbSource(planPhoto(plan));
  const time = formatPlanTime(plan.scheduledAt, i18n.language);
  const placeName = plan.place?.name ?? null;
  const title = placeName && placeName !== plan.title ? `${plan.title} · ${placeName}` : plan.title;
  const sub = deck
    ? `${time} · ${plan.lockedBy && plan.lockedBy === viewerId
        ? t("chat:planSetByYou")
        : t("chat:planSetBy", { name: plan.lockedBy ? nameOf(plan.lockedBy) : t("chat:planSetBySomeone") })}`
    : t("chat:plans_row_going", { time, count: rsvpSummary(plan).going });
  const by = plan.createdBy === viewerId ? t("chat:you") : plan.createdByName || nameOf(plan.createdBy);
  return (
    <TouchableOpacity
      style={[styles.row, past && styles.rowPast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      testID={`plans-row-${plan.id}`}
    >
      {photo ? (
        <Image source={{ uri: photo.uri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon]}>
          <Icon name={plan.whereKind === "link" ? "link" : "lock-closed"} size={15} color={chatTokens.accent} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
        <Text style={[styles.rowSource, deck ? styles.sourceDeck : styles.sourceChat]} numberOfLines={1}>
          {deck ? t("chat:plans_from_deck") : t("chat:plans_from_chat", { name: by })}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={chatTokens.textMuted} />
    </TouchableOpacity>
  );
}

export function PlansSheet({
  visible,
  onClose,
  payload,
  isLoading,
  isError,
  onRetry,
  nameOf,
  onOpenChatPlan,
  planCard,
  accountPreferences,
}: PlansSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const { modalTarget, openPlanFromSheet, onSheetDismissed, closePlan } = planCard;
  const rows = useMemo(() => scheduledPlans(payload?.plans ?? []), [payload?.plans]);
  const groups = useMemo(() => groupPlans(rows, Date.now()), [rows]);
  const viewerId = payload?.viewerId ?? "";
  const hasRows = !isLoading && rows.length > 0;

  const open = (plan: ChatPlan & { scheduledAt: string }) => {
    if (plan.source === "deck" && plan.savedCardId) {
      // iOS refuses the card over this sheet: close it; the card shows once it has dismissed.
      openPlanFromSheet({ savedCardId: plan.savedCardId, cardData: plan.cardData ?? null });
      onClose();
      return;
    }
    onOpenChatPlan(plan);
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t("chat:plansTitle")}</Text>
        <Text style={styles.headerSub} numberOfLines={1}>{t("chat:plans_sub")}</Text>
      </View>
      <TouchableOpacity style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("chat:plansClose")} testID="plans-done">
        <Text style={styles.doneText}>{t("common:done")}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <BaseBottomSheet
        visible={visible}
        onClose={onClose}
        theme="dark"
        wrapInRNModal
        onNativeDismiss={onSheetDismissed}
        snapPoints={SNAP_POINTS}
        backdropOpacity={0.48}
        backgroundStyle={styles.sheetBackground}
        scrollMode={hasRows ? "scroll" : "view"}
        scrollProps={hasRows ? { contentContainerStyle: styles.list, showsVerticalScrollIndicator: false } : undefined}
        header={header}
        accessibilityLabel={t("chat:plansTitle")}
      >
        {isLoading && !payload ? (
          <ActivityIndicator style={styles.loading} color={chatTokens.accent} />
        ) : isError && !payload ? (
          <TouchableOpacity style={styles.empty} onPress={onRetry} accessibilityRole="button" accessibilityLabel={t("chat:plansRetryA11y")}>
            <Text style={styles.emptyText}>{t("chat:plansLoadFailed")}</Text>
          </TouchableOpacity>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t("chat:plans_empty_any")}</Text>
            <Text style={styles.footer}>{t("chat:plans_footer")}</Text>
          </View>
        ) : (
          <View testID="plans-sheet-rows">
            {([
              ["upcoming", groups.upcoming],
              ["past", groups.past],
            ] as const).map(([group, groupRows]) => groupRows.length === 0 ? null : (
              <View key={group} testID={`plans-group-${group}`}>
                <Text style={styles.groupHeading} accessibilityRole="header">
                  {group === "upcoming" ? t("chat:plansUpcoming") : t("chat:plansPast")}
                </Text>
                {groupRows.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} past={group === "past"} viewerId={viewerId} nameOf={nameOf} onPress={() => open(plan)} />
                ))}
              </View>
            ))}
            <Text style={styles.footer}>{t("chat:plans_footer")}</Text>
          </View>
        )}
      </BaseBottomSheet>
      <ExpandedCardModal
        visible={!!modalTarget}
        target={modalTarget}
        onClose={() => {
          const dismissOwnerSheet = modalTarget?.kind === "businessEvent";
          closePlan();
          // #1672 / #3281 1d — experience Book navigates via /exp and calls
          // onClose; leave the Plans wrapInRNModal up and Book is unreachable.
          if (dismissOwnerSheet) onClose();
        }}
        onSave={() => {}}
        onShare={(card) => openExpandedCardContentShare(card, "collab_locked_expanded")}
        shareProducerSurface="collab_locked_expanded"
        currentMode="collab"
        // #1669: the viewer's units and currency, as on the deck.
        accountPreferences={accountPreferences}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: chatTokens.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: "800" },
  headerSub: { color: chatTokens.textSoft, fontSize: 12 },
  done: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  doneText: { color: chatTokens.accent, fontSize: 15, fontWeight: "700" },
  loading: { paddingVertical: 28 },
  empty: { paddingHorizontal: 18, paddingVertical: 28, alignItems: "center", gap: 10 },
  emptyText: { color: chatTokens.textSecondary, fontSize: 14, textAlign: "center" },
  list: { paddingHorizontal: 14, paddingBottom: 16, gap: 8 },
  groupHeading: {
    color: chatTokens.textSoft,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surfaceRaised,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  rowPast: { opacity: 0.6 },
  thumb: { width: 32, height: 32, borderRadius: 16 },
  thumbIcon: { backgroundColor: chatTokens.accentSoft, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  rowSub: { color: chatTokens.textSecondary, fontSize: 12, marginTop: 2 },
  rowSource: { fontSize: 12, marginTop: 2 },
  sourceDeck: { color: chatTokens.tagDeck },
  sourceChat: { color: chatTokens.tagChat },
  footer: { color: chatTokens.textSoft, fontSize: 12, lineHeight: 17, paddingTop: 8, textAlign: "center" },
});
