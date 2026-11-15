/**
 * Issue #4261 — a plan in the chat (spec 5.5 #3; prototype Main.dc.html plan
 * card). Rendered for `message_type='plan'` rows, full chat width.
 *
 * The card reads its plan from the chat's one `useChatPlans` cache by id (no
 * per-card request). A plan missing from that payload (older than the list
 * window) shows its title from the message content with a "Plan" chip and
 * opens nothing (Constitution #9: nothing invented).
 *
 * The poll block, RSVP grid, add-time editor and `usePlanActions` are shared
 * with the Matches sheet cards.
 *
 * Issue #4435 (design v4 flow 4, decision F): the card folds by default for
 * everyone. Folded: line 1 tile, title, comment count; line 2 when · where or
 * "3 times · leading Fri 7:30 PM"; one action row (Going / Maybe / Can't,
 * Vote on a time, or Lock in). Tapping the header opens PlanCardDetails, the
 * #4261 card body moved there unchanged.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";
import {
  useAddPlanTime,
  useChatPlans,
  useLockPlan,
  useSetPlanPlaceVote,
  useSetPlanReaction,
  useSetPlanRsvp,
  useSetPlanVote,
} from "../../hooks/useChatPlans";
import { requestLinkPreview } from "../../services/chatPlansService";
import {
  foldedPlanAction,
  foldedPlanLine,
  isPlanCardOpen,
  lockableLeader,
  lockLabelParts,
  needsLinkPreviewRetry,
  setPlanCardOpen,
  toggledChoice,
  viewerReaction,
  viewerRsvp,
} from "./planModel";
import { PlanCardDetails, PlanCommentNudge, PlanRsvpGrid, planCardStyles } from "./PlanCardDetails";
import type { ChatPlan, ChatPlanPlaceOption, PlanReaction, PlanRsvp } from "../../types/chatPlans";

const HIT_SLOP_44 = { top: 6, bottom: 6, left: 6, right: 6 };
const NUDGE_MS = 6000;

// ---------------------------------------------------------------------------
// Shared actions
// ---------------------------------------------------------------------------

export interface PlanActions {
  vote: (plan: ChatPlan, optionId: string) => void;
  placeVote: (plan: ChatPlan, optionId: string) => void;
  rsvp: (plan: ChatPlan, status: PlanRsvp) => void;
  react: (plan: ChatPlan, kind: PlanReaction) => void;
  addTime: (plan: ChatPlan, startsAt: string, onDone: () => void) => void;
  lockOption: (plan: ChatPlan, optionId: string) => void;
  lockAt: (plan: ChatPlan, scheduledAtIso: string, onDone: () => void) => void;
  addingTimeFor: string | null;
  lockingPlanId: string | null;
}

export function usePlanActions(conversationId: string, viewerId: string | null | undefined): PlanActions {
  const voteMutation = useSetPlanVote(conversationId);
  const placeVoteMutation = useSetPlanPlaceVote(conversationId);
  const rsvpMutation = useSetPlanRsvp(conversationId);
  const reactionMutation = useSetPlanReaction(conversationId);
  const addTimeMutation = useAddPlanTime(conversationId);
  const lockMutation = useLockPlan(conversationId, viewerId);

  const vote = useCallback((plan: ChatPlan, optionId: string) => {
    if (!viewerId) return;
    const option = plan.options.find((candidate) => candidate.id === optionId);
    if (!option) return;
    HapticFeedback.light();
    voteMutation.mutate({ optionId, on: !option.voterIds.includes(viewerId), viewerId });
  }, [viewerId, voteMutation]);

  const placeVote = useCallback((plan: ChatPlan, optionId: string) => {
    if (!viewerId) return;
    const option = plan.places.find((candidate) => candidate.id === optionId);
    if (!option) return;
    HapticFeedback.light();
    placeVoteMutation.mutate({ optionId, on: !option.voterIds.includes(viewerId), viewerId });
  }, [placeVoteMutation, viewerId]);

  const rsvp = useCallback((plan: ChatPlan, status: PlanRsvp) => {
    if (!viewerId) return;
    HapticFeedback.light();
    rsvpMutation.mutate({ planId: plan.id, status: toggledChoice(viewerRsvp(plan, viewerId), status), viewerId });
  }, [rsvpMutation, viewerId]);

  const react = useCallback((plan: ChatPlan, kind: PlanReaction) => {
    if (!viewerId) return;
    HapticFeedback.light();
    reactionMutation.mutate({ planId: plan.id, kind: toggledChoice(viewerReaction(plan, viewerId), kind), viewerId });
  }, [reactionMutation, viewerId]);

  const addTime = useCallback((plan: ChatPlan, startsAt: string, onDone: () => void) => {
    if (addTimeMutation.isPending) return;
    addTimeMutation.mutate({ plan, startsAt }, { onSuccess: onDone });
  }, [addTimeMutation]);

  const lockOption = useCallback((plan: ChatPlan, optionId: string) => {
    if (lockMutation.isPending) return;
    HapticFeedback.medium();
    lockMutation.mutate({ plan, optionId });
  }, [lockMutation]);

  const lockAt = useCallback((plan: ChatPlan, scheduledAtIso: string, onDone: () => void) => {
    if (lockMutation.isPending) return;
    HapticFeedback.medium();
    lockMutation.mutate({ plan, scheduledAt: scheduledAtIso }, { onSuccess: onDone });
  }, [lockMutation]);

  return {
    vote,
    placeVote,
    rsvp,
    react,
    addTime,
    lockOption,
    lockAt,
    addingTimeFor: addTimeMutation.isPending ? addTimeMutation.variables?.plan.id ?? null : null,
    lockingPlanId: lockMutation.isPending ? lockMutation.variables?.plan.id ?? null : null,
  };
}

/** "Add a comment about this" for 6 s after a vote or RSVP (reset per tap; never persisted). */
export function useCommentNudge(): { visible: boolean; poke: () => void; hide: () => void } {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const poke = useCallback(() => {
    clear();
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), NUDGE_MS);
  }, []);
  const hide = useCallback(() => {
    clear();
    setVisible(false);
  }, []);
  return { visible, poke, hide };
}

