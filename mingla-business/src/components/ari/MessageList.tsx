/**
 * ORCH-0821 — MessageList
 * Renders Ari messages in a FlatList. Auto-scrolls to bottom on new message.
 * Renders user bubbles, Ari prose bubbles, tool-result success ribbons, and
 * (when a pending action is live) a ToolProposalCard inline.
 *
 * ORCH-1101 — density spine: speaker grouping. Consecutive same-speaker
 * bubbles cluster with a 4pt gap (gapGroup) instead of the 10pt turn gap
 * (gapTurn); the orb renders only on the first Ari bubble of a group; only the
 * last bubble of a group keeps its tail. Ribbon padding adopts ariThread; the
 * success glyph is lucide Check (crisp on web). The §5 response components
 * (chips / clarifying / multiselect / structured) are presentational and
 * wired by the downstream smart-Ari ORCH — they render as Ari-lane items under
 * the same single-live-at-tail rule.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";

import {
  ariThread,
  glass,
  radius,
  semantic,
  spacing,
  typography,
} from "../../constants/designSystem";

import { AgentMessage } from "../../services/agentChatService";
import { AriSentAttachments } from "./AriAttachmentCards";
import { ChatBubble } from "./ChatBubble";
import { ToolProposalCard } from "./ToolProposalCard";
import { ResponseCard } from "./ResponseCard";
import { buildAnalyticsCardForTool } from "./ariAnalyticsResponseCard";
import { QuickReplyChips } from "./QuickReplyChips";
import { ClarifyingCard } from "./ClarifyingCard";
import { MultiSelectPrompt } from "./MultiSelectPrompt";
import { buildChoiceSubmission, choiceLabel, choicesOf } from "./agentChoices";
import type { AriRenditionInteraction } from "./renditions/AriRenditionPreview";
import { parseAriRendition } from "./renditions/ariRenditionProtocol";
import type { AgentChoiceSubmissionV2 } from "../../services/agentChatService";
import type { PendingActionView } from "../../hooks/useAgentChat";

// #3429 TRIM — this used to be a `React.lazy` "to keep the file-card module off
// the eager path". It never did: AriChatScreen.tsx statically imports
// `AriAttachmentTray` from this very module, so by the time any chat row renders
// the module is already resolved. All the split point bought was a second entry
// edge, which Metro answers by hoisting AriAttachmentCards (and its service and
// analytics deps) out of the lazy `ari` chunk into the EAGER `__common` chunk —
// the exact opposite of the intent. Static import keeps them in `ari`.

/**
 * ORCH-1103 — the result of committing a pending action. `brandId` is set when
 * the executed tool returned a brand (create_brand / update_brand), which the
 * proposal card uses to re-target the cover picker in the create-row-first /
 * attach-second flow (Q7). `ok:false` means the commit errored (toast shown).
 */
import type { ConfirmOutcome } from "./toolProposalTypes";
// #3429 REWORK-2 R-4 — the failed-delivery row renders the ONE connection
// sentence #3184 owns, not a second wording of its own.
import { ARI_CHAT_CONNECTION_COPY } from "../../screens/ari/ariChatErrorCopy";

/** #3355 — inverted-list tolerance (px) for "still at newest". */
const NEWEST_PIN_TOLERANCE_PX = 48;
/** Matches `ariPalette.userBubble` / accent.warm — avoid requiring ariPalette in
 *  suites that mock a partial designSystem (issue_1985). */
const NEW_REPLY_FILL = "#eb7825";
const NEW_REPLY_ON_FILL = "#0F1115";

type AriRenditionCardComponent = typeof import("./renditions/AriRenditionPreview").AriRenditionCard;
let ariRenditionCardComponent: AriRenditionCardComponent | null = null;

/** Keep the animation-heavy rendition surface off ordinary text-only thread
 *  evaluation. Metro still bundles the static module id, then resolves it once
 *  on the first validated structured row. */
const getAriRenditionCard = (): AriRenditionCardComponent => {
  if (!ariRenditionCardComponent) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ariRenditionCardComponent = require("./renditions/AriRenditionPreview").AriRenditionCard as AriRenditionCardComponent;
  }
  return ariRenditionCardComponent;
};

export type { ConfirmOutcome } from "./toolProposalTypes";

