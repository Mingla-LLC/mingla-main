/**
 * Issue #4435 (design v4 flow 4): everything an OPEN plan card shows. The
 * card folds by default (PlanCardBubble); opening it renders this, which is
 * the #4261 card body moved here unchanged: hero or link, place votes,
 * Suggest another place, the time vote, Add your time, Lock in, the note,
 * who's going, RSVP, the comment nudge and comments, with Edit and Cancel on
 * long press for the maker. The shared pieces (poll block, RSVP grid, add-time
 * editor, comment nudge) live here too; PlanCardBubble re-exports them for the
 * Matches sheet.
 */
import React, { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { resolvePlacePhotoThumbSource } from "../../utils/placePhotoThumb";
import {
  canLockWithoutVote,
  formatPlanTime,
  isFutureSlot,
  isHttpsImage,
  leadingPlace,
  lockableLeader,
  lockLabelParts,
  optionVotersLine,
  rsvpSummary,
  slotToDate,
  viewerRsvp,
  type PlanFormSlot,
} from "./planModel";
import { PlanDateTimeFields } from "./PlanTimePickerSheet";
import { PlanLinkRow } from "./PlanLinkRow";
import { PlanPlaceOptions, PlanSuggestPlaceButton } from "./PlanPlaceOptions";
import type { ChatPlan, ChatPlanPlaceOption, PlanRsvp } from "../../types/chatPlans";
import type { PlanActions } from "./PlanCardBubble";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export function PlanPollBlock({
  plan,
  viewerId,
  memberCount,
  nameOf,
  compact = false,
  onVote,
}: {
  plan: ChatPlan;
  viewerId: string;
  memberCount: number;
  nameOf: (userId: string | null) => string;
  compact?: boolean;
  onVote: (optionId: string) => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation(["chat"]);
  const size = Math.max(1, memberCount);
  return (
    <View style={styles.optionList}>
      {plan.options.map((option) => {
        const mine = option.voterIds.includes(viewerId);
        const share = Math.min(1, option.voterIds.length / size);
        // Amendment 1 B-5: "Added by" only for someone other than the creator; "You" first.
        const votersText = optionVotersLine(
          option,
          plan,
          viewerId,
          nameOf,
          (key, params) => t(`chat:${key}`, params),
          "time",
        );
        const label = formatPlanTime(option.startsAt, i18n.language);
        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.option, mine ? styles.optionMine : null, compact && styles.optionCompact]}
            onPress={() => onVote(option.id)}
            disabled={plan.status !== "deciding"}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${option.voterIds.length}`}
            accessibilityState={{ selected: mine }}
            testID={`plan-option-${option.id}`}
          >
            <View style={[styles.optionFill, mine ? styles.optionFillMine : styles.optionFillOther, { width: `${Math.round(share * 100)}%` }]} />
            <View style={[styles.ring, compact && styles.ringCompact, mine && styles.ringMine]}>
              {mine ? <Icon name="checkmark" size={compact ? 10 : 12} color={chatTokens.textPrimary} /> : null}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel} numberOfLines={1}>{label}</Text>
              {votersText ? (
                <Text style={[styles.optionVoters, compact && styles.optionVotersCompact]} numberOfLines={1}>
                  {votersText}
                </Text>
              ) : null}
            </View>
            <Text style={styles.optionCount}>{option.voterIds.length}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PlanRsvpGrid({
  plan,
  viewerId,
  onRsvp,
}: {
  plan: ChatPlan;
  viewerId: string;
  onRsvp: (status: PlanRsvp) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const mine = viewerRsvp(plan, viewerId);
  const buttons: Array<{ status: PlanRsvp; label: string }> = [
    { status: "going", label: t("chat:plan_going") },
    { status: "maybe", label: t("chat:plan_maybe") },
    { status: "cant", label: t("chat:plan_cant") },
  ];
  return (
    <View style={styles.rsvpGrid}>
      {buttons.map((button) => {
        const selected = mine === button.status;
        return (
          <TouchableOpacity
            key={button.status}
            style={[
              styles.rsvpButton,
              selected && button.status === "going" && styles.rsvpGoing,
              selected && button.status === "maybe" && styles.rsvpMaybe,
              selected && button.status === "cant" && styles.rsvpCant,
            ]}
            onPress={() => onRsvp(button.status)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={button.label}
            accessibilityState={{ selected }}
            testID={`plan-rsvp-${button.status}`}
          >
            <Text style={[styles.rsvpText, selected && button.status === "maybe" && styles.rsvpMaybeText]}>{button.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PlanAddTimeEditor({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (startsAtIso: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const [slot, setSlot] = useState<PlanFormSlot>({ date: "", time: "19:00" });
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (busy) return;
    if (!slot.date) {
      setError(t("chat:plan_pick_date_first"));
      return;
    }
    if (!isFutureSlot(slot, new Date())) {
      setError(t("chat:plan_past_time"));
      return;
    }
    const at = slotToDate(slot);
    if (at) onSubmit(at.toISOString());
  };
  return (
    <View style={styles.editor} testID="plan-add-time-editor">
      <Text style={styles.editorLabel}>{t("chat:plan_your_time_label")}</Text>
      <PlanDateTimeFields
        value={slot}
        onChange={(next) => {
          setSlot(next);
          setError(null);
        }}
        testIDPrefix="plan-add-time"
      />
      {error ? <Text style={styles.editorError}>{error}</Text> : null}
      <View style={styles.editorActions}>
        <TouchableOpacity style={[styles.editorButton, styles.editorGhost]} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel={t("chat:plan_form_cancel")}>
          <Text style={styles.editorGhostText}>{t("chat:plan_form_cancel")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.editorButton, styles.editorPrimary, busy && styles.disabled]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_add_and_vote")}
          accessibilityState={{ busy }}
          testID="plan-add-time-submit"
        >
          {busy ? <ActivityIndicator size="small" color={chatTokens.textPrimary} /> : <Text style={styles.editorPrimaryText}>{t("chat:plan_add_and_vote")}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function PlanCommentNudge({ onPress }: { onPress: () => void }): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  return (
    <TouchableOpacity
      style={styles.nudge}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={t("chat:plan_comment_nudge")}
      testID="plan-comment-nudge"
    >
      <Icon name="chatbubble-outline" size={14} color={chatTokens.tagDeck} />
      <Text style={styles.nudgeText}>{t("chat:plan_comment_nudge")}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// The open card
// ---------------------------------------------------------------------------

export interface PlanCardDetailsProps {
  plan: ChatPlan;
  viewerId: string;
  memberCount: number;
  nameOf: (userId: string | null) => string;
  actions: PlanActions;
  nudge: { visible: boolean; poke: () => void; hide: () => void };
  onReply: (plan: ChatPlan) => void;
  onOpenComments: (plan: ChatPlan) => void;
  onOpenPlace: (plan: ChatPlan) => void;
  onOpenPlaceOption: (plan: ChatPlan, option: ChatPlanPlaceOption) => void;
  onOpenLink: (url: string, title?: string) => void;
  onSuggestPlace: (plan: ChatPlan) => void;
  onRequestLockTime: (plan: ChatPlan) => void;
  onLongPress: (plan: ChatPlan) => void;
  highlighted?: boolean;
}

export function PlanCardDetails({
  plan,
  viewerId,
  memberCount,
  nameOf,
  actions,
  nudge,
  onReply,
  onOpenComments,
  onOpenPlace,
  onOpenPlaceOption,
  onOpenLink,
  onSuggestPlace,
  onRequestLockTime,
  onLongPress,
  highlighted = false,
}: PlanCardDetailsProps): React.ReactElement {
  const { t, i18n } = useTranslation(["chat"]);
  const [addingTime, setAddingTime] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const payload = { memberCount };

  const cancelled = plan.status === "cancelled";
  const scheduled = plan.status === "scheduled";
  const isPoll = plan.whenMode === "poll" && plan.status === "deciding";
  const leader = lockableLeader(plan);
  const summary = rsvpSummary(plan);
  const summaryParts = [
    summary.going ? t("chat:plan_summary_going", { count: summary.going }) : null,
    summary.maybe ? t("chat:plan_summary_maybe", { count: summary.maybe }) : null,
    summary.cant ? t("chat:plan_summary_cant", { count: summary.cant }) : null,
  ].filter(Boolean);
  const placeVoteShown = plan.places.length >= 2 || (plan.places.length >= 1 && plan.whereKind === "none");
  const leadPlace = placeVoteShown ? leadingPlace(plan.places) : null;
  const isPlacePlan = plan.whereKind === "place" || plan.whereKind === "address";
  const poolPlace = isPlacePlan && !!plan.place?.poolId;
  // Cover: a pool photo through the thumb resolver; a link preview image shown directly (never /render/image/).
  const coverUri = (() => {
    if (photoFailed) return null;
    if (leadPlace) {
      if (leadPlace.poolId) return resolvePlacePhotoThumbSource(leadPlace.photoUrl)?.uri ?? null;
      return isHttpsImage(leadPlace.link?.imageUrl) ? leadPlace.link?.imageUrl ?? null : null;
    }
    if (plan.place?.photoUrl) return resolvePlacePhotoThumbSource(plan.place.photoUrl)?.uri ?? null;
    return isHttpsImage(plan.link?.imageUrl) ? plan.link?.imageUrl ?? null : null;
  })();
  const lockParts = lockLabelParts(plan, i18n.language);
  const lockLabel = lockParts.place
    ? t("chat:plan_lock_in_with_place", { time: lockParts.time, place: lockParts.place })
    : t("chat:plan_lock_in", { time: lockParts.time });
  const canSuggest = !cancelled && plan.status === "deciding" && plan.canAddPlace;
  const pickedByVote = scheduled && plan.whenMode === "poll";
  const creatorName = plan.createdBy === viewerId ? t("chat:you") : plan.createdByName || nameOf(plan.createdBy);
  const pollHint = plan.options.length === 0
    ? t("chat:plan_poll_hint_empty")
    : plan.canLock
      ? t("chat:plan_poll_hint_owner")
      : t("chat:plan_poll_hint_other", { name: creatorName });
  const locking = actions.lockingPlanId === plan.id;


  return (
  <TouchableOpacity
    activeOpacity={1}
    onLongPress={() => onLongPress(plan)}
    delayLongPress={450}
    style={[styles.card, highlighted && styles.cardHighlighted]}
    accessibilityHint={t("chat:plan_edit")}
  >
    {placeVoteShown ? (
      coverUri ? (
        <View style={styles.cover}>
          <Image source={{ uri: coverUri }} style={styles.heroImage} resizeMode="cover" onError={() => setPhotoFailed(true)} />
        </View>
      ) : null
    ) : poolPlace ? (
      <TouchableOpacity
        style={styles.hero}
        onPress={() => onOpenPlace(plan)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={[plan.place?.name, plan.place?.address].filter(Boolean).join(", ")}
        testID="plan-card-place"
      >
        {coverUri ? (
          <Image
            source={{ uri: coverUri }}
            style={styles.heroImage}
            resizeMode="cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : null}
        <View style={styles.heroRow}>
          <View style={styles.pin}>
            <Icon name="location" size={16} color={chatTokens.textPrimary} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroName} numberOfLines={1}>{plan.place?.name}</Text>
            {plan.place?.address ? <Text style={styles.heroArea} numberOfLines={1}>{plan.place.address}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
    ) : isPlacePlan ? (
      // Not on Mingla: an optional cover, the place line (no tap), then its own link or "Open in Maps".
      <>
        {coverUri ? (
          <View style={styles.cover}>
            <Image source={{ uri: coverUri }} style={styles.heroImage} resizeMode="cover" onError={() => setPhotoFailed(true)} />
          </View>
        ) : null}
        <View style={styles.placeLine} testID="plan-card-place-line">
          <View style={styles.pin}>
            <Icon name="location" size={16} color={chatTokens.textPrimary} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroName} numberOfLines={1}>{plan.place?.name}</Text>
            {plan.place?.address ? <Text style={styles.heroArea} numberOfLines={1}>{plan.place.address}</Text> : null}
          </View>
        </View>
        <View style={styles.linkRowWrap}>
          <PlanLinkRow
            link={plan.link}
            mapsSubtitle={plan.place?.address || plan.place?.name}
            onPress={() => onOpenPlace(plan)}
          />
        </View>
      </>
    ) : null}
    {!placeVoteShown && plan.whereKind === "link" && plan.link ? (
      <>
        {coverUri ? (
          <View style={styles.cover}>
            <Image source={{ uri: coverUri }} style={styles.heroImage} resizeMode="cover" onError={() => setPhotoFailed(true)} />
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.linkBlock}
          onPress={() => onOpenLink(plan.link?.url ?? "", plan.link?.title ?? plan.link?.domain)}
          activeOpacity={0.85}
          accessibilityRole="link"
          accessibilityLabel={t("chat:plan_open_link_a11y", { domain: plan.link.domain })}
          testID="plan-card-link"
        >
          <View style={styles.linkIcon}>
            <Icon name="link" size={20} color={chatTokens.tagChat} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.linkDomain} numberOfLines={1}>{plan.link.siteName?.trim() || plan.link.domain}</Text>
            <Text style={styles.linkUrl} numberOfLines={2}>{plan.link.title?.trim() || plan.link.url}</Text>
          </View>
        </TouchableOpacity>
      </>
    ) : null}

    <View style={styles.body}>
      <Text style={styles.title} numberOfLines={3}>{plan.title}</Text>

      {cancelled ? <Text style={styles.cancelledText}>{t("chat:plan_cancelled")}</Text> : null}

      {!cancelled && placeVoteShown && plan.status === "deciding" ? (
        <PlanPlaceOptions
          plan={plan}
          viewerId={viewerId}
          memberCount={payload?.memberCount ?? 1}
          nameOf={nameOf}
          heading={t("chat:plan_voting_place_heading")}
          onVote={(optionId) => {
            actions.placeVote(plan, optionId);
            nudge.poke();
          }}
          onOpen={(option) => onOpenPlaceOption(plan, option)}
          onSuggest={canSuggest ? () => onSuggestPlace(plan) : undefined}
        />
      ) : null}
      {canSuggest && !placeVoteShown ? <PlanSuggestPlaceButton onPress={() => onSuggestPlace(plan)} /> : null}

      {!cancelled && scheduled && plan.scheduledAt ? (
        <View style={styles.whenRow}>
          <Icon name="time-outline" size={15} color={chatTokens.textSecondary} />
          <Text style={styles.whenText}>{formatPlanTime(plan.scheduledAt, i18n.language)}</Text>
          {pickedByVote ? (
            <View style={styles.pickedChip}>
              <Text style={styles.pickedText}>{t("chat:plan_picked_by_vote")}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {!cancelled && isPoll ? (
        <View style={styles.pollBlock}>
          <Text style={styles.pollHeading}>{t("chat:plan_voting_heading")}</Text>
          <PlanPollBlock
            plan={plan}
            viewerId={viewerId}
            memberCount={payload?.memberCount ?? 1}
            nameOf={nameOf}
            onVote={(optionId) => {
              actions.vote(plan, optionId);
              nudge.poke();
            }}
          />
          <Text style={styles.hint}>{pollHint}</Text>
        </View>
      ) : null}

      {!cancelled && plan.status === "deciding" && plan.canAddTime ? (
        addingTime ? (
          <PlanAddTimeEditor
            busy={actions.addingTimeFor === plan.id}
            onCancel={() => setAddingTime(false)}
            onSubmit={(iso) => actions.addTime(plan, iso, () => setAddingTime(false))}
          />
        ) : (
          <TouchableOpacity
            style={styles.addTime}
            onPress={() => setAddingTime(true)}
            accessibilityRole="button"
            accessibilityLabel={t("chat:plan_add_your_time")}
            testID="plan-card-add-time"
          >
            <Text style={styles.addTimeText}>{t("chat:plan_add_your_time")}</Text>
          </TouchableOpacity>
        )
      ) : null}

      {!cancelled && leader ? (
        <TouchableOpacity
          style={[styles.lockButton, locking && styles.disabled]}
          onPress={() => actions.lockOption(plan, leader.id)}
          disabled={locking}
          accessibilityRole="button"
          accessibilityLabel={lockLabel}
          accessibilityState={{ busy: locking }}
          testID="plan-card-lock"
        >
          {locking ? (
            <ActivityIndicator size="small" color={chatTokens.tagDeck} />
          ) : (
            <Text style={styles.lockText} numberOfLines={1}>{lockLabel}</Text>
          )}
        </TouchableOpacity>
      ) : null}
      {!cancelled && canLockWithoutVote(plan) ? (
        <TouchableOpacity
          style={styles.lockButton}
          onPress={() => onRequestLockTime(plan)}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_lock_it_in")}
          testID="plan-card-lock-pick"
        >
          <Text style={styles.lockText}>{t("chat:plan_lock_it_in")}</Text>
        </TouchableOpacity>
      ) : null}

      {plan.note ? <Text style={styles.note}>{plan.note}</Text> : null}

      {!cancelled ? (
        <>
          <View style={styles.divider} />
          <View style={styles.goingRow}>
            <View style={styles.goingAvatars}>
              {plan.rsvps.going.slice(0, 5).map((id) => (
                <View key={id} style={styles.goingAvatar}>
                  <Text style={styles.goingAvatarText}>{(id === viewerId ? t("chat:you") : nameOf(id)).slice(0, 1).toUpperCase()}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.summary} numberOfLines={1}>
              {summaryParts.length > 0 ? summaryParts.join(" · ") : t("chat:plan_summary_none")}
            </Text>
          </View>
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
                onReply(plan);
              }}
            />
          ) : null}
        </>
      ) : null}

      {plan.commentCount > 0 ? (
        <TouchableOpacity
          style={styles.comments}
          onPress={() => onOpenComments(plan)}
          hitSlop={{ top: 6, bottom: 6, left: 0, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_comments", { count: plan.commentCount })}
          testID="plan-card-comments"
        >
          <Icon name="chatbubble-outline" size={15} color={chatTokens.textSecondary} />
          <Text style={styles.commentsText}>{t("chat:plan_comments", { count: plan.commentCount })}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  </TouchableOpacity>
  );
}

export const planCardStyles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginVertical: 6, gap: 6 },
  cancelled: { opacity: 0.6 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: chatTokens.surfaceRaised, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { color: chatTokens.textPrimary, fontSize: 10, fontWeight: "700" },
  headerText: { flex: 1, color: chatTokens.textSoft, fontSize: 12 },
  replyPill: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  replyText: { color: chatTokens.textSecondary, fontSize: 12, fontWeight: "600" },
  card: { backgroundColor: chatTokens.surface, borderWidth: 1, borderColor: chatTokens.hairline, borderRadius: 18, overflow: "hidden" },
  cardHighlighted: { borderColor: chatTokens.accent },
  hero: { height: 92, backgroundColor: chatTokens.surfaceRaised, justifyContent: "flex-end" },
  cover: { height: 92, backgroundColor: chatTokens.surfaceRaised },
  placeLine: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  linkRowWrap: { paddingHorizontal: 12, paddingTop: 10 },
  heroImage: { ...StyleSheet.absoluteFillObject, opacity: 0.55 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  pin: { width: 30, height: 30, borderRadius: 15, backgroundColor: chatTokens.accent, alignItems: "center", justifyContent: "center" },
  heroText: { flex: 1, minWidth: 0 },
  heroName: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  heroArea: { color: chatTokens.textSecondary, fontSize: 12 },
  linkBlock: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: chatTokens.surfaceRaised },
  linkIcon: { width: 52, height: 52, borderRadius: 12, backgroundColor: chatTokens.strip, alignItems: "center", justifyContent: "center" },
  linkDomain: { color: chatTokens.tagChat, fontSize: 12 },
  linkUrl: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  body: { paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  chip: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: chatTokens.tagChat },
  chipText: { color: chatTokens.tagText, fontSize: 11, fontWeight: "800" },
  title: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: "700" },
  cancelledText: { color: chatTokens.textSoft, fontSize: 13, fontWeight: "600" },
  whenRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  whenText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  pickedChip: { borderWidth: 1, borderColor: "rgba(52, 211, 153, 0.4)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  pickedText: { color: chatTokens.success, fontSize: 11, fontWeight: "700" },
  pollBlock: { gap: 8 },
  pollHeading: { color: chatTokens.tagDeck, fontSize: 12, fontWeight: "700" },
  optionList: { gap: 6 },
  option: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
  },
  optionCompact: { gap: 8, paddingVertical: 4 },
  optionMine: { borderColor: chatTokens.accent },
  optionFill: { ...StyleSheet.absoluteFillObject, right: undefined },
  optionFillMine: { backgroundColor: "rgba(235, 120, 37, 0.24)" },
  optionFillOther: { backgroundColor: "rgba(255, 255, 255, 0.07)" },
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: chatTokens.textMuted, alignItems: "center", justifyContent: "center" },
  ringCompact: { width: 18, height: 18, borderRadius: 9 },
  ringMine: { borderColor: chatTokens.accent, backgroundColor: chatTokens.accent },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  optionVoters: { color: chatTokens.textSecondary, fontSize: 12 },
  optionVotersCompact: { fontSize: 11 },
  optionCount: { color: chatTokens.textPrimary, fontSize: 13, fontWeight: "700" },
  hint: { color: chatTokens.textSoft, fontSize: 12 },
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
  editor: { gap: 6, padding: 10, borderRadius: 12, backgroundColor: chatTokens.surfaceRaised },
  editorLabel: { color: chatTokens.textSecondary, fontSize: 12, fontWeight: "600" },
  editorError: { color: chatTokens.danger, fontSize: 12 },
  editorActions: { flexDirection: "row", gap: 6 },
  editorButton: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  editorGhost: { borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.14)" },
  editorGhostText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  editorPrimary: { backgroundColor: chatTokens.accent },
  editorPrimaryText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  lockButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  lockText: { color: chatTokens.tagDeck, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  note: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 19 },
  divider: { height: 1, backgroundColor: "rgba(255, 255, 255, 0.08)" },
  goingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  goingAvatars: { flexDirection: "row" },
  goingAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: 2,
    borderColor: chatTokens.surface,
    marginRight: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  goingAvatarText: { color: chatTokens.textPrimary, fontSize: 10, fontWeight: "700" },
  summary: { flex: 1, color: chatTokens.textSecondary, fontSize: 13, paddingLeft: 8 },
  rsvpGrid: { flexDirection: "row", gap: 6 },
  rsvpButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpGoing: { backgroundColor: chatTokens.accent, borderColor: chatTokens.accent },
  rsvpMaybe: { backgroundColor: chatTokens.warning, borderColor: chatTokens.warning },
  rsvpCant: { backgroundColor: chatTokens.planCant, borderColor: chatTokens.planCantBorder },
  rsvpText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  rsvpMaybeText: { color: chatTokens.planMaybeText },
  nudge: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.5)",
    backgroundColor: chatTokens.accentSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nudgeText: { color: chatTokens.tagDeck, fontSize: 13, fontWeight: "700" },
  comments: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6 },
  commentsText: { color: "rgba(255, 255, 255, 0.86)", fontSize: 13, fontWeight: "600" },
});

const styles = planCardStyles;
