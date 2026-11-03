/**
 * Issue #4261 — Matches (spec 5.5 #4; prototype Main.dc.html Matches): what
 * the group is deciding on, deck matches and plans from the chat side by side
 * in one sideways swipe row, voted the same way. Replaces
 * SavedToSessionCardsSheet in the chat.
 *
 * Order = `orderMatches` (needs-your-vote first, then newest), captured when
 * the sheet opens so a card never jumps away under your thumb; plans that
 * arrive while it is open join the end, locked or cancelled ones drop out.
 * Page dots (needs-vote dots tinted) and "{i} of {n}" sit under the row.
 *
 * Deck "Details" opens the existing ExpandedCardModal through the sheet-card
 * handoff (iOS refuses the card over this sheet). Deck lock with no time vote
 * opens the existing LockedCardSchedulingSheet; chat lock with no time vote
 * opens PlanTimePickerSheet. Both are centred dialogs, so they open over it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import ExpandedCardModal from "../ExpandedCardModal";
import LockedCardSchedulingSheet from "../session/LockedCardSchedulingSheet";
import { openExpandedCardContentShare } from "../../services/contentShareController";
import { expansionTargetFromSavedPayload } from "../../utils/expansionTargetFromSavedPayload";
import { chatTokens } from "../../constants/chatTokens";
import type { ExpansionTarget } from "../../types/expansion";
import { useSheetCard } from "./CollabSessionChatBanners";
import {
  PlanAddTimeEditor,
  PlanCommentNudge,
  PlanPollBlock,
  PlanRsvpGrid,
  useCommentNudge,
  usePlanActions,
} from "./PlanCardBubble";
import { PlanTimePickerSheet } from "./PlanTimePickerSheet";
import { canLockWithoutVote, lockableLeader, needsMyVote, orderMatches, planPhoto, viewerReaction } from "./planModel";
import type { ChatPlan, ChatPlansPayload } from "../../types/chatPlans";

const SNAP_POINTS = ["62%", "88%"];
const CARD_WIDTH = 292;
const CARD_GAP = 12;

interface PlanMatchesSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  payload: ChatPlansPayload | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  nameOf: (userId: string | null) => string;
  /** Start a reply on the plan (the parent closes this sheet first). */
  onComment: (plan: ChatPlan) => void;
  /** Close and scroll the chat to the plan's card. */
  onSeeInChat: (plan: ChatPlan) => void;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}