export interface MessageListProps {
  messages: AgentMessage[];
  pendingAction: PendingActionView | null;
  isExecuting: boolean;
  onConfirm: (editedArgs?: Record<string, unknown>, keepPending?: boolean) => Promise<ConfirmOutcome>;
  onCancel: () => void;
  /**
   * ORCH-1103 Q7 — the proposal card calls this after the create-for-cover
   * commit + cover attach finishes, so the host clears the now-resolved pending
   * action (the executed tool_result then renders the brand receipt).
   *
   * ORCH-1103 REWORK 3 — carries the cover attached after the create commit so
   * the host can overlay it onto the receipt (the executed row's cover is null).
   */
  onAttachDone?: (cover?: { url: string | null; type: string | null }) => void;
  isThinking?: boolean;
  renderThinking?: () => React.ReactNode;
  /** ORCH-1103 — brand name lookup (prompt-known brands) for delete/update display. */
  brandNamesById?: Record<string, string>;
  /** ORCH-1103 — signed-in account id, needed to build the brand CoverTarget. */
  accountId?: string | null;
  /** ORCH-1103 — receipt action pill seeds a composer message (never auto-creates). */
  onSeedMessage?: (text: string) => void;
  /**
   * ORCH-1103 REWORK 2 — a disambiguation / no-brand-handoff chip was tapped.
   * The chip's label is sent as a normal user turn (Q2 conversational feedback;
   * Gemini re-proposes with the resolved target). The client NEVER pre-fills a
   * tool arg. Defaults to onSeedMessage when omitted.
   */
  onSendChoice?: (submission: AgentChoiceSubmissionV2, label: string) => void;
  onRetryTurn?: (clientTurnId: string) => void;
  choicesDisabled?: boolean;
  /**
   * ORCH-1103 REWORK 3 — covers attached AFTER a create-and-attach commit, keyed
   * by the executed pending_action_id. The executed create_brand tool_result row
   * carries a null cover (it was written before the picker persisted the cover),
   * so the receipt overlays the attached cover from this map when present.
   */
  attachedCovers?: Record<string, { url: string | null; type: string | null }>;
  onEditTurn?: (clientTurnId: string) => void;
  onDiscardTurn?: (clientTurnId: string) => void;
  /** #3355 — a validated structured rendition action was tapped. */
  onRenditionAction?: (message: AgentMessage, interaction: AriRenditionInteraction) => void;
  surface?: "main" | "website";
  /**
   * #3355 — when the host switches conversations, pin/unseen state must reset
   * so a cached history thread does not inherit another chat's scroll mode.
   */
  conversationId?: string | null;
}

/**
 * #2649 — `gapAbove` is the gap that renders ABOVE this row, stamped during the
 * grouping pass. Why a stamped value rather than a flag: this list is
 * `inverted`, so the item FlatList hands the separator is the row rendered
 * BELOW the gap, and a flag whose meaning is relative to data order lands every
 * cluster gap one boundary off. #2649 F-8 measured that happening.
 *
 * It is declared (optional) on the non-bubble variants too, because the
 * separator reads `lead?.gapAbove` off the `ListItem` union and TypeScript will
 * not narrow a property that only one member carries. Nothing stamps it there:
 * `pending`, `thinking` and tool ribbons take the full turn gap via the
 * separator's `?? ariThread.gapTurn` fallback.
 */
type ListItem =
  | {
      kind: "message";
      message: AgentMessage;
      speaker: "user" | "ari";
      hideOrb: boolean;
      tail: boolean;
      gapAbove: number;
    }
  | { kind: "pending"; pendingAction: PendingActionView; gapAbove?: number }
  | { kind: "thinking"; gapAbove?: number };

/** The speaker lane of a rendered row, or null for non-bubble rows (ribbons,
 *  cards, thinking) — those always take the full turn gap. */