// ---------------------------------------------------------------------------
// Shared pieces: moved to PlanCardDetails with the open card (#4435); the
// Matches sheet keeps importing them from here.
// ---------------------------------------------------------------------------

export { PlanAddTimeEditor, PlanCommentNudge, PlanPollBlock, PlanRsvpGrid } from "./PlanCardDetails";

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

interface PlanCardBubbleProps {
  planId: string;
  conversationId: string;
  /** The plan message's content (title fallback when the plan is not in the list). */
  fallbackContent: string;
  senderName: string;
  isMe: boolean;
  nameOf: (userId: string | null) => string;
  onReply: (plan: ChatPlan) => void;
  onOpenComments: (plan: ChatPlan) => void;
  /** The plan's own place: a Mingla place opens its card; any other its own link or the map, in Mingla. */
  onOpenPlace: (plan: ChatPlan) => void;
  /** A place on the place vote (same rule as `onOpenPlace`). */
  onOpenPlaceOption: (plan: ChatPlan, option: ChatPlanPlaceOption) => void;
  onOpenLink: (url: string, title?: string) => void;
  onSuggestPlace: (plan: ChatPlan) => void;
  onRequestLockTime: (plan: ChatPlan) => void;
  onLongPress: (plan: ChatPlan) => void;
  highlighted?: boolean;
}