function MatchCard({
  plan,
  payload,
  conversationId,
  nameOf,
  onComment,
  onSeeInChat,
  onDetails,
  onLockPickTime,
}: {
  plan: ChatPlan;
  payload: ChatPlansPayload;
  conversationId: string;
  nameOf: (userId: string | null) => string;
  onComment: (plan: ChatPlan) => void;
  onSeeInChat: (plan: ChatPlan) => void;
  onDetails: (plan: ChatPlan) => void;
  onLockPickTime: (plan: ChatPlan) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const viewerId = payload.viewerId;
  const actions = usePlanActions(conversationId, viewerId);
  const nudge = useCommentNudge();
  const [addingTime, setAddingTime] = useState(false);
  const deck = plan.source === "deck";
  const todo = needsMyVote(plan, viewerId);
  const photo = planPhoto(plan);
  const mine = viewerReaction(plan, viewerId);
  const likedBy = plan.reactions.up.map((id) => (id === viewerId ? t("chat:you") : nameOf(id)));
  const leader = lockableLeader(plan);
  const lockWithoutVote = canLockWithoutVote(plan);
  const locking = actions.lockingPlanId === plan.id;
  const placeLine = plan.place?.name
    ? [plan.place.name, plan.place.address].filter(Boolean).join(" · ")
    : plan.link?.domain ?? (deck && typeof plan.cardData?.address === "string" ? plan.cardData.address : null);
  const byName = plan.createdBy === viewerId ? t("chat:you") : plan.createdByName || nameOf(plan.createdBy);

  const lock = () => {
    if (leader) actions.lockOption(plan, leader.id);
    else if (lockWithoutVote) onLockPickTime(plan);
  };

  return (
    <View style={[styles.card, todo ? styles.cardTodo : null]} testID={`match-card-${plan.id}`}>
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
        <View style={[styles.hero, deck ? styles.heroDeck : styles.heroChat]}>
          {photo ? <Image source={{ uri: photo }} style={styles.heroImage} resizeMode="cover" /> : null}
          <View style={styles.heroChips}>
            <View style={[styles.sourceChip, deck ? styles.sourceDeck : styles.sourceChat]}>
              <Text style={styles.sourceText} numberOfLines={1}>
                {deck ? t("chat:matches_from_deck") : t("chat:matches_from_chat", { name: byName.toUpperCase() })}
              </Text>
            </View>
            {todo ? (
              <View style={styles.todoChip}>
                <Text style={styles.todoText}>{t("chat:matches_needs_vote")}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>{plan.title}</Text>
          <Text style={styles.placeLine} numberOfLines={1}>{placeLine || t("chat:matches_no_place")}</Text>

          <View style={styles.likeRow}>
            <Text style={styles.likedBy} numberOfLines={1}>
              {likedBy.length > 0 ? t("chat:matches_liked_by", { names: likedBy.join(", ") }) : t("chat:matches_no_likes")}
            </Text>
            <TouchableOpacity
              style={[styles.thumb, mine === "up" && styles.thumbUp]}
              onPress={() => actions.react(plan, "up")}
              hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
              accessibilityRole="button"
              accessibilityLabel={`${plan.reactions.up.length}`}
              accessibilityState={{ selected: mine === "up" }}
              testID="match-thumb-up"
            >
              <Icon name="thumbs-up" size={15} color={chatTokens.textPrimary} />
              <Text style={styles.thumbText}>{plan.reactions.up.length}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.thumb, mine === "down" && styles.thumbDown]}
              onPress={() => actions.react(plan, "down")}
              hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
              accessibilityRole="button"
              accessibilityLabel={`${plan.reactions.down.length}`}
              accessibilityState={{ selected: mine === "down" }}
              testID="match-thumb-down"
            >
              <Icon name="thumbs-down" size={15} color={chatTokens.textPrimary} />
              <Text style={styles.thumbText}>{plan.reactions.down.length}</Text>
            </TouchableOpacity>
          </View>

          {plan.options.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.heading}>{t("chat:matches_when_heading")}</Text>
              <PlanPollBlock
                plan={plan}
                viewerId={viewerId}
                memberCount={payload.memberCount}
                nameOf={nameOf}
                compact
                onVote={(optionId) => {
                  actions.vote(plan, optionId);
                  nudge.poke();
                }}
              />
            </View>
          ) : null}

          {addingTime ? (
            <PlanAddTimeEditor
              busy={actions.addingTimeFor === plan.id}
              onCancel={() => setAddingTime(false)}
              onSubmit={(iso) => actions.addTime(plan, iso, () => setAddingTime(false))}
            />
          ) : plan.options.length === 0 ? (
            <View style={styles.noTimeRow}>
              <Text style={styles.noTime}>{t("chat:matches_no_time")}</Text>
              {plan.canAddTime ? (
                <TouchableOpacity
                  style={styles.voteOnTime}
                  onPress={() => setAddingTime(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat:matches_vote_on_time")}
                  testID="match-vote-on-time"
                >
                  <Text style={styles.voteOnTimeText}>{t("chat:matches_vote_on_time")}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : plan.canAddTime ? (
            <TouchableOpacity
              style={styles.addTime}
              onPress={() => setAddingTime(true)}
              accessibilityRole="button"
              accessibilityLabel={t("chat:plan_add_your_time")}
              testID="match-add-time"
            >
              <Text style={styles.addTimeText}>{t("chat:plan_add_your_time")}</Text>
            </TouchableOpacity>
          ) : null}

          <PlanRsvpGrid
            plan={plan}
            viewerId={viewerId}
            onRsvp={(status) => {
              actions.rsvp(plan, status);
              nudge.poke();
            }}
          />
          {nudge.visible ? (
            <PlanCommentNudge
              onPress={() => {
                nudge.hide();
                onComment(plan);
              }}
            />
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.action} onPress={() => onComment(plan)} accessibilityRole="button" accessibilityLabel={t("chat:matches_comment")} testID="match-comment">
              <Icon name="chatbubble-outline" size={15} color={chatTokens.textPrimary} />
              <Text style={styles.actionText}>{t("chat:matches_comment")}</Text>
            </TouchableOpacity>
            {!deck && plan.messageVisible ? (
              <TouchableOpacity style={styles.action} onPress={() => onSeeInChat(plan)} accessibilityRole="button" accessibilityLabel={t("chat:matches_see_in_chat")} testID="match-see-in-chat">
                <Text style={styles.actionText}>{t("chat:matches_see_in_chat")}</Text>
              </TouchableOpacity>
            ) : null}
            {deck ? (
              <TouchableOpacity style={styles.action} onPress={() => onDetails(plan)} accessibilityRole="button" accessibilityLabel={t("chat:matches_details")} testID="match-details">
                <Text style={styles.actionText}>{t("chat:matches_details")}</Text>
              </TouchableOpacity>
            ) : null}
            {leader || lockWithoutVote ? (
              <TouchableOpacity
                style={[styles.action, styles.lock, locking && styles.disabled]}
                onPress={lock}
                disabled={locking}
                accessibilityRole="button"
                accessibilityLabel={t("chat:plan_lock_it_in")}
                accessibilityState={{ busy: locking }}
                testID="match-lock"
              >
                {locking ? <ActivityIndicator size="small" color={chatTokens.textPrimary} /> : <Text style={styles.lockText}>{t("chat:plan_lock_it_in")}</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export function PlanMatchesSheet({
  visible,
  onClose,
  conversationId,
  payload,
  isLoading,
  isError,
  onRetry,
  nameOf,
  onComment,
  onSeeInChat,
  accountPreferences,
}: PlanMatchesSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatPlan>>(null);
  const [index, setIndex] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [lockPickFor, setLockPickFor] = useState<ChatPlan | null>(null);
  const [deckLockFor, setDeckLockFor] = useState<ChatPlan | null>(null);
  const { modalTarget, openFromSheet, onSheetDismissed, close: closeDetails } = useSheetCard<ExpansionTarget>();
  const lockActions = usePlanActions(conversationId, payload?.viewerId);
  const viewerId = payload?.viewerId ?? "";

  // Capture the order when the sheet opens (no reshuffle while you vote).
  useEffect(() => {
    if (!visible || !payload) return;
    setOrder(orderMatches(payload.plans, viewerId).map((plan) => plan.id));
    setIndex(0);
    // Only on open, and when the first payload of this open lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, payload === null]);

  const cards = useMemo(() => {
    if (!payload) return [];
    const deciding = payload.plans.filter((plan) => plan.status === "deciding");
    const byId = new Map(deciding.map((plan) => [plan.id, plan]));
    const kept = order.map((id) => byId.get(id)).filter((plan): plan is ChatPlan => Boolean(plan));
    const keptIds = new Set(kept.map((plan) => plan.id));
    const fresh = orderMatches(deciding.filter((plan) => !keptIds.has(plan.id)), viewerId);
    return [...kept, ...fresh];
  }, [order, payload, viewerId]);

  const sideInset = Math.max(16, (width - CARD_WIDTH) / 2);
  const current = Math.min(index, Math.max(0, cards.length - 1));

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    setIndex(Math.max(0, Math.min(cards.length - 1, next)));
  };

  const openDetails = (plan: ChatPlan) => {
    if (!plan.cardData || !plan.savedCardId) return;
    const target = expansionTargetFromSavedPayload({
      ...plan.cardData,
      sourceScope: "collaboration",
      sourceRecordId: plan.savedCardId,
      savedCardId: plan.savedCardId,
    });
    if (!target) return;
    openFromSheet(target);
    onClose();
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t("chat:matches_title")}</Text>
        <Text style={styles.headerSub} numberOfLines={2}>{t("chat:matches_sub")}</Text>
      </View>
      <TouchableOpacity style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:done")} testID="matches-done">
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
        scrollMode="view"
        header={header}
        accessibilityLabel={t("chat:matches_title")}
      >
        <View style={[styles.sheetBody, { paddingBottom: Math.max(insets.bottom, 16) }]} testID="plan-matches-sheet">
          {isLoading && !payload ? (
            <ActivityIndicator style={styles.loading} color={chatTokens.accent} />
          ) : isError && !payload ? (
            <TouchableOpacity style={styles.empty} onPress={onRetry} accessibilityRole="button" accessibilityLabel={t("chat:plansRetryA11y")}>
              <Text style={styles.emptyText}>{t("chat:plansLoadFailed")}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={cards}
                horizontal
                style={styles.list}
                keyExtractor={(plan) => plan.id}
                showsHorizontalScrollIndicator={false}
                snapToInterval={CARD_WIDTH + CARD_GAP}
                decelerationRate="fast"
                contentContainerStyle={[styles.row, { paddingHorizontal: sideInset }]}
                ItemSeparatorComponent={() => <View style={styles.gap} />}
                onMomentumScrollEnd={onScrollEnd}
                getItemLayout={(_data, i) => ({ length: CARD_WIDTH + CARD_GAP, offset: (CARD_WIDTH + CARD_GAP) * i, index: i })}
                renderItem={({ item }) =>
                  payload ? (
                    <MatchCard
                      plan={item}
                      payload={payload}
                      conversationId={conversationId}
                      nameOf={nameOf}
                      onComment={onComment}
                      onSeeInChat={onSeeInChat}
                      onDetails={openDetails}
                      onLockPickTime={(plan) => (plan.source === "deck" ? setDeckLockFor(plan) : setLockPickFor(plan))}
                    />
                  ) : null
                }
              />
              <View style={styles.dots}>
                {cards.map((plan, i) => (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.dotTarget}
                    onPress={() => {
                      setIndex(i);
                      listRef.current?.scrollToIndex({ index: i, animated: true });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("chat:matches_card_a11y", { index: i + 1, title: plan.title })}
                    accessibilityState={{ selected: i === current }}
                  >
                    <View style={[styles.dot, needsMyVote(plan, viewerId) && styles.dotTodo, i === current && styles.dotOn]} />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.counter} testID="matches-counter">
                {cards.length > 0 ? t("chat:matches_counter", { index: current + 1, count: cards.length }) : t("chat:matches_nothing")}
              </Text>
              <Text style={styles.helper}>{t("chat:matches_helper")}</Text>
            </>
          )}
        </View>
        <PlanTimePickerSheet
          visible={lockPickFor !== null}
          onClose={() => setLockPickFor(null)}
          planTitle={lockPickFor?.title ?? ""}
          busy={lockActions.lockingPlanId !== null}
          onConfirm={(iso) => {
            if (lockPickFor) lockActions.lockAt(lockPickFor, iso, () => setLockPickFor(null));
          }}
        />
        {deckLockFor && deckLockFor.sessionId && deckLockFor.savedCardId ? (
          <LockedCardSchedulingSheet
            visible
            onClose={() => setDeckLockFor(null)}
            sessionId={deckLockFor.sessionId}
            savedCardId={deckLockFor.savedCardId}
            cardData={deckLockFor.cardData ?? null}
            currentUserId={payload?.viewerId}
            onLockedAndScheduled={() => setDeckLockFor(null)}
          />
        ) : null}
      </BaseBottomSheet>
      <ExpandedCardModal
        visible={!!modalTarget}
        target={modalTarget}
        onClose={() => {
          const dismissOwnerSheet = modalTarget?.kind === "businessEvent";
          closeDetails();
          // #1672 / #3281 1d — experience Book must dismiss Matches.
          if (dismissOwnerSheet) onClose();
        }}
        onSave={() => {}}
        onShare={(card) => openExpandedCardContentShare(card, "collab_saved_expanded")}
        shareProducerSurface="collab_saved_expanded"
        currentMode="collab"
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
  sheetBody: { flex: 1, paddingTop: 12 },
  loading: { paddingVertical: 28 },
  empty: { padding: 28, alignItems: "center" },
  emptyText: { color: chatTokens.textSecondary, fontSize: 14, textAlign: "center" },
  list: { flex: 1 },
  row: { alignItems: "stretch" },
  gap: { width: CARD_GAP },
  card: {
    width: CARD_WIDTH,
    flex: 1,
    backgroundColor: chatTokens.planCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    overflow: "hidden",
  },
  cardTodo: { borderColor: "rgba(235, 120, 37, 0.55)" },
  cardScroll: { paddingBottom: 12 },
  hero: { height: 64, justifyContent: "flex-end" },
  heroDeck: { backgroundColor: chatTokens.planHeroDeck },
  heroChat: { backgroundColor: chatTokens.planHeroChat },
  heroImage: { ...StyleSheet.absoluteFillObject, opacity: 0.6 },
  heroChips: { flexDirection: "row", gap: 6, padding: 10 },
  sourceChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, maxWidth: 200 },
  sourceDeck: { backgroundColor: chatTokens.tagDeck },
  sourceChat: { backgroundColor: chatTokens.tagChat },
  sourceText: { color: chatTokens.tagText, fontSize: 11, fontWeight: "800" },
  todoChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: chatTokens.accent },
  todoText: { color: chatTokens.textPrimary, fontSize: 11, fontWeight: "800" },
  body: { padding: 14, gap: 10 },
  title: { color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700" },
  placeLine: { color: chatTokens.textSecondary, fontSize: 13 },
  likeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  likedBy: { flex: 1, color: chatTokens.textSoft, fontSize: 12 },
  thumb: {
    width: 56,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  thumbUp: { backgroundColor: chatTokens.accent, borderColor: chatTokens.accent },
  thumbDown: { backgroundColor: chatTokens.planCant, borderColor: chatTokens.planCantBorder },
  thumbText: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "700" },
  block: { gap: 6 },
  heading: { color: chatTokens.tagDeck, fontSize: 11, fontWeight: "700" },
  noTimeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  noTime: { color: chatTokens.textSoft, fontSize: 13 },
  voteOnTime: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.5)",
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    justifyContent: "center",
  },
  voteOnTimeText: { color: chatTokens.tagDeck, fontSize: 13, fontWeight: "700" },
  addTime: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  addTimeText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  action: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  actionText: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "600" },
  lock: { backgroundColor: chatTokens.accent, borderColor: chatTokens.accent },
  lockText: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  dots: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", paddingTop: 10 },
  dotTarget: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255, 255, 255, 0.24)" },
  dotTodo: { backgroundColor: "rgba(255, 178, 122, 0.55)" },
  dotOn: { width: 20, backgroundColor: chatTokens.accent },
  counter: { color: chatTokens.textSecondary, fontSize: 13, fontWeight: "600", textAlign: "center", paddingTop: 2 },
  helper: { color: chatTokens.textSoft, fontSize: 12, textAlign: "center", paddingHorizontal: 24, paddingTop: 4 },
});