function speakerOf(item: ListItem | null | undefined): "user" | "ari" | null {
  if (!item) return null;
  if (item.kind === "message") return item.speaker;
  if (item.kind === "pending") return "ari";
  if (item.kind === "thinking") return "ari";
  return null;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingAction,
  isExecuting,
  onConfirm,
  onCancel,
  isThinking = false,
  renderThinking,
  brandNamesById = {},
  accountId = null,
  onSeedMessage,
  onSendChoice,
  onRetryTurn,
  choicesDisabled = false,
  onAttachDone,
  attachedCovers = {},
  onEditTurn,
  onDiscardTurn,
  onRenditionAction,
  surface = "main",
  conversationId = null,
}) => {
  const listRef = useRef<FlatList<ListItem>>(null);

  // ORCH-1103 REWORK 2 — the tapped chip, keyed by message id. Once tapped, the
  // row collapses to the selected pill (siblings unmount, per QuickReplyChips
  // CHOICE "submitted" state) and stays that way — the follow-up user turn has
  // been sent and re-asking with the same chip would be redundant.
  const [resolvedChoice, setResolvedChoice] = useState<{ messageId: string; optionId: string } | null>(null);
  const [clarifyDraft, setClarifyDraft] = useState<Record<string, string>>({});
  const [multiDraft, setMultiDraft] = useState<Record<string, string[]>>({});
  const [revealSkipSignal, setRevealSkipSignal] = useState(0);
  const [dismissedRenditionIds, setDismissedRenditionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // A failed typed turn remains in the thread as a retryable optimistic row.
  // Re-open the choice when the message set changes so an error never strands
  // a locally-collapsed chip/card. Successful turns are superseded at the tail.
  useEffect(() => setResolvedChoice(null), [messages.length]);

  // Compose the rendered list. Two classes of rows are skipped entirely so
  // they don't leave empty separators in the FlatList:
  //   1. Historical proposal messages — assistant rows whose only content
  //      is a tool_call. The tool_result row tells the story (success
  //      ribbon or Cancelled pill), so rendering "(proposal)" is redundant.
  //   2. Failed tool_result rows — the top toast surfaces the failure copy
  //      and Ari's natural follow-up reply explains the recovery; a red
  //      inline ribbon would be the third indicator for one event.
  //      We keep the row in the DB (Gemini reads it for next-turn context)
  //      but hide it from the visual thread.
  //
  // First pass builds the visible rows; a second pass annotates each bubble
  // with grouping flags (hideOrb / tail) by comparing it to its visible
  // bubble neighbours of the same speaker.
  const raw: ListItem[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls && !(m.content as any)?.text) {
      const pendingId = (m.tool_calls as any).pending_action_id;
      if (pendingAction && pendingId === pendingAction.pending_action_id) {
        continue; // currently active — will render as live ToolProposalCard at tail
      }
      continue; // historical proposal — silent
    }
    if (
      m.role === "tool" && (m.tool_results as any)?.outcome === "failed" &&
      confirmationFailureSentence(m.tool_results) === null
    ) {
      continue; // hidden — toast + Ari follow-up cover an in-turn tool failure
    }
    // ORCH-1103 REWORK 3 — mutual-exclusion between the live proposal card and
    // the executed receipt. During the create-and-attach window the host KEEPS
    // the pending action live (keepPending) so the ToolProposalCard stays
    // mounted to host the cover picker. The executed tool_result for that SAME
    // pending action also lands in the thread — if we rendered it now the card
    // and its receipt would both show (double representation, ORCH-1103 REWORK 3
    // defect #2). The card OWNS the representation until onAttachDone clears the
    // pending action; only THEN does this receipt render (exactly once).
    if (
      m.role === "tool" &&
      pendingAction &&
      (m.tool_results as any)?.pending_action_id === pendingAction.pending_action_id
    ) {
      continue; // suppressed while the live card owns this action
    }
    if (m.role === "tool") {
      // Tool-result ribbon — not a bubble, never grouped.
      raw.push({
        kind: "message",
        message: m,
        speaker: "ari",
        hideOrb: false,
        tail: true,
        gapAbove: ariThread.gapTurn,
      });
      continue;
    }
    const text = (m.content as any)?.text ?? "";
    const attachments = (m.content as { attachments?: unknown[] })?.attachments ?? [];
    const rendition = m.role === "assistant" && !dismissedRenditionIds.has(m.id)
      ? parseAriRendition((m.content as { structured?: { rendition?: unknown } })?.structured?.rendition)
      : null;
    if (!text && attachments.length === 0 && !rendition) continue;
    raw.push({
      kind: "message",
      message: m,
      speaker: m.role === "user" ? "user" : "ari",
      hideOrb: false,
      tail: true,
      gapAbove: ariThread.gapTurn,
    });
  }

  // Grouping pass: a bubble is grouped with its previous sibling when the same
  // speaker AND both are bubble rows (tool ribbons break a group). For an Ari
  // group, follow-ups hideOrb; the non-last bubble in a group drops its tail.
  const isBubble = (it: ListItem): boolean =>
    it.kind === "message" && it.message.role !== "tool";
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    if (cur.kind !== "message" || cur.message.role === "tool") continue;
    const prev = raw[i - 1];
    const next = raw[i + 1];
    const groupedWithPrev =
      !!prev && isBubble(prev) && speakerOf(prev) === cur.speaker;
    const groupedWithNext =
      !!next && isBubble(next) && speakerOf(next) === cur.speaker;
    if (groupedWithPrev && cur.speaker === "ari") cur.hideOrb = true;
    if (groupedWithNext) cur.tail = false; // interior bubble — smooth column
    // #2649 — the gap ABOVE this bubble is the tight cluster gap when it
    // continues the previous speaker's run, the turn gap otherwise. Stamping it
    // here (rather than deriving it in the separator from a neighbour-relative
    // flag) is what survives inversion.
    cur.gapAbove = groupedWithPrev ? ariThread.gapGroup : ariThread.gapTurn;
  }

  const items: ListItem[] = [...raw];
  if (pendingAction) items.push({ kind: "pending", pendingAction });
  if (isThinking) items.push({ kind: "thinking" });

  // #2649 — the thread is bottom-anchored by construction: an `inverted`
  // FlatList paints data[0] at the BOTTOM of the frame, so the newest message
  // rides up with the composer instead of being squeezed off the bottom when
  // the keyboard opens. `items` stays in visual order (oldest first) for the
  // grouping pass above; the list gets it newest-first.
  //
  // Not memoised on purpose: `raw`/`items` are rebuilt on every render (they
  // always were — `data={items}` was already a fresh array each time), so a
  // useMemo keyed on `items` would never hit. This allocates no more than the
  // code it replaces, and it is a named const rather than an inline
  // `[...items].reverse()` in the JSX so the identity is at least readable.
  const invertedItems: ListItem[] = [...items].reverse();

  // ORCH-1103 REWORK 2 — single-live-at-tail for choices: only the LATEST
  // assistant message carrying a choices payload renders interactive chips. Any
  // earlier disambiguation rows are stale (the user already answered or moved on)
  // and must not keep offering taps. A pending proposal also supersedes choices.
  let lastChoiceMessageId: string | null = null;
  if (!pendingAction) {
    for (const it of raw) {
      if (it.kind === "message" && choicesOf(it.message)) lastChoiceMessageId = it.message.id;
    }
  }

  // #3355 settled thread — pin only while the host is at the newest row (or
  // just sent). Reading history must not be stolen by thinking / reveal / card
  // growth; one viewport-anchored "New reply ↓" scrolls once and restores pin.
  const pinnedRef = useRef(true);
  const [pinnedToNewest, setPinnedToNewest] = useState(true);
  const [hasUnseenTail, setHasUnseenTail] = useState(false);
  const scrollGenerationRef = useRef(0);
  const lastTailKeyRef = useRef<string | null>(null);
  const lastUserMessageIdRef = useRef<string | null>(null);

  const newestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const newestId = newestMessage?.id ?? null;
  const newestRole = newestMessage?.role ?? null;
  const pendingId = pendingAction?.pending_action_id ?? null;

  const scrollToNewestOnce = useCallback((animated: boolean) => {
    // Coalesce: a single tail update must not enqueue a second animated scroll.
    scrollGenerationRef.current += 1;
    const generation = scrollGenerationRef.current;
    requestAnimationFrame(() => {
      if (generation !== scrollGenerationRef.current) return;
      // #2649 — newest row is offset 0 on an inverted list.
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);

  const jumpToNewest = useCallback(() => {
    pinnedRef.current = true;
    setPinnedToNewest(true);
    setHasUnseenTail(false);
    scrollToNewestOnce(true);
  }, [scrollToNewestOnce]);

  // Conversation switch — open at newest; cancel any queued scroll from the
  // previous thread.
  useEffect(() => {
    pinnedRef.current = true;
    setPinnedToNewest(true);
    setHasUnseenTail(false);
    lastTailKeyRef.current = null;
    lastUserMessageIdRef.current = null;
    setDismissedRenditionIds(new Set());
    scrollGenerationRef.current += 1;
  }, [conversationId]);

  useEffect(() => {
    if (items.length === 0) return;
    // Logical tail: a pending proposal is one card. `useAgentChat` sets
    // pendingAction before the canonical tool-call row lands, so keying on
    // newestId+pendingId would fire two animated scrolls for one proposal.
    const tailKey =
      typeof pendingId === "string" && pendingId.length > 0
        ? `pending:${pendingId}`
        : `msg:${newestId ?? "none"}`;
    const userJustSent =
      newestRole === "user" &&
      typeof newestId === "string" &&
      newestId !== lastUserMessageIdRef.current;
    if (newestRole === "user" && typeof newestId === "string") {
      lastUserMessageIdRef.current = newestId;
    }
    const previousTail = lastTailKeyRef.current;
    const tailChanged = previousTail !== null && previousTail !== tailKey;
    lastTailKeyRef.current = tailKey;

    if (userJustSent) {
      pinnedRef.current = true;
      setPinnedToNewest(true);
      setHasUnseenTail(false);
      scrollToNewestOnce(true);
      return;
    }
    // First paint for this conversation (or first messages after reset).
    // #2649 — still offset 0 with animated:true; never scrollToEnd on an
    // inverted list (that would jump to the oldest row).
    if (previousTail === null) {
      if (pinnedRef.current) scrollToNewestOnce(true);
      return;
    }
    if (!tailChanged) return;
    if (pinnedRef.current) {
      setHasUnseenTail(false);
      scrollToNewestOnce(true);
      return;
    }
    setHasUnseenTail(true);
    // Intentionally omit isThinking: thinking / reveal / card growth must not
    // animate to offset 0 while the host is reading history (#3355).
  }, [
    items.length,
    newestId,
    newestRole,
    pendingId,
    scrollToNewestOnce,
  ]);

  // #1841 — residual in-row edit field tracked by #1873.
  return (
    // orch-strict-grep-allow orch-0892 — no keyboard-aware virtualised container exists: chat thread must stay FlatList; composer keyboard lives in AriChatScreen.
    <View style={styles.listShell}>
    <FlatList
      ref={listRef}
      // #2649 — bottom-anchored by construction. `inverted` paints data[0] at
      // the frame's bottom edge, which is the edge the composer is attached to,
      // so the thread rides up with the keyboard instead of being clipped by
      // the viewport shrinking underneath a frozen scroll offset. No keyboard
      // height, no listener and no scroll call is involved in holding it there.
      inverted
      data={invertedItems}
      keyExtractor={(item, idx) => {
        if (item.kind === "message") return `m-${item.message.id}`;
        if (item.kind === "pending") return `p-${item.pendingAction.pending_action_id}`;
        return `t-${idx}`;
      }}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={({ leadingItem }) => {
        // FlatList supplies only leadingItem — the item BEFORE this separator in
        // DATA order (the SectionList-only trailingItem prop is never read here,
        // and reading it crashed the thread on send in ORCH-1101).
        //
        // #2649 — the list is inverted, so data order runs newest-first and the
        // leading item is the row rendered BELOW this gap. The quantity we want
        // is therefore that row's own `gapAbove`, stamped during the grouping
        // pass. The predicate this replaced derived the gap from a
        // neighbour-relative flag, which under inversion put every 4pt cluster
        // gap one boundary off (measured, #2649 F-8).
        const lead = leadingItem as ListItem | undefined;
        return <View style={{ height: lead?.gapAbove ?? ariThread.gapTurn }} />;
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={() => setRevealSkipSignal((value) => value + 1)}
      scrollEventThrottle={16}
      onScroll={(event) => {
        // Inverted list: offset 0 is the newest row (visual bottom).
        const offset = event.nativeEvent.contentOffset.y;
        const atNewest = offset <= NEWEST_PIN_TOLERANCE_PX;
        if (atNewest !== pinnedRef.current) {
          pinnedRef.current = atNewest;
          setPinnedToNewest(atNewest);
        }
        if (atNewest) setHasUnseenTail(false);
      }}
      renderItem={({ item }) => {
        if (item.kind === "thinking") {
          return <View>{renderThinking?.()}</View>;
        }
        if (item.kind === "pending") {
          return (
            <ToolProposalCard
              toolName={item.pendingAction.tool_name}
              args={item.pendingAction.tool_args}
              isExecuting={isExecuting}
              onConfirm={onConfirm}
              onCancel={onCancel}
              brandNamesById={brandNamesById}
              accountId={accountId}
              onAttachDone={onAttachDone}
              // #3040 B-C14 — the persisted proposal id keys Ari's ad video.
              proposalId={item.pendingAction.pending_action_id}
            />
          );
        }
        const m = item.message;
        if (m.role === "tool") {
          return renderToolResult(m, onSeedMessage, attachedCovers);
        }
        const text = (m.content as any)?.text ?? "";
        const attachments = ((m.content as { attachments?: unknown }).attachments ?? []) as import("../../services/ariAttachmentService").AriSentAttachment[];
        const rendition = m.role === "assistant" && !dismissedRenditionIds.has(m.id)
          ? parseAriRendition((m.content as { structured?: { rendition?: unknown } })?.structured?.rendition)
          : null;
        const AriRenditionCard = rendition ? getAriRenditionCard() : null;
        if (!text && attachments.length === 0 && !rendition) return null;
        const localDelivery = (m.content as { local_delivery?: string }).local_delivery;

        // ORCH-1103 REWORK 2 — render disambiguation / no-brand-handoff chips
        // beneath an Ari bubble that carries a choices payload (SPEC §6.ii/§6.v,
        // DESIGN §5/§7). Only the latest such row is interactive; tapping a chip
        // sends its label as a normal user turn (Q2 conversational feedback).
        const choices = choicesOf(m);
        const bubble = (
          <View>
            {m.role === "user" && attachments.length ? (
              <AriSentAttachments attachments={attachments} surface={surface} />
            ) : null}
            {text ? (
              <ChatBubble
                role={m.role === "user" ? "user" : "assistant"}
                text={text}
                hideOrb={item.hideOrb}
                tail={item.tail}
                reveal={m.role === "assistant" && (m.content as { local_reveal?: boolean }).local_reveal === true}
                revealSkipSignal={revealSkipSignal}
                surface={surface}
              />
            ) : null}
            {rendition && AriRenditionCard ? (
              <View style={text ? styles.renditionAfterText : undefined}>
                <AriRenditionCard
                  rendition={rendition}
                  showOrb={!text && !item.hideOrb}
                  onAction={(interaction) => {
                    if (interaction.action.behavior.type === "local" &&
                        interaction.action.behavior.command === "dismiss") {
                      setDismissedRenditionIds((current) => new Set([...current, m.id]));
                    }
                    onRenditionAction?.(m, interaction);
                  }}
                />
              </View>
            ) : null}
            {m.role === "user" && localDelivery && localDelivery !== "failed" ? (
              localDelivery === "sending" ? (
                <Text style={styles.deliveryMeta}>Sending…</Text>
              ) : (
                // P2-1: Sent (with its check) as soon as the turn is accepted.
                <View style={styles.deliverySent} accessible accessibilityRole="text" accessibilityLabel="Sent">
                  <Check size={12} color={ariThread.tertiaryText} strokeWidth={2.25} />
                  <Text style={styles.deliverySentText}>Sent</Text>
                </View>
              )
            ) : null}
            {m.role === "user" && localDelivery === "failed" && m.client_turn_id ? (
              <View style={styles.deliveryFailure} accessibilityRole="alert">
                <Text style={styles.deliveryFailureCopy}>{(m.content as { local_error?: string }).local_error ?? ARI_CHAT_CONNECTION_COPY}</Text>
                <View style={styles.deliveryActions}>
                  <Pressable onPress={() => onRetryTurn?.(m.client_turn_id as string)} style={styles.retryTurn} accessibilityRole="button" accessibilityLabel={`Retry sending ${text}`}><Text style={styles.retryTurnText}>Retry</Text></Pressable>
                  <Pressable onPress={() => onEditTurn?.(m.client_turn_id as string)} style={styles.retryTurn} accessibilityRole="button" accessibilityLabel={`Edit ${text}`}><Text style={styles.retryTurnText}>Edit</Text></Pressable>
                  <Pressable onPress={() => onDiscardTurn?.(m.client_turn_id as string)} style={styles.retryTurn} accessibilityRole="button" accessibilityLabel={`Discard ${text}`}><Text style={styles.retryTurnText}>Discard</Text></Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
        if (!choices) return bubble;

        const isResolved = resolvedChoice?.messageId === m.id;
        const isLatest = lastChoiceMessageId === m.id;
        // Stale rows (superseded by a newer turn / pending proposal) collapse to
        // nothing extra — just the bubble — so they can't be tapped again.
        if (!isLatest && !isResolved) return bubble;
        if (choices.kind === "clarifying" && choices.options.length === 0) {
          const typed = clarifyDraft[m.id] ?? "";
          const clarifyState = isResolved
            ? "submitted"
            : choicesDisabled
              ? "disabled"
            : typed.trim().length > 0
              ? "typed"
              : "default";
          return (
            <View>
              {bubble}
              <View style={styles.choicesRow}>
                <ClarifyingCard
                  question={choices.prompt}
                  value={typed}
                  state={clarifyState}
                  onChange={(next) => setClarifyDraft((prev) => ({ ...prev, [m.id]: next }))}
                  onSubmit={() => {
                    const label = typed.trim();
                    if (!label) return;
                    const submission = buildChoiceSubmission(choices, [], label);
                    if (!submission) return;
                    setResolvedChoice({ messageId: m.id, optionId: "typed" });
                    onSendChoice?.(submission, label);
                  }}
                />
              </View>
            </View>
          );
        }
        if (choices.kind === "multi_select") {
          const selectedIds = multiDraft[m.id] ?? [];
          return (
            <View>
              {bubble}
              <View style={styles.choicesRow}>
                <MultiSelectPrompt
                  title={choices.prompt}
                  options={choices.options}
                  selectedIds={selectedIds}
                  state={isResolved ? "submitted" : "default"}
                  disabled={choicesDisabled}
                  onToggle={(id) => {
                    setMultiDraft((prev) => {
                      const cur = prev[m.id] ?? [];
                      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
                      return { ...prev, [m.id]: next };
                    });
                  }}
                  onConfirm={() => {
                    const ids = multiDraft[m.id] ?? [];
                    const submission = buildChoiceSubmission(choices, ids);
                    if (!submission) return;
                    const label = choiceLabel(choices, ids);
                    setResolvedChoice({ messageId: m.id, optionId: ids.join(",") });
                    onSendChoice?.(submission, label);
                  }}
                />
              </View>
            </View>
          );
        }
        return (
          <View>
            {bubble}
            <View style={styles.choicesRow}>
              <QuickReplyChips
                options={choices.options}
                selectedId={isResolved ? resolvedChoice?.optionId : undefined}
                state={isResolved ? "submitted" : "default"}
                disabled={choicesDisabled}
                onSelectId={(optionId) => {
                  const submission = buildChoiceSubmission(choices, [optionId]);
                  if (!submission) return;
                  const label = choiceLabel(choices, [optionId]);
                  setResolvedChoice({ messageId: m.id, optionId });
                  onSendChoice?.(submission, label);
                }}
              />
            </View>
          </View>
        );
      }}
    />
    {hasUnseenTail && !pinnedToNewest ? (
      <View style={styles.newReplyOverlay} pointerEvents="box-none">
        <Pressable
          onPress={jumpToNewest}
          accessibilityRole="button"
          accessibilityLabel="New reply"
          hitSlop={8}
          style={styles.newReplyButton}
        >
          <Text style={styles.newReplyLabel}>New reply ↓</Text>
        </Pressable>
      </View>
    ) : null}
    </View>
  );
};

/**
 * #3614 — what a confirmation that did NOT happen leaves behind.
 *
 * A failed tool result stays hidden when it came from Ari's own turn: the model
 * writes a follow-up reply that explains it, so an inline ribbon would be a
 * third, redundant indicator.
 *
 * A CONFIRMATION has no such follow-up. agent-confirm-action writes an
 * assistant message only on the EXECUTED path, so a refused confirm left the
 * proposal card vanishing (its terminal tool row resolves the pending action)
 * and nothing said — the entire visible outcome was a toast that dismisses
 * itself in twelve seconds. On 2026-09-28 an operator confirmed a Website draft
 * edit, the server refused it 403, and the thread kept no trace at all: the
 * report was "no write, no error, no toast; the card simply disappeared."
 *
 * A confirmation must either apply or fail loudly, so the one row that proves
 * it failed is rendered. `pending_action_id` is the discriminator: only
 * agent-confirm-action's terminalization writes it onto a tool result, and an
 * in-turn failure from agent-chat never carries one.
 *
 * The stored reason is `CODE: sentence`. Only the sentence is shown, and only
 * when the reason really has that shape — anything else gets fixed copy, so no
 * internal code, database text or raw throw message can reach the thread.
 */
export function confirmationFailureSentence(toolResults: unknown): string | null {
  const tr = toolResults as
    | { outcome?: unknown; pending_action_id?: unknown; reason?: unknown }
    | null
    | undefined;
  if (tr?.outcome !== "failed" || typeof tr?.pending_action_id !== "string") {
    return null;
  }
  const reason = typeof tr.reason === "string" ? tr.reason.trim() : "";
  const detail = /^[A-Z][A-Z0-9_]*:\s+(\S.*)$/.exec(reason)?.[1]?.trim();
  return detail && detail.length <= 200
    ? `That didn't go through. ${detail}`
    : "That didn't go through, so nothing changed. Ask Ari to try it again.";
}

function renderToolResult(
  m: AgentMessage,
  onSeedMessage?: (text: string) => void,
  attachedCovers: Record<string, { url: string | null; type: string | null }> = {},
): React.ReactElement | null {
  const tr = m.tool_results as any;
  const outcome = tr?.outcome ?? "executed";

  // An IN-TURN tool failure is surfaced via the top toast AND Ari's natural
  // follow-up reply that explains the recovery. The inline red ribbon was a
  // third, redundant indicator that leaked raw error codes into the chat
  // thread. Keep the tool_result row in the DB (Gemini reads it on the next
  // turn for context) but don't render it in the UI.
  //
  // A refused CONFIRMATION is the exception — see
  // `confirmationFailureSentence`. It has no follow-up to lean on.
  if (outcome === "failed") {
    const sentence = confirmationFailureSentence(tr);
    if (sentence === null) return null;
    return (
      <View style={styles.failedRibbon} accessibilityRole="alert">
        <Text style={styles.failedText}>{sentence}</Text>
      </View>
    );
  }

  if (outcome === "cancelled") {
    return (
      <View style={styles.cancelledRibbon}>
        <Text style={styles.cancelledText}>Cancelled</Text>
      </View>
    );
  }

  // executed
  const r = tr?.result;

  // ORCH-1103 — brand create/update render a ResponseCard receipt (real cover
  // thumbnail + rows + next-action) INSTEAD of the thin ribbon. Other tools
  // keep the ribbon.
  if (
    (tr?.tool_name === "create_brand" || tr?.tool_name === "update_brand") &&
    r?.brand?.name
  ) {
    const created = tr.tool_name === "create_brand";
    const rawBrand = r.brand as {
      name: string;
      slug?: string;
      default_currency?: string | null;
      cover_media_url?: string | null;
      cover_media_type?: string | null;
    };
    // ORCH-1103 REWORK 3 — the executed create_brand row was written BEFORE the
    // create-and-attach cover landed, so its cover is null. Overlay the cover the
    // user actually attached (keyed by this row's pending_action_id) so the
    // receipt shows the real cover thumbnail / video badge (defect #3). The
    // tool_result value wins when present (UPDATE path or future-deployed edge
    // fn that echoes the cover); the override is the fallback for create-attach.
    // We merge onto the brand object so the downstream cover logic stays a single
    // read of brand.cover_media_url / brand.cover_media_type.
    const attached = tr?.pending_action_id ? attachedCovers[tr.pending_action_id as string] : undefined;
    const brand = {
      ...rawBrand,
      cover_media_url: rawBrand.cover_media_url ?? attached?.url ?? null,
      cover_media_type: rawBrand.cover_media_type ?? attached?.type ?? null,
    };
    const rows: { label: string; value: string }[] = [];
    if (brand.default_currency) rows.push({ label: "Currency", value: brand.default_currency });
    if (brand.slug) rows.push({ label: "Slug", value: brand.slug });
    const coverType =
      brand.cover_media_type === "video"
        ? "Video"
        : brand.cover_media_type === "gif"
          ? "GIF"
          : brand.cover_media_type === "image"
            ? "Image"
            : null;
    if (coverType) rows.push({ label: "Cover", value: coverType });

    // Anti-slop: REAL cover URI only; video → no thumbnail (no still frame).
    const thumbnail =
      brand.cover_media_url && brand.cover_media_type !== "video"
        ? brand.cover_media_url
        : undefined;

    const actionLabel = created ? "Add your first event?" : "Edit";
    return (
      <ResponseCard
        title={`${created ? "Created" : "Updated"} ${brand.name}`}
        rows={rows}
        thumbnail={thumbnail}
        actions={[{ id: created ? "add_event" : "edit", label: actionLabel }]}
        state="default"
        onAction={() => {
          // Seeds a composer message only — NEVER auto-creates an event
          // (non-goal chaining respected).
          if (created) {
            onSeedMessage?.(`Create an event for ${brand.name}`);
          } else {
            onSeedMessage?.(`Edit ${brand.name}`);
          }
        }}
      />
    );
  }

  // #1984 — analytics reads render as ResponseCard metric rows (not a thin ribbon).
  if (typeof tr?.tool_name === "string") {
    const analyticsCard = buildAnalyticsCardForTool(tr.tool_name, r);
    if (analyticsCard) {
      return (
        <ResponseCard
          eyebrow={analyticsCard.eyebrow}
          title={analyticsCard.title}
          rows={analyticsCard.rows}
          actions={
            analyticsCard.seedAction
              ? [{ id: analyticsCard.seedAction.id, label: analyticsCard.seedAction.label }]
              : undefined
          }
          state={analyticsCard.state}
          onAction={() => {
            if (analyticsCard.seedAction) {
              onSeedMessage?.(analyticsCard.seedAction.message);
            }
          }}
        />
      );
    }
  }

  // executed — derive a short label (ribbon for non-brand tools)
  let label = "Done";
  if (tr?.tool_name === "create_event" && r?.event?.title) {
    label = `Created "${r.event.title}"`;
  } else if (tr?.tool_name === "update_event") {
    label = "Updated event";
  } else if (tr?.tool_name === "delete_brand") {
    label = "Deleted brand";
  } else if (
    tr?.tool_name === "propose_site_content_update" ||
    tr?.tool_name === "propose_site_settings_update" ||
    tr?.tool_name === "attach_approved_site_media"
  ) {
    label = "Website draft updated — not published";
  } else if (tr?.tool_name === "create_site_preview") {
    label = "Private Website preview ready";
  } else if (tr?.tool_name === "publish_site") {
    label = "Website publication operation started";
  } else if (tr?.tool_name === "rollback_site") {
    label = "Earlier Website version is publishing as a new version";
  }
  return (
    <View style={styles.successRibbon} accessibilityRole="text" accessibilityLabel={label}>
      <Check size={13} color={semantic.success} strokeWidth={2.5} />
      <Text style={styles.successText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listShell: {
    flex: 1,
    position: "relative",
  },
  // Viewport-anchored (not ListHeader) so history reading still sees it (#3355).
  newReplyOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.sm,
    alignItems: "center",
    zIndex: 2,
  },
  newReplyButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: NEW_REPLY_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  newReplyLabel: {
    fontSize: 14,
    lineHeight: 18,
    color: NEW_REPLY_ON_FILL,
    fontWeight: "600",
  },
  content: {
    paddingHorizontal: spacing.md,
    // ORCH-1101: tighter top; bottom keeps scroll clearance above the composer.
    //
    // #2649 — THESE VALUES ARE PRE-TRANSFORM AND ARE DELIBERATELY SWAPPED. The
    // list is `inverted`, so the content container is flipped: paddingTop here
    // renders at the visual BOTTOM and paddingBottom at the visual TOP. The
    // rendered result is unchanged from ORCH-1101 — 8 at the visual top, 32 of
    // scroll clearance above the composer. Leaving them "the right way round"
    // collapses the visual bottom clearance from 32 to 8 (measured). Do not
    // "fix" this back.
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    width: "100%",
    maxWidth: ariThread.threadMaxWidth,
    alignSelf: "center",
  },
  // ORCH-1103 REWORK 2 — chips sit under the Ari bubble, indented past the orb
  // gutter (24px orb + orbGap, matching ChatBubble's orbWrap) so they align with
  // the bubble text, with a small breath above.
  choicesRow: {
    marginTop: ariThread.gapGroup,
    marginLeft: 24 + ariThread.orbGap,
  },
  renditionAfterText: {
    marginTop: ariThread.gapGroup,
  },
  retryTurn: {
    alignSelf: "flex-end",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  retryTurnText: {
    color: ariThread.actionText,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
  deliveryMeta: { alignSelf: "flex-end", color: ariThread.tertiaryText, fontSize: 12, lineHeight: 16, marginTop: spacing.xs },
  deliverySent: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  deliverySentText: { color: ariThread.tertiaryText, fontSize: 12, lineHeight: 16 },
  deliveryFailure: { alignSelf: "flex-end", width: "84%", borderWidth: 1, borderColor: semantic.error, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, marginTop: spacing.xs },
  deliveryFailureCopy: { color: ariThread.secondaryText, fontSize: 14, lineHeight: 20 },
  deliveryActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end" },
  successRibbon: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: semantic.successTint,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: ariThread.ribbonPadH, // 10
    paddingVertical: ariThread.ribbonPadV, // 5
  },
  successText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.success,
  },
  cancelledRibbon: {
    alignSelf: "flex-start",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: ariThread.ribbonPadH,
    paddingVertical: ariThread.ribbonPadV,
  },
  cancelledText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.7)",
  },
  // An in-turn tool failure is still surfaced via the top Toast + Ari's
  // follow-up reply and renders no ribbon. #3614 — a refused CONFIRMATION has
  // no follow-up, so it gets this one durable row instead of vanishing.
  failedRibbon: {
    alignSelf: "flex-start",
    maxWidth: "84%",
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
    borderRadius: radius.md,
    paddingHorizontal: ariThread.ribbonPadH,
    paddingVertical: ariThread.ribbonPadV,
  },
  failedText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    // #3284 — error TEXT on a dark surface needs errorText, not error.
    color: semantic.errorText,
  },
});

export default MessageList;
