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

import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
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
import { ChatBubble } from "./ChatBubble";
import { ToolProposalCard } from "./ToolProposalCard";
import { ResponseCard } from "./ResponseCard";
import { QuickReplyChips } from "./QuickReplyChips";
import { choicesOf, resolveChoiceLabel } from "./agentChoices";
import type { PendingActionView } from "../../hooks/useAgentChat";

/**
 * ORCH-1103 — the result of committing a pending action. `brandId` is set when
 * the executed tool returned a brand (create_brand / update_brand), which the
 * proposal card uses to re-target the cover picker in the create-row-first /
 * attach-second flow (Q7). `ok:false` means the commit errored (toast shown).
 */
export interface ConfirmOutcome {
  ok: boolean;
  brandId?: string;
}

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
  onSendChoice?: (label: string) => void;
  /**
   * ORCH-1103 REWORK 3 — covers attached AFTER a create-and-attach commit, keyed
   * by the executed pending_action_id. The executed create_brand tool_result row
   * carries a null cover (it was written before the picker persisted the cover),
   * so the receipt overlays the attached cover from this map when present.
   */
  attachedCovers?: Record<string, { url: string | null; type: string | null }>;
}

type ListItem =
  | { kind: "message"; message: AgentMessage; speaker: "user" | "ari"; hideOrb: boolean; tail: boolean }
  | { kind: "pending"; pendingAction: PendingActionView }
  | { kind: "thinking" };

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
  onAttachDone,
  attachedCovers = {},
}) => {
  const listRef = useRef<FlatList<ListItem>>(null);

  // ORCH-1103 REWORK 2 — the tapped chip, keyed by message id. Once tapped, the
  // row collapses to the selected pill (siblings unmount, per QuickReplyChips
  // CHOICE "submitted" state) and stays that way — the follow-up user turn has
  // been sent and re-asking with the same chip would be redundant.
  const [resolvedChoice, setResolvedChoice] = useState<{ messageId: string; optionId: string } | null>(null);

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
    if (m.role === "tool" && (m.tool_results as any)?.outcome === "failed") {
      continue; // hidden — toast + Ari follow-up cover this
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
      raw.push({ kind: "message", message: m, speaker: "ari", hideOrb: false, tail: true });
      continue;
    }
    const text = (m.content as any)?.text ?? "";
    if (!text) continue; // empty rows shouldn't render an empty bubble
    raw.push({
      kind: "message",
      message: m,
      speaker: m.role === "user" ? "user" : "ari",
      hideOrb: false,
      tail: true,
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
  }

  const items: ListItem[] = [...raw];
  if (pendingAction) items.push({ kind: "pending", pendingAction });
  if (isThinking) items.push({ kind: "thinking" });

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

  const sendChoice = onSendChoice ?? onSeedMessage;

  useEffect(() => {
    if (items.length === 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [items.length, pendingAction?.pending_action_id, isThinking]);

  return (
    <FlatList
      ref={listRef}
      data={items}
      keyExtractor={(item, idx) => {
        if (item.kind === "message") return `m-${item.message.id}`;
        if (item.kind === "pending") return `p-${item.pendingAction.pending_action_id}`;
        return `t-${idx}`;
      }}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={({ leadingItem }) => {
        // FlatList only provides leadingItem (trailingItem is a SectionList
        // prop and is always undefined here). The grouping pass already marked
        // an interior bubble with tail === false, which means it groups with
        // the next row — so the gap after it is the tight group gap (4);
        // everything else takes the turn gap (10).
        const lead = leadingItem as ListItem | undefined;
        const grouped =
          !!lead &&
          lead.kind === "message" &&
          lead.message.role !== "tool" &&
          lead.tail === false;
        return <View style={{ height: grouped ? ariThread.gapGroup : ariThread.gapTurn }} />;
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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
            />
          );
        }
        const m = item.message;
        if (m.role === "tool") {
          return renderToolResult(m, onSeedMessage, attachedCovers);
        }
        const text = (m.content as any)?.text ?? "";
        if (!text) return null; // empty rows shouldn't render an empty bubble

        // ORCH-1103 REWORK 2 — render disambiguation / no-brand-handoff chips
        // beneath an Ari bubble that carries a choices payload (SPEC §6.ii/§6.v,
        // DESIGN §5/§7). Only the latest such row is interactive; tapping a chip
        // sends its label as a normal user turn (Q2 conversational feedback).
        const choices = choicesOf(m);
        const bubble = (
          <ChatBubble
            role={m.role === "user" ? "user" : "assistant"}
            text={text}
            hideOrb={item.hideOrb}
            tail={item.tail}
          />
        );
        if (!choices) return bubble;

        const isResolved = resolvedChoice?.messageId === m.id;
        const isLatest = lastChoiceMessageId === m.id;
        // Stale rows (superseded by a newer turn / pending proposal) collapse to
        // nothing extra — just the bubble — so they can't be tapped again.
        if (!isLatest && !isResolved) return bubble;
        return (
          <View>
            {bubble}
            <View style={styles.choicesRow}>
              <QuickReplyChips
                options={choices.options}
                selectedId={isResolved ? resolvedChoice?.optionId : undefined}
                state={isResolved ? "submitted" : "default"}
                onSelectId={(optionId) => {
                  const label = resolveChoiceLabel(choices, optionId);
                  if (label == null) return;
                  // Visually resolve (selected pill, siblings unmount) and send
                  // the label as a normal user turn — never a tool pre-fill.
                  setResolvedChoice({ messageId: m.id, optionId });
                  sendChoice?.(label);
                }}
              />
            </View>
          </View>
        );
      }}
    />
  );
};

function renderToolResult(
  m: AgentMessage,
  onSeedMessage?: (text: string) => void,
  attachedCovers: Record<string, { url: string | null; type: string | null }> = {},
): React.ReactElement | null {
  const tr = m.tool_results as any;
  const outcome = tr?.outcome ?? "executed";

  // Failures are surfaced via the top toast AND Ari's natural follow-up
  // reply that explains the recovery. The inline red ribbon was a third,
  // redundant indicator that leaked raw error codes into the chat thread.
  // Keep the tool_result row in the DB (Gemini reads it on the next turn
  // for context) but don't render it in the UI.
  if (outcome === "failed") return null;

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

  // executed — derive a short label (ribbon for non-brand tools)
  let label = "Done";
  if (tr?.tool_name === "create_event" && r?.event?.title) {
    label = `Created "${r.event.title}"`;
  } else if (tr?.tool_name === "update_event") {
    label = "Updated event";
  } else if (tr?.tool_name === "delete_brand") {
    label = "Deleted brand";
  }
  return (
    <View style={styles.successRibbon} accessibilityRole="text" accessibilityLabel={label}>
      <Check size={13} color={semantic.success} strokeWidth={2.5} />
      <Text style={styles.successText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.md,
    // ORCH-1101: tighter top; bottom keeps scroll clearance above the composer.
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  // ORCH-1103 REWORK 2 — chips sit under the Ari bubble, indented past the orb
  // gutter (24px orb + orbGap, matching ChatBubble's orbWrap) so they align with
  // the bubble text, with a small breath above.
  choicesRow: {
    marginTop: ariThread.gapGroup,
    marginLeft: 24 + ariThread.orbGap,
  },
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
  // failedRibbon/failedText removed — failed tool outcomes are surfaced via
  // the top Toast + Ari's follow-up reply instead of an inline ribbon.
});

export default MessageList;
