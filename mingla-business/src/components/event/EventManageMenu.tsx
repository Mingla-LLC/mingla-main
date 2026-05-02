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
  /** Edit details — router.push to /event/{id}/edit. */
  onEdit: () => void;
  /** View public page — router.push to /b/{brand.slug}/{event.eventSlug}. */
  onViewPublic: () => void;
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
  onTransitionalToast,
}) => {
  const actions = useMemo<MenuAction[]>((): MenuAction[] => {
    const list: MenuAction[] = [];

    // Edit details — drafts go to the wizard (existing Cycle 3 route);
    // non-drafts (live / upcoming / past) require Cycle 9b's edit-after-
    // publish wizard mode, which doesn't exist yet. 9a fires a TRANSITIONAL
    // toast for non-drafts to avoid the silent bounce-to-home that the
    // existing edit.tsx triggers when fed a non-draft id (useDraftById
    // returns null → redirect).
    list.push({
      key: "edit",
      icon: "edit",
      label: status === "past" ? "View details" : "Edit details",
      tone: "default",
      onPress: () => {
        onClose();
        if (status === "draft") {
          onEdit();
        } else {
          onTransitionalToast("Edit-after-publish lands Cycle 9b.");
        }
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

    // Orders — non-draft (live + upcoming + past)
    if (status !== "draft") {
      list.push({
        key: "orders",
        icon: "ticket",
        label: "Orders",
        tone: "default",
        onPress: () => {
          onClose();
          onTransitionalToast("Orders ledger lands Cycle 9c.");
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
          onTransitionalToast("End ticket sales lands Cycle 9b.");
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

    if (status === "draft" || status === "upcoming") {
      list.push({
        key: "delete",
        icon: "trash",
        label: "Delete event",
        tone: "danger",
        onPress: () => {
          onClose();
          onTransitionalToast("Delete event lands Cycle 9b.");
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
          onTransitionalToast("Refund ops land Cycle 9c.");
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
  }, [status, onClose, onEdit, onViewPublic, onShare, onTransitionalToast]);

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