function PlanCardBubbleImpl({
  planId,
  conversationId,
  fallbackContent,
  senderName,
  isMe,
  nameOf,
  onReply,
  onOpenComments,
  onOpenPlace,
  onOpenPlaceOption,
  onOpenLink,
  onSuggestPlace,
  onRequestLockTime,
  onLongPress,
  highlighted = false,
}: PlanCardBubbleProps): React.ReactElement {
  const { t, i18n } = useTranslation(["chat"]);
  const plansQuery = useChatPlans(conversationId, true);
  const payload = plansQuery.data;
  const plan = payload?.plans.find((candidate) => candidate.id === planId) ?? null;
  const viewerId = payload?.viewerId ?? null;
  const actions = usePlanActions(conversationId, viewerId);
  const nudge = useCommentNudge();
  // Decision F: folded by default for everyone; an opened card stays open
  // for the life of the open chat (planModel open-card store).
  const [open, setOpen] = useState(() => isPlanCardOpen(conversationId, planId));
  const reduceMotion = useA11yPreferences().reduceMotion;
  const toggle = useCallback(() => {
    // Height + opacity, 220 ms ease-out; a cross-fade only under Reduce Motion.
    LayoutAnimation.configureNext(
      reduceMotion
        ? { duration: 220, create: { type: "easeOut", property: "opacity" }, delete: { type: "easeOut", property: "opacity" } }
        : { duration: 220, create: { type: "easeOut", property: "opacity" }, update: { type: "easeOut" }, delete: { type: "easeOut", property: "opacity" } },
    );
    setOpen((prev) => {
      setPlanCardOpen(conversationId, planId, !prev);
      return !prev;
    });
  }, [conversationId, planId, reduceMotion]);

  // Amendment 1 (5.9): a link the server never previewed is asked for once per app session.
  useEffect(() => {
    if (!plan || previewRetried.has(plan.id) || !needsLinkPreviewRetry(plan, Date.now())) return;
    previewRetried.add(plan.id);
    requestLinkPreview(plan.id);
  }, [plan]);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerAvatar}>
        <Text style={styles.headerAvatarText}>{(isMe ? t("chat:you") : senderName).trim().slice(0, 1).toUpperCase() || "?"}</Text>
      </View>
      <Text style={styles.headerText} numberOfLines={1}>
        {isMe ? t("chat:plan_added_by_you") : t("chat:plan_added_by", { name: senderName })}
      </Text>
      {plan ? (
        <TouchableOpacity
          style={styles.replyPill}
          onPress={() => onReply(plan)}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_reply")}
          testID="plan-card-reply"
        >
          <Icon name="chatbubble-outline" size={13} color={chatTokens.textSecondary} />
          <Text style={styles.replyText}>{t("chat:plan_reply")}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (!plan || !viewerId) {
    // Older than the list window (or not loaded yet): the title only, opens nothing.
    const marker = " added a plan: ";
    const at = fallbackContent.indexOf(marker);
    const title = at >= 0 ? fallbackContent.slice(at + marker.length) : fallbackContent;
    return (
      <View style={styles.wrap} testID="plan-card-fallback">
        {header}
        <View style={styles.card}>
          <View style={styles.body}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{t("chat:plan_chip")}</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            {plansQuery.isLoading ? <ActivityIndicator size="small" color={chatTokens.textSoft} /> : null}
          </View>
        </View>
      </View>
    );
  }
  const cancelled = plan.status === "cancelled";
  return (
    <View style={[styles.wrap, cancelled && styles.cancelled]} testID={`plan-card-${plan.id}`}>
      {header}
      {open ? (
        <View>
          <PlanFoldHeader plan={plan} open locale={i18n.language} onToggle={toggle} />
          <PlanCardDetails
            plan={plan}
            viewerId={viewerId}
            memberCount={payload?.memberCount ?? 1}
            nameOf={nameOf}
            actions={actions}
            nudge={nudge}
            onReply={onReply}
            onOpenComments={onOpenComments}
            onOpenPlace={onOpenPlace}
            onOpenPlaceOption={onOpenPlaceOption}
            onOpenLink={onOpenLink}
            onSuggestPlace={onSuggestPlace}
            onRequestLockTime={onRequestLockTime}
            onLongPress={onLongPress}
            highlighted={highlighted}
          />
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={1}
          onLongPress={() => onLongPress(plan)}
          delayLongPress={450}
          style={[styles.card, highlighted && styles.cardHighlighted]}
          accessibilityHint={t("chat:plan_edit")}
          testID="plan-card-folded"
        >
          <PlanFoldHeader plan={plan} open={false} locale={i18n.language} onToggle={toggle} onOpenComments={() => onOpenComments(plan)} />
          <PlanFoldAction
            plan={plan}
            viewerId={viewerId}
            locking={actions.lockingPlanId === plan.id}
            onRsvp={(status) => {
              actions.rsvp(plan, status);
              nudge.poke();
            }}
            onLock={(optionId) => actions.lockOption(plan, optionId)}
            onOpen={toggle}
          />
          {nudge.visible ? (
            <View style={styles.foldNudge}>
              <PlanCommentNudge
                onPress={() => {
                  nudge.hide();
                  onReply(plan);
                }}
              />
            </View>
          ) : null}
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Line 1: icon tile, title, comment count. Line 2: when · where, or "3 times ·
 * leading Fri 7:30 PM". One button that folds and unfolds the card
 * (accessibilityState.expanded); the RSVP buttons are its siblings.
 */
function PlanFoldHeader({
  plan,
  open,
  locale,
  onToggle,
  onOpenComments,
}: {
  plan: ChatPlan;
  open: boolean;
  locale: string;
  onToggle: () => void;
  onOpenComments?: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const line = foldedPlanLine(plan, locale);
  const second =
    line.kind === "cancelled"
      ? t("chat:plan_cancelled")
      : line.kind === "poll"
        ? line.leadingTime
          ? t("chat:plan_fold_poll_leading", { count: line.count, time: line.leadingTime })
          : t("chat:plan_fold_poll", { count: line.count })
        : [line.time, line.place].filter(Boolean).join(" · ") || t("chat:plan_fold_no_time");
  return (
    <View style={styles.foldTop}>
      <TouchableOpacity
        style={styles.foldHeader}
        onPress={onToggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${plan.title}, ${second}`}
        accessibilityHint={open ? t("chat:plan_fold_hint_close") : t("chat:plan_fold_hint_open")}
        testID="plan-card-toggle"
      >
        <View style={styles.foldTile}>
          <Icon name={plan.whenMode === "poll" && plan.status === "deciding" ? "calendar-outline" : "location"} size={18} color={chatTokens.tagDeck} />
        </View>
        <View style={styles.foldText}>
          <Text style={styles.foldTitle} numberOfLines={1}>{plan.title}</Text>
          <Text style={styles.foldLine} numberOfLines={1}>{second}</Text>
        </View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={chatTokens.textSoft} />
      </TouchableOpacity>
      {!open && plan.commentCount > 0 && onOpenComments ? (
        <TouchableOpacity
          style={styles.foldComments}
          onPress={onOpenComments}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_comments", { count: plan.commentCount })}
        >
          <Icon name="chatbubble-outline" size={14} color={chatTokens.textSecondary} />
          <Text style={styles.foldCommentsText}>{plan.commentCount}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** The folded card's one action row (foldedPlanAction). */
function PlanFoldAction({
  plan,
  viewerId,
  locking,
  onRsvp,
  onLock,
  onOpen,
}: {
  plan: ChatPlan;
  viewerId: string;
  locking: boolean;
  onRsvp: (status: PlanRsvp) => void;
  onLock: (optionId: string) => void;
  onOpen: () => void;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation(["chat"]);
  const action = foldedPlanAction(plan);
  if (action === "none") return null;
  if (action === "rsvp") {
    return (
      <View style={styles.foldAction}>
        <PlanRsvpGrid plan={plan} viewerId={viewerId} onRsvp={onRsvp} />
      </View>
    );
  }
  if (action === "lock") {
    const leader = lockableLeader(plan);
    if (!leader) return null;
    const parts = lockLabelParts(plan, i18n.language);
    const label = parts.place
      ? t("chat:plan_lock_in_with_place", { time: parts.time, place: parts.place })
      : t("chat:plan_lock_in", { time: parts.time });
    return (
      <View style={styles.foldAction}>
        <TouchableOpacity
          style={[styles.lockButton, locking && styles.disabled]}
          onPress={() => onLock(leader.id)}
          disabled={locking}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy: locking }}
          testID="plan-card-fold-lock"
        >
          {locking ? <ActivityIndicator size="small" color={chatTokens.tagDeck} /> : <Text style={styles.lockText} numberOfLines={1}>{label}</Text>}
        </TouchableOpacity>
      </View>
    );
  }
  const label = action === "vote_time" ? t("chat:plan_fold_vote_time") : t("chat:plan_fold_vote_place");
  return (
    <View style={styles.foldAction}>
      <TouchableOpacity
        style={styles.addTime}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="plan-card-fold-vote"
      >
        <Text style={styles.addTimeText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Plans whose link preview this app session already asked for (module memory, never persisted). */
const previewRetried = new Set<string>();

export const PlanCardBubble = React.memo(PlanCardBubbleImpl);

const styles = {
  ...planCardStyles,
  ...StyleSheet.create({
    foldTop: { flexDirection: "row", alignItems: "center" },
    foldHeader: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
    foldTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: chatTokens.accentSoft, alignItems: "center", justifyContent: "center" },
    foldText: { flex: 1, minWidth: 0, gap: 2 },
    foldTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: "700" },
    foldLine: { color: chatTokens.textSecondary, fontSize: 13 },
    foldComments: { minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingRight: 12 },
    foldCommentsText: { color: chatTokens.textSecondary, fontSize: 12, fontWeight: "600" },
    foldAction: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 12 },
    foldNudge: { paddingHorizontal: 12, paddingBottom: 12 },
  }),
};
