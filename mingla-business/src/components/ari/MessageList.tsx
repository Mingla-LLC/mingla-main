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

import React, { useEffect, useRef } from "react";
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
   */
  onAttachDone?: () => void;
  isThinking?: boolean;
  renderThinking?: () => React.ReactNode;
  /** ORCH-1103 — brand name lookup (prompt-known brands) for delete/update display. */
  brandNamesById?: Record<string, string>;
  /** ORCH-1103 — signed-in account id, needed to build the brand CoverTarget. */
  accountId?: string | null;
  /** ORCH-1103 — receipt action pill seeds a composer message (never auto-creates). */
  onSeedMessage?: (text: string) => void;
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
  onAttachDone,
}) => {
  const listRef = useRef<FlatList<ListItem>>(null);

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
          return renderToolResult(m, onSeedMessage);
        }
        const text = (m.content as any)?.text ?? "";
        if (!text) return null; // empty rows shouldn't render an empty bubble
        return (
          <ChatBubble
            role={m.role === "user" ? "user" : "assistant"}
            text={text}
            hideOrb={item.hideOrb}
            tail={item.tail}
          />
        );
      }}
    />
  );
};

function renderToolResult(
  m: AgentMessage,
  onSeedMessage?: (text: string) => void,
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
    const brand = r.brand as {
      name: string;
      slug?: string;
      default_currency?: string | null;
      cover_media_url?: string | null;
      cover_media_type?: string | null;
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
