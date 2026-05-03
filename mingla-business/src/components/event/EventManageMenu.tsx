/**
 * EventManageMenu — Sheet-based context-aware action menu for an event.
 *
 * Per Cycle 9 spec §3.A.2 + investigation §3 OBS-4 — 11 actions, gated
 * by event status.
 *
 * Action wiring in 9a:
 *   - Edit details / View public page / Copy share link / Publish event
 *     wire to REAL navigation or callback.
 *   - Open scanner / Orders / End ticket sales / Duplicate /
 *     Delete event / Issue refunds / Duplicate as new fire TRANSITIONAL
 *     toasts pointing at the right next sub-cycle (9b / 9c / Cycle 11
 *     / future polish).
 *
 * Toast rendering is delegated to the parent — this component fires
 * `onTransitionalToast(message)` for stub actions, and the parent
 * displays via its absolute-positioned Toast wrapper (per memory rule
 * `feedback_toast_needs_absolute_wrap.md`).
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { LiveEvent } from "../../store/liveEventStore";
import type { DraftEvent } from "../../store/draftEventStore";
import type { Brand } from "../../store/currentBrandStore";

import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

import type { EventCardStatus } from "./EventListCard";

export interface EventManageMenuProps {
  visible: boolean;
  onClose: () => void;
  event: LiveEvent | DraftEvent;
  status: EventCardStatus;
  brand: Brand;
  /** Open Cycle 7 ShareModal (parent owns share state). */
  onShare: () => void;
  /** Edit details — router.push to /event/{id}/edit. Drafts only in 9b-1. */
  onEdit: () => void;
  /** View public page — router.push to /b/{brand.slug}/{event.eventSlug}. */
  onViewPublic: () => void;
  /**
   * End ticket sales — parent opens EndSalesSheet. Cycle 9b-1.
   * Live events only (gated by status).
   */
  onEndSales: () => void;
  /**
   * Cancel event — parent opens ConfirmDialog (typeToConfirm).
   * Cycle 9b-1 +fix. Live + upcoming events (gated by status). For drafts,
   * the menu shows Delete event instead (drafts have no public footprint).
   */
  onCancelEvent: () => void;
  /**
   * Delete event (drafts only) — parent opens ConfirmDialog. Cycle 9b-1.
   * Drafts only — live/upcoming events show Cancel event instead.
   */
  onDeleteDraft: () => void;
  /**
   * Open Orders ledger — Cycle 9c. Wired by parent to
   * `router.push('/event/${eventId}/orders')`. Used by both the "Orders"
   * action (non-draft) and the "Issue refunds" action (past — refunds
   * happen via the Orders ledger, not a separate screen).
   */
  onOpenOrders: () => void;
  /**
   * TRANSITIONAL toast — parent wraps in absolute-positioned Toast and
   * fires the message after closing the sheet.
   */
  onTransitionalToast: (message: string) => void;
}

type ActionTone = "default" | "accent" | "warn" | "danger";

interface MenuAction {
  key: string;
  icon: IconName;
  label: string;
  tone: ActionTone;
  onPress: () => void;
}

export const EventManageMenu: React.FC<EventManageMenuProps> = ({
  visible,
  onClose,
  event,
  status,
  brand,
  onShare,
  onEdit,
  onViewPublic,
  onEndSales,
  onCancelEvent,
  onDeleteDraft,
  onOpenOrders,
  onTransitionalToast,
}) => {
  const actions = useMemo<MenuAction[]>((): MenuAction[] => {
    const list: MenuAction[] = [];

    // Edit details — drafts go to the wizard (existing Cycle 3 route);
    // non-drafts (live / upcoming / past) route to the focused
    // EditPublishedScreen via ?mode=edit-published. The route handler
    // (edit.tsx) branches on the mode query param. Cycle 9b-2.
    list.push({
      key: "edit",
      icon: "edit",
      label: status === "past" ? "View details" : "Edit details",
      tone: "default",
      onPress: () => {
        onClose();
        onEdit();
      },
    });

    // View public page — non-draft only (drafts have no public)
    if (status !== "draft") {
      list.push({
        key: "view-public",
        icon: "eye",
        label: "View public page",
        tone: "default",
        onPress: () => {
          onClose();
          onViewPublic();
        },
      });
    }

    // Open scanner — live only
    if (status === "live") {
      list.push({
        key: "scanner",
        icon: "qr",
        label: "Open scanner",
        tone: "default",
        onPress: () => {
          onClose();
          onTransitionalToast("Scanner lands Cycle 11.");
        },
      });
    }

    // Orders — non-draft (live + upcoming + past) — Cycle 9c live wire
    if (status !== "draft") {
      list.push({
        key: "orders",
        icon: "ticket",
        label: "Orders",
        tone: "default",
        onPress: () => {
          onClose();
          onOpenOrders();
        },
      });
    }

    // Copy share link — non-draft
    if (status !== "draft") {
      list.push({
        key: "share",
        icon: "share",
        label: "Copy share link",
        tone: "default",
        onPress: () => {
          onClose();
          onShare();
        },
      });
    }

    // Status-specific actions ---------------------------------------

    if (status === "draft") {
      list.push({
        key: "publish",
        icon: "check",
        label: "Publish event",
        tone: "accent",
        onPress: () => {
          onClose();
          onEdit(); // Routes to wizard; final step has Publish CTA
        },
      });
    }

    if (status === "live") {
      list.push({
        key: "end-sales",
        icon: "close",
        label: "End ticket sales",
        tone: "warn",
        onPress: () => {
          onClose();
          onEndSales();
        },
      });
    }

    // Cancel event — live + upcoming. For live, it's a stronger action
    // than End sales (cancel notifies buyers + refunds). For upcoming,
    // it replaces "Delete event" since live/upcoming events have public
    // footprints and shouldn't be hard-deleted.
    if (status === "live" || status === "upcoming") {
      list.push({
        key: "cancel-event",
        icon: "trash",
        label: "Cancel event",
        tone: "danger",
        onPress: () => {
          onClose();
          onCancelEvent();
        },
      });
    }

    if (status === "upcoming") {
      list.push({
        key: "duplicate",
        icon: "ticket",
        label: "Duplicate",
        tone: "default",
        onPress: () => {
          onClose();
          onTransitionalToast("Duplicate lands a future polish dispatch.");
        },
      });
    }

    // Delete event — drafts ONLY. Upcoming/live events use "Cancel event"
    // above (they have public footprints, shouldn't be hard-deleted).
    if (status === "draft") {
      list.push({
        key: "delete",
        icon: "trash",
        label: "Delete draft",
        tone: "danger",
        onPress: () => {
          onClose();
          onDeleteDraft();
        },
      });
    }

    if (status === "past") {
      list.push({
        key: "issue-refunds",
        icon: "refund",
        label: "Issue refunds",
        tone: "default",
        onPress: () => {
          onClose();
          // Cycle 9c — past-event refunds happen via the Orders ledger
          // (no separate "issue refunds" screen). Same destination as the
          // Orders action above — operator picks the order and refunds.
          onOpenOrders();
        },
      });
      list.push({
        key: "duplicate-as-new",
        icon: "ticket",
        label: "Duplicate as new",
        tone: "default",
        onPress: () => {
          onClose();
          onTransitionalToast("Duplicate as new lands a future polish dispatch.");
        },
      });
    }

    return list;
  }, [status, onClose, onEdit, onViewPublic, onShare, onEndSales, onCancelEvent, onDeleteDraft, onOpenOrders, onTransitionalToast]);

  // Snap calculation — content fit per DEC-084 numeric snap support.
  // Each row ~52px + header padding ~32 + safe spacing ~28 = ~112 + N×52.
  const snapPx = 32 + 28 + actions.length * 52 + spacing.md;

  // Avoid noisy "unused brand var" lint if we don't read it directly:
  void brand;
  void event;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={snapPx}>
      <View style={styles.body}>
        <Text style={styles.heading}>Manage event</Text>
        <View style={styles.actionsList}>
          {actions.map((action) => (
            <ActionRow key={action.key} action={action} />
          ))}
        </View>
      </View>
    </Sheet>
  );
};

interface ActionRowProps {
  action: MenuAction;
}

const TONE_COLOR: Record<ActionTone, string> = {
  default: textTokens.secondary,
  accent: accent.warm,
  warn: semantic.warning,
  danger: semantic.error,
};

const ActionRow: React.FC<ActionRowProps> = ({ action }) => {
  const color = TONE_COLOR[action.tone];
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={({ pressed }) => [
        styles.actionRow,
        pressed && styles.actionRowPressed,
      ]}
    >
      <Icon name={action.icon} size={18} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  actionsList: {
    gap: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    minHeight: 48,
  },
  actionRowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
});

export default EventManageMenu;
