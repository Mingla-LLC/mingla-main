/**
 * Wizard Step 5 — Tickets.
 *
 * Cycle 3 baseline: inline ticket creation + edit (name + Free toggle +
 * Unlimited toggle + price + capacity).
 *
 * Cycle 5 expansion (this file):
 *   - 6 new modifier toggles/inputs in the sheet:
 *       visibility (public/hidden/disabled),
 *       approvalRequired, passwordProtected (+ password input),
 *       waitlistEnabled, min/max purchase qty, allowTransfers.
 *   - Up/down arrow reorder column on each TicketCard
 *     (NOT drag-and-drop — Q-3 web-safe pick).
 *   - Pure modifier toggles, NO segmented type picker (Q-1) — the 13
 *     PRD §4.2 "types" emerge from modifier combinations.
 *   - All ticket display flows through `ticketDisplay.ts` helpers
 *     (Constitution #2 — establishes invariant I-15).
 *
 * Free events bypass the publish-gate Stripe requirement (Cycle 3).
 *
 * Per Cycle 5 spec §3.4 + §3.5 + §3.6.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  TicketAvailableAt,
  TicketStub,
  TicketVisibility,
} from "../../store/draftEventStore";
import { generateTicketId } from "../../utils/draftEventId";
import { formatGbpRound } from "../../utils/currency";
import {
  formatTicketBadges,
  formatTicketCapacity,
  formatTicketSubline,
  moveTicketDown,
  moveTicketUp,
  nextDisplayOrder,
  sortTicketsByDisplayOrder,
} from "../../utils/ticketDisplay";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

import { errorForKey, type StepBodyProps } from "./types";

// ---- TicketCard -----------------------------------------------------

interface TicketCardProps {
  ticket: TicketStub;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  errorMessage?: string;
  /**
   * Sold count for this tier (ORCH-0704 v2 edit-published mode). When
   * > 0, hides the Delete button + shows a "Sold: N" line. Defaults
   * to 0 in create-flow (no edit mode passed).
   */
  soldCount?: number;
}

const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  isFirst,
  isLast,
  onEdit,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  errorMessage,
  soldCount = 0,
}) => {
  const hasSales = soldCount > 0;
  const subLine = formatTicketSubline(ticket);
  const badges = formatTicketBadges(ticket);
  const capacityLabel = formatTicketCapacity(ticket);
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? formatGbpRound(ticket.priceGbp)
      : "—";

  // Disabled-visibility tickets render greyed
  const isDisabled = ticket.visibility === "disabled";

  return (
    <View>
      <View style={styles.cardOuterRow}>
        {/* Left-edge reorder column */}
        <View style={styles.reorderCol}>
          <Pressable
            onPress={onMoveUp}
            disabled={isFirst}
            accessibilityRole="button"
            accessibilityLabel="Move ticket up"
            accessibilityState={{ disabled: isFirst }}
            hitSlop={8}
            style={[styles.reorderBtn, isFirst && styles.reorderBtnDisabled]}
          >
            <Icon
              name="chevU"
              size={14}
              color={isFirst ? textTokens.quaternary : textTokens.tertiary}
            />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={isLast}
            accessibilityRole="button"
            accessibilityLabel="Move ticket down"
            accessibilityState={{ disabled: isLast }}
            hitSlop={8}
            style={[styles.reorderBtn, isLast && styles.reorderBtnDisabled]}
          >
            <Icon
              name="chevD"
              size={14}
              color={isLast ? textTokens.quaternary : textTokens.tertiary}
            />
          </Pressable>
        </View>

        {/* Card body */}
        <View style={styles.cardBodyWrap}>
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={[
              errorMessage !== undefined ? styles.cardError : undefined,
              isDisabled ? styles.cardDisabled : undefined,
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>
                  {ticket.name.length > 0 ? ticket.name : "Untitled ticket"}
                </Text>
                <Text style={styles.cardSub}>{subLine}</Text>
              </View>
              <View style={styles.cardActionsRow}>
                <Pressable
                  onPress={onDuplicate}
                  accessibilityRole="button"
                  accessibilityLabel="Duplicate ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="plus" size={16} color={textTokens.tertiary} />
                </Pressable>
                <Pressable
                  onPress={onEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="edit" size={16} color={textTokens.tertiary} />
                </Pressable>
                {hasSales ? null : (
                  <Pressable
                    onPress={onDelete}
                    accessibilityRole="button"
                    accessibilityLabel="Delete ticket"
                    hitSlop={8}
                    style={styles.cardActionButton}
                  >
                    <Icon name="trash" size={16} color={semantic.error} />
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.cardStatsRow}>
              <View style={styles.cardStatCell}>
                <Text style={styles.cardStatLabel}>Price</Text>
                <Text style={styles.cardStatValue}>{priceLabel}</Text>
              </View>
              <View style={styles.cardStatCell}>
                <Text style={styles.cardStatLabel}>Capacity</Text>
                <Text style={styles.cardStatValue}>{capacityLabel}</Text>
              </View>
              {hasSales ? (
                <View style={styles.cardStatCell}>
                  <Text style={styles.cardStatLabel}>Sold</Text>
                  <Text style={styles.cardStatValue}>{soldCount}</Text>
                </View>
              ) : null}
            </View>

            {/* Badges row — modifiers + visibility states */}
            {badges.length > 0 ? (
              <View style={styles.badgesRow}>
                {badges.map((b) => (
                  <Pill
                    key={b.label}
                    variant={
                      b.variant === "warning"
                        ? "warn"
                        : b.variant === "muted"
                          ? "draft"
                          : b.variant === "accent"
                            ? "accent"
                            : "info"
                    }
                  >
                    {b.label}
                  </Pill>
                ))}
              </View>
            ) : null}
          </GlassCard>
          {errorMessage !== undefined ? (
            <Text style={styles.helperError}>{errorMessage}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

// ---- Visibility sub-sheet -------------------------------------------

interface VisibilitySheetProps {
  visible: boolean;
  current: TicketVisibility;
  onClose: () => void;
  onSelect: (v: TicketVisibility) => void;
}

// Web-only helpers for the datetime-local sale period picker.
// HTML5 `<input type="datetime-local">` value format is "YYYY-MM-DDTHH:MM".
const datetimeLocalFromDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

// Hidden HTML5 inputs for web direct-tap pickers — opacity 0 + 1×1px,
// NOT display:none (display:none breaks showPicker()/.click()).
const HIDDEN_WEB_INPUT_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
} as const;

const VISIBILITY_OPTIONS: ReadonlyArray<{
  id: TicketVisibility;
  label: string;
  sub: string;
}> = [
  {
    id: "public",
    label: "Public",
    sub: "Shown to everyone on the public event page.",
  },
  {
    id: "hidden",
    label: "Hidden — direct link only",
    sub: "Not listed on the public page; only buyers with the direct link see it.",
  },
  {
    id: "disabled",
    label: "Disabled — sales paused",
    sub: "Visible but greyed out. Buyers can't purchase.",
  },
];

const VisibilitySheet: React.FC<VisibilitySheetProps> = ({
  visible,
  current,
  onClose,
  onSelect,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sheetTitle}>Visibility</Text>
        {VISIBILITY_OPTIONS.map((opt) => {
          const active = current === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              style={[styles.visRow, active && styles.visRowActive]}
            >
              <View style={styles.visRowTextCol}>
                <Text
                  style={[
                    styles.visRowLabel,
                    active && styles.visRowLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
                <Text style={styles.visRowSub}>{opt.sub}</Text>
              </View>
              {active ? (
                <Icon name="check" size={18} color={accent.warm} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
};

// ---- Available-at sub-sheet (Cycle 12) ------------------------------

interface AvailableAtSheetProps {
  visible: boolean;
  current: TicketAvailableAt;
  onClose: () => void;
  onSelect: (v: TicketAvailableAt) => void;
}

const AVAILABLE_AT_OPTIONS: ReadonlyArray<{
  id: TicketAvailableAt;
  label: string;
  sub: string;
}> = [
  {
    id: "both",
    label: "Online and at the door",
    sub: "Buyers see this tier on the public page; you can also sell it at the door.",
  },
  {
    id: "online",
    label: "Online only",
    sub: "Hidden from the door-sale flow. Buyers must purchase via the public link.",
  },
  {
    id: "door",
    label: "Door only",
    sub: "Hidden from the public page. Only sellable in person at the door.",
  },
];

const AvailableAtSheet: React.FC<AvailableAtSheetProps> = ({
  visible,
  current,
  onClose,
  onSelect,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sheetTitle}>Available at</Text>
        {AVAILABLE_AT_OPTIONS.map((opt) => {
          const active = current === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              style={[styles.visRow, active && styles.visRowActive]}
            >
              <View style={styles.visRowTextCol}>
                <Text
                  style={[
                    styles.visRowLabel,
                    active && styles.visRowLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
                <Text style={styles.visRowSub}>{opt.sub}</Text>
              </View>
              {active ? (
                <Icon name="check" size={18} color={accent.warm} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
};

// ---- TicketStubSheet ------------------------------------------------

interface TicketStubSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (ticket: TicketStub) => void;
  initial: TicketStub | null;
  /** Used for new tickets — appends at end. */
  nextOrder: number;
  /**
   * Sold count for this tier (ORCH-0704 v2 edit-published mode). When > 0:
   *   - Lock banner shown at top
   *   - Price + isFree + isUnlimited fields rendered disabled
   *   - Capacity shows inline floor error if user enters value < soldCount
   *   - Bottom Delete CTA hidden
   * Defaults to 0 (create-flow / no-sales-tier).
   */
  soldCount?: number;
}

const TicketStubSheet: React.FC<TicketStubSheetProps> = ({
  visible,
  onClose,
  onSave,
  initial,
  nextOrder,
  soldCount = 0,
}) => {
  // ORCH-0704 v2: when this tier has sales, lock price + isFree + isUnlimited
  // fields and surface the refund-first messaging.
  const isPriceLocked = soldCount > 0;
  const insets = useSafeAreaInsets();

  // Existing v3 state
  const [name, setName] = useState<string>("");
  const [isFree, setIsFree] = useState<boolean>(false);
  const [isUnlimited, setIsUnlimited] = useState<boolean>(false);
  const [priceText, setPriceText] = useState<string>("");
  const [capacityText, setCapacityText] = useState<string>("");

  // Cycle 5 (v4) modifier state
  const [visibility, setVisibility] = useState<TicketVisibility>("public");
  const [approvalRequired, setApprovalRequired] = useState<boolean>(false);
  const [passwordProtected, setPasswordProtected] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [waitlistEnabled, setWaitlistEnabled] = useState<boolean>(false);
  const [minQtyText, setMinQtyText] = useState<string>("1");
  const [maxQtyText, setMaxQtyText] = useState<string>("");
  const [allowTransfers, setAllowTransfers] = useState<boolean>(true);

  // Cycle 6 (5b absorption — schema v5):
  const [description, setDescription] = useState<string>("");
  const [saleStartAt, setSaleStartAt] = useState<string | null>(null);
  const [saleEndAt, setSaleEndAt] = useState<string | null>(null);
  // Sale-period picker — bottom-docked inline (same pattern as
  // MultiDateOverrideSheet's time picker). NOT a nested Sheet.
  const [salePickerMode, setSalePickerMode] = useState<
    "start" | "end" | null
  >(null);
  const [salePickerTemp, setSalePickerTemp] = useState<Date | null>(null);

  // Web hidden input refs — tap row → showPicker()/.click() opens browser
  // native datetime picker directly. No Sheet, no Done button on web.
  const saleStartInputRef = useRef<HTMLInputElement | null>(null);
  const saleEndInputRef = useRef<HTMLInputElement | null>(null);

  // Password reveal toggle. Resets to hidden every time the sheet opens
  // (security: never reveal on resume).
  const [passwordRevealed, setPasswordRevealed] = useState<boolean>(false);

  // Visibility sub-sheet
  const [visSheetVisible, setVisSheetVisible] = useState<boolean>(false);

  // Cycle 12 — Available-at sub-sheet
  const [availableAt, setAvailableAt] = useState<TicketAvailableAt>("both");
  const [availSheetVisible, setAvailSheetVisible] = useState<boolean>(false);

  // Keyboard awareness — handled natively via the ScrollView's
  // `automaticallyAdjustKeyboardInsets` prop below. iOS adds bottom
  // contentInsets = keyboardHeight AND auto-scrolls the focused
  // TextInput above the keyboard top. No manual listener needed for
  // single-line inputs at varied vertical positions (Name top,
  // Password mid, Min/Max bottom).
  //
  // We deliberately do NOT manually pad with keyboardHeight — that
  // double-pads with the auto-inset and visually breaks. We deliberately
  // do NOT call scrollToEnd on focus — that pushes top inputs (Name)
  // above the viewport. The native auto-inset is the correct primitive.

  // Sync state from initial when sheet opens
  useEffect(() => {
    if (!visible) return;
    // Always reset reveal-state on sheet open — never auto-show a saved password.
    setPasswordRevealed(false);
    if (initial !== null) {
      setName(initial.name);
      setIsFree(initial.isFree);
      setIsUnlimited(initial.isUnlimited);
      setPriceText(
        initial.priceGbp !== null && !initial.isFree
          ? String(initial.priceGbp)
          : "",
      );
      setCapacityText(
        initial.capacity !== null && !initial.isUnlimited
          ? String(initial.capacity)
          : "",
      );
      setVisibility(initial.visibility);
      setApprovalRequired(initial.approvalRequired);
      setPasswordProtected(initial.passwordProtected);
      setPassword(initial.password ?? "");
      setWaitlistEnabled(initial.waitlistEnabled);
      setMinQtyText(String(initial.minPurchaseQty));
      setMaxQtyText(
        initial.maxPurchaseQty !== null ? String(initial.maxPurchaseQty) : "",
      );
      setAllowTransfers(initial.allowTransfers);
      setDescription(initial.description ?? "");
      setSaleStartAt(initial.saleStartAt);
      setSaleEndAt(initial.saleEndAt);
      setAvailableAt(initial.availableAt);
    } else {
      setName("");
      setIsFree(false);
      setIsUnlimited(false);
      setPriceText("");
      setCapacityText("");
      setVisibility("public");
      setApprovalRequired(false);
      setPasswordProtected(false);
      setPassword("");
      setWaitlistEnabled(false);
      setMinQtyText("1");
      setMaxQtyText("");
      setAllowTransfers(true);
      setDescription("");
      setSaleStartAt(null);
      setSaleEndAt(null);
      setAvailableAt("both");
    }
  }, [visible, initial]);

  const isEditMode = initial !== null;

  // Inline validation hints (live — not from validateTickets, just for UX feedback)
  const passwordTooShort =
    passwordProtected &&
    (password.length === 0 || password.length < 4);
  const waitlistConflict = waitlistEnabled && isUnlimited;
  const parsedMinQty = parseInt(minQtyText, 10);
  const parsedMaxQty =
    maxQtyText.trim().length === 0 ? null : parseInt(maxQtyText, 10);
  const minTooLow = !Number.isFinite(parsedMinQty) || parsedMinQty < 1;
  const maxLessThanMin =
    parsedMaxQty !== null &&
    Number.isFinite(parsedMinQty) &&
    parsedMaxQty < parsedMinQty;
  // Cycle 6 (5b absorption) — sale period validation
  const descriptionTooLong = description.length > 280;
  const saleEndBeforeStart =
    saleStartAt !== null &&
    saleEndAt !== null &&
    new Date(saleEndAt).getTime() <= new Date(saleStartAt).getTime();

  // ORCH-0704 v2 — capacity floor inline validation when tier has sales.
  const parsedCapacityValue = parseInt(capacityText, 10);
  const capacityBelowSold =
    isPriceLocked &&
    !isUnlimited &&
    Number.isFinite(parsedCapacityValue) &&
    parsedCapacityValue < soldCount;

  // Save is gated by name + ALL inline validation hints. The publish-gate
  // validator (validateTickets) catches the same conditions globally;
  // gating Save locally prevents the user from persisting bad combinations
  // into the draft in the first place.
  const canSave =
    name.trim().length > 0 &&
    !passwordTooShort &&
    !waitlistConflict &&
    !minTooLow &&
    !maxLessThanMin &&
    !descriptionTooLong &&
    !saleEndBeforeStart &&
    !capacityBelowSold;

  // Sale period picker handlers — bottom-docked inline DateTimePicker
  // (matches MultiDateOverrideSheet's pattern for in-sheet pickers).
  const handleOpenSalePicker = useCallback(
    (mode: "start" | "end"): void => {
      // Web: trigger hidden input directly. Browser opens native datetime
      // picker. No Sheet, no Done button on web.
      if (Platform.OS === "web") {
        const ref = mode === "start" ? saleStartInputRef : saleEndInputRef;
        const el = ref.current;
        if (el !== null) {
          if (typeof el.showPicker === "function") {
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          } else {
            el.click();
          }
        }
        return;
      }
      // Native (iOS/Android): existing Sheet/dialog flow.
      const initialIso = mode === "start" ? saleStartAt : saleEndAt;
      const initial =
        initialIso !== null ? new Date(initialIso) : new Date();
      setSalePickerTemp(initial);
      setSalePickerMode(mode);
    },
    [saleStartAt, saleEndAt],
  );

  const commitSalePickerValue = useCallback(
    (mode: "start" | "end" | null, d: Date): void => {
      const iso = d.toISOString();
      if (mode === "start") setSaleStartAt(iso);
      else if (mode === "end") setSaleEndAt(iso);
    },
    [],
  );

  const handleSalePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        const mode = salePickerMode;
        setSalePickerMode(null);
        if (event.type === "dismissed" || selected === undefined) return;
        commitSalePickerValue(mode, selected);
        return;
      }
      // iOS: track temp value; commit on Done.
      if (selected !== undefined) setSalePickerTemp(selected);
    },
    [salePickerMode, commitSalePickerValue],
  );

  const handleCloseSalePicker = useCallback((): void => {
    // iOS + Web both Done-commit; Android commits inline via per-change.
    if (
      Platform.OS !== "android" &&
      salePickerTemp !== null &&
      salePickerMode !== null
    ) {
      commitSalePickerValue(salePickerMode, salePickerTemp);
    }
    setSalePickerMode(null);
    setSalePickerTemp(null);
  }, [salePickerMode, salePickerTemp, commitSalePickerValue]);

  const handleClearSaleStart = useCallback((): void => {
    setSaleStartAt(null);
  }, []);

  const handleClearSaleEnd = useCallback((): void => {
    setSaleEndAt(null);
  }, []);

  const formatSaleDateTime = (iso: string | null): string => {
    if (iso === null) return "Not scheduled";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const handleSave = useCallback((): void => {
    const parsedPrice = isFree ? null : parseFloat(priceText);
    const parsedCapacity = isUnlimited ? null : parseInt(capacityText, 10);
    const safeMinQty =
      Number.isFinite(parsedMinQty) && parsedMinQty >= 1 ? parsedMinQty : 1;
    const safeMaxQty =
      parsedMaxQty !== null && Number.isFinite(parsedMaxQty)
        ? parsedMaxQty
        : null;

    const ticket: TicketStub = {
      id: initial?.id ?? generateTicketId(),
      name: name.trim(),
      isFree,
      isUnlimited,
      priceGbp: isFree
        ? null
        : Number.isFinite(parsedPrice)
          ? parsedPrice
          : null,
      capacity: isUnlimited
        ? null
        : Number.isFinite(parsedCapacity)
          ? parsedCapacity
          : null,
      visibility,
      // Preserve displayOrder when editing; assign nextOrder when creating
      displayOrder: initial?.displayOrder ?? nextOrder,
      approvalRequired,
      passwordProtected,
      password: passwordProtected ? password : null,
      waitlistEnabled,
      minPurchaseQty: safeMinQty,
      maxPurchaseQty: safeMaxQty,
      allowTransfers,
      description: description.trim().length > 0 ? description.trim() : null,
      saleStartAt,
      saleEndAt,
      // Cycle 12 — operator-controlled per tier via Available-at picker.
      // Default "both" for new tiers (visible online + door). I-30 enforced
      // via filter chains downstream (J-C1 picker, J-D3 picker, AddCompGuestSheet).
      availableAt,
    };
    onSave(ticket);
  }, [
    name,
    isFree,
    isUnlimited,
    priceText,
    capacityText,
    visibility,
    approvalRequired,
    passwordProtected,
    password,
    waitlistEnabled,
    parsedMinQty,
    parsedMaxQty,
    allowTransfers,
    description,
    saleStartAt,
    saleEndAt,
    availableAt,
    initial,
    nextOrder,
    onSave,
  ]);

  // Visibility row label
  const visibilityLabel =
    VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? "Public";

  // Cycle 12 — Available-at row label
  const availableAtLabel =
    AVAILABLE_AT_OPTIONS.find((o) => o.id === availableAt)?.label ??
    "Online and at the door";

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.bodyWrap}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.sheetContent,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          // iOS native: scrolls focused input into view above keyboard.
          // Combined with NO manual keyboardHeight padding to avoid the
          // double-padding that broke Cycle 3 wizard root. Works for any
          // input position (Name top, Password mid, MinQty near bottom).
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.sheetTitle}>
            {isEditMode ? "Edit ticket" : "Add ticket type"}
          </Text>

          {/* ORCH-0704 v2 — refund-first lock banner shown when this tier has sales */}
          {isPriceLocked ? (
            <View style={styles.lockBanner}>
              <Icon name="flag" size={16} color={accent.warm} />
              <View style={styles.lockBannerTextCol}>
                <Text style={styles.lockBannerTitle}>
                  {soldCount} ticket{soldCount === 1 ? "" : "s"} sold
                </Text>
                <Text style={styles.lockBannerBody}>
                  Existing buyers are protected at the price they paid. To
                  change price or free/paid, refund those buyers first
                  (then add a new tier). Other modifiers, description, and
                  visibility can be edited.
                </Text>
              </View>
            </View>
          ) : null}

          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. General Admission"
                placeholderTextColor={textTokens.quaternary}
                style={styles.textInput}
                accessibilityLabel="Ticket name"
              />
            </View>
          </View>

          {/* Description (optional, max 280) — Cycle 6 5b absorption */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <View
              style={[
                styles.descriptionWrap,
                descriptionTooLong && styles.inputWrapError,
              ]}
            >
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What this ticket includes (e.g. dinner, early entry, meet-and-greet)"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                style={styles.textInputMultiline}
                accessibilityLabel="Ticket description"
              />
            </View>
            {descriptionTooLong ? (
              <Text style={styles.helperError}>
                Max 280 characters ({description.length} / 280).
              </Text>
            ) : (
              <Text style={styles.helperHint}>
                {description.length} / 280 characters
              </Text>
            )}
          </View>

          {/* Free toggle — ORCH-0704 v2: locked when sales exist */}
          <View
            pointerEvents={isPriceLocked ? "none" : "auto"}
            style={isPriceLocked ? styles.disabledRow : undefined}
          >
            <ToggleRow
              label="Free ticket"
              sub={
                isPriceLocked
                  ? "Locked — refund existing buyers to change."
                  : "No charge — guests register for free."
              }
              value={isFree}
              onChange={setIsFree}
              accessibilityLabel="Free ticket"
            />
          </View>

          {/* Price (when not free) — ORCH-0704 v2: locked when sales exist */}
          {!isFree ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Price (£)</Text>
              <View
                style={[
                  styles.inputWrap,
                  isPriceLocked ? styles.inputWrapDisabled : null,
                ]}
              >
                <TextInput
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="35"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="decimal-pad"
                  style={styles.textInput}
                  editable={!isPriceLocked}
                  accessibilityLabel="Ticket price in pounds"
                />
              </View>
              {isPriceLocked ? (
                <Text style={styles.helperHint}>
                  Existing buyers locked at £{priceText || "—"}. Change
                  applies to new buyers only — refund first to change.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Unlimited toggle — ORCH-0704 v2: locked when sales exist */}
          <View
            pointerEvents={isPriceLocked ? "none" : "auto"}
            style={isPriceLocked ? styles.disabledRow : undefined}
          >
            <ToggleRow
              label="Unlimited capacity"
              sub={
                isPriceLocked
                  ? "Locked — refund existing buyers to change."
                  : "No cap on how many people can buy this ticket."
              }
              value={isUnlimited}
              onChange={setIsUnlimited}
              accessibilityLabel="Unlimited capacity"
            />
          </View>

          {/* Capacity (when not unlimited) — ORCH-0704 v2: floor at soldCount */}
          {!isUnlimited ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Capacity</Text>
              <View
                style={[
                  styles.inputWrap,
                  capacityBelowSold && styles.inputWrapError,
                ]}
              >
                <TextInput
                  value={capacityText}
                  onChangeText={setCapacityText}
                  placeholder="200"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="number-pad"
                  style={styles.textInput}
                  accessibilityLabel="Ticket capacity"
                />
              </View>
              {capacityBelowSold ? (
                <Text style={styles.helperError}>
                  Can't go below {soldCount} tickets sold. Increase capacity
                  or refund existing buyers first.
                </Text>
              ) : isPriceLocked ? (
                <Text style={styles.helperHint}>
                  Minimum capacity = {soldCount} (already sold).
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ───── Section: Visibility ───── */}
          <Text style={styles.sectionHeader}>Visibility</Text>
          <View style={styles.field}>
            <Pressable
              onPress={() => setVisSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Visibility: ${visibilityLabel}`}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerValue}>{visibilityLabel}</Text>
              <Icon name="chevD" size={16} color={textTokens.tertiary} />
            </Pressable>
          </View>

          {/* ───── Section: Available at (Cycle 12) ───── */}
          <Text style={styles.sectionHeader}>Available at</Text>
          <View style={styles.field}>
            <Pressable
              onPress={() => setAvailSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Available at: ${availableAtLabel}`}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerValue}>{availableAtLabel}</Text>
              <Icon name="chevD" size={16} color={textTokens.tertiary} />
            </Pressable>
          </View>

          {/* ───── Section: Access controls ───── */}
          <Text style={styles.sectionHeader}>Access controls</Text>

          <ToggleRow
            label="Approval required"
            sub="Buyers will request access. You approve or reject before they pay."
            value={approvalRequired}
            onChange={setApprovalRequired}
            accessibilityLabel="Approval required"
          />

          <ToggleRow
            label="Password protected"
            sub="Only buyers with the password can purchase."
            value={passwordProtected}
            onChange={setPasswordProtected}
            accessibilityLabel="Password protected"
          />

          {passwordProtected ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View
                style={[
                  styles.inputWrap,
                  passwordTooShort && styles.inputWrapError,
                ]}
              >
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min 4 characters"
                  placeholderTextColor={textTokens.quaternary}
                  secureTextEntry={!passwordRevealed}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.textInput}
                  accessibilityLabel="Ticket password"
                />
                <Pressable
                  onPress={() => setPasswordRevealed((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    passwordRevealed ? "Hide password" : "Show password"
                  }
                  hitSlop={8}
                  style={styles.passwordRevealBtn}
                >
                  <Text style={styles.passwordRevealLabel}>
                    {passwordRevealed ? "Hide" : "Show"}
                  </Text>
                </Pressable>
              </View>
              {passwordTooShort ? (
                <Text style={styles.helperError}>
                  Password must be at least 4 characters.
                </Text>
              ) : (
                <Text style={styles.helperHint}>
                  Stored locally; backend hashes when payments go live.
                </Text>
              )}
            </View>
          ) : null}

          <ToggleRow
            label="Enable waitlist"
            sub="When this ticket sells out, buyers can join a waitlist."
            value={waitlistEnabled}
            onChange={setWaitlistEnabled}
            accessibilityLabel="Enable waitlist"
          />

          {waitlistConflict ? (
            <Text style={styles.helperError}>
              Unlimited tickets don't need a waitlist — turn one off.
            </Text>
          ) : null}

          {/* ───── Section: Purchase quantity ───── */}
          <Text style={styles.sectionHeader}>Purchase quantity</Text>

          <View style={styles.qtyRow}>
            <View style={styles.qtyCell}>
              <Text style={styles.fieldLabel}>Min per buyer</Text>
              <View
                style={[styles.inputWrap, minTooLow && styles.inputWrapError]}
              >
                <TextInput
                  value={minQtyText}
                  onChangeText={setMinQtyText}
                  placeholder="1"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="number-pad"
                  style={styles.textInput}
                  accessibilityLabel="Minimum tickets per buyer"
                />
              </View>
            </View>
            <View style={styles.qtyCell}>
              <Text style={styles.fieldLabel}>Max per buyer</Text>
              <View
                style={[
                  styles.inputWrap,
                  maxLessThanMin && styles.inputWrapError,
                ]}
              >
                <TextInput
                  value={maxQtyText}
                  onChangeText={setMaxQtyText}
                  placeholder="No cap"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="number-pad"
                  style={styles.textInput}
                  accessibilityLabel="Maximum tickets per buyer"
                />
              </View>
            </View>
          </View>
          {minTooLow ? (
            <Text style={styles.helperError}>
              Minimum purchase must be at least 1.
            </Text>
          ) : null}
          {maxLessThanMin ? (
            <Text style={styles.helperError}>
              Maximum can't be less than minimum.
            </Text>
          ) : null}
          {!minTooLow && !maxLessThanMin ? (
            <Text style={styles.helperHint}>
              Leave Max blank for no cap per buyer.
            </Text>
          ) : null}

          {/* ───── Section: Sale period (Cycle 6 5b absorption) ───── */}
          <Text style={styles.sectionHeader}>Sale period (optional)</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Sales open</Text>
            <View style={styles.saleRow}>
              <Pressable
                onPress={() => handleOpenSalePicker("start")}
                accessibilityRole="button"
                accessibilityLabel="Set sale start date and time"
                style={styles.salePickerRow}
              >
                <Text
                  style={
                    saleStartAt !== null
                      ? styles.pickerValue
                      : styles.pickerPlaceholder
                  }
                >
                  {formatSaleDateTime(saleStartAt)}
                </Text>
              </Pressable>
              {saleStartAt !== null ? (
                <Pressable
                  onPress={handleClearSaleStart}
                  accessibilityRole="button"
                  accessibilityLabel="Clear sale start"
                  hitSlop={6}
                  style={styles.clearBtn}
                >
                  <Icon name="close" size={14} color={textTokens.tertiary} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Sales close</Text>
            <View
              style={[
                styles.saleRow,
                saleEndBeforeStart && styles.inputWrapError,
              ]}
            >
              <Pressable
                onPress={() => handleOpenSalePicker("end")}
                accessibilityRole="button"
                accessibilityLabel="Set sale end date and time"
                style={styles.salePickerRow}
              >
                <Text
                  style={
                    saleEndAt !== null
                      ? styles.pickerValue
                      : styles.pickerPlaceholder
                  }
                >
                  {formatSaleDateTime(saleEndAt)}
                </Text>
              </Pressable>
              {saleEndAt !== null ? (
                <Pressable
                  onPress={handleClearSaleEnd}
                  accessibilityRole="button"
                  accessibilityLabel="Clear sale end"
                  hitSlop={6}
                  style={styles.clearBtn}
                >
                  <Icon name="close" size={14} color={textTokens.tertiary} />
                </Pressable>
              ) : null}
            </View>
            {saleEndBeforeStart ? (
              <Text style={styles.helperError}>
                Sales close must be after sales open.
              </Text>
            ) : (
              <Text style={styles.helperHint}>
                Leave blank for sales-open-immediately and sales-close-at-event-start.
              </Text>
            )}
          </View>

          {/* ───── Section: Transfer ───── */}
          <Text style={styles.sectionHeader}>Transfer</Text>

          <ToggleRow
            label="Allow transfers"
            sub="Buyers can transfer this ticket to someone else."
            value={allowTransfers}
            onChange={setAllowTransfers}
            accessibilityLabel="Allow transfers"
          />

          {/* Action dock */}
          <GlassCard
            variant="elevated"
            padding={0}
            radius="xxl"
            style={styles.sheetActionDock}
          >
            <View style={styles.sheetActionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="md"
                  onPress={onClose}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label={isEditMode ? "Save changes" : "Save ticket"}
                  variant="primary"
                  size="md"
                  onPress={handleSave}
                  disabled={!canSave}
                  fullWidth
                />
              </View>
            </View>
          </GlassCard>
        </ScrollView>

        {/* Sale period picker dock — iOS Sheet+spinner / Android dialog.
            Web is handled via hidden inputs at component bottom (below);
            handleOpenSalePicker triggers them on web and returns early. */}
        {salePickerMode !== null && Platform.OS === "ios" ? (
          <View style={styles.salePickerDockWrap}>
            <GlassCard
              variant="elevated"
              radius="xl"
              padding={spacing.md}
              style={styles.salePickerDockCard}
            >
              <View style={styles.salePickerDockRow}>
                <Text style={styles.salePickerDockTitle}>
                  {salePickerMode === "start" ? "Sales open" : "Sales close"}
                </Text>
                <Button
                  label="Done"
                  variant="primary"
                  size="md"
                  onPress={handleCloseSalePicker}
                />
              </View>
              {salePickerTemp !== null ? (
                <DateTimePicker
                  value={salePickerTemp}
                  mode="datetime"
                  display="spinner"
                  onChange={handleSalePickerChange}
                  is24Hour
                  textColor="#FFFFFF"
                  themeVariant="dark"
                  style={styles.salePicker}
                />
              ) : null}
            </GlassCard>
          </View>
        ) : null}
      </View>

      {/* Android native datetime dialog — auto-dismisses */}
      {salePickerMode !== null && Platform.OS === "android" ? (
        <DateTimePicker
          value={
            salePickerMode === "start"
              ? saleStartAt !== null
                ? new Date(saleStartAt)
                : new Date()
              : saleEndAt !== null
                ? new Date(saleEndAt)
                : new Date()
          }
          mode="datetime"
          display="default"
          onChange={handleSalePickerChange}
          is24Hour
        />
      ) : null}

      {/* Hidden HTML5 inputs for web direct-tap pickers. */}
      {Platform.OS === "web" ? (
        <>
          <input
            ref={saleStartInputRef}
            type="datetime-local"
            value={
              saleStartAt !== null ? datetimeLocalFromDate(new Date(saleStartAt)) : ""
            }
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [datePart, timePart] = v.split("T");
              const [y, m, d] = datePart.split("-").map(Number);
              const [h, mm] = timePart.split(":").map(Number);
              setSaleStartAt(new Date(y, m - 1, d, h, mm, 0, 0).toISOString());
            }}
            aria-label="Sales open date and time"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
          <input
            ref={saleEndInputRef}
            type="datetime-local"
            value={
              saleEndAt !== null ? datetimeLocalFromDate(new Date(saleEndAt)) : ""
            }
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [datePart, timePart] = v.split("T");
              const [y, m, d] = datePart.split("-").map(Number);
              const [h, mm] = timePart.split(":").map(Number);
              setSaleEndAt(new Date(y, m - 1, d, h, mm, 0, 0).toISOString());
            }}
            aria-label="Sales close date and time"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
        </>
      ) : null}

      <VisibilitySheet
        visible={visSheetVisible}
        current={visibility}
        onClose={() => setVisSheetVisible(false)}
        onSelect={(v) => {
          setVisibility(v);
          setVisSheetVisible(false);
        }}
      />

      <AvailableAtSheet
        visible={availSheetVisible}
        current={availableAt}
        onClose={() => setAvailSheetVisible(false)}
        onSelect={(v) => {
          setAvailableAt(v);
          setAvailSheetVisible(false);
        }}
      />
    </Sheet>
  );
};

// ---- ToggleRow (sub-component) --------------------------------------

interface ToggleRowProps {
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  sub,
  value,
  onChange,
  accessibilityLabel,
}) => (
  <Pressable
    onPress={() => onChange(!value)}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={accessibilityLabel}
    style={styles.toggleRow}
  >
    <View style={styles.toggleLabelCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
      <View
        style={[
          styles.toggleThumb,
          value ? styles.toggleThumbOn : styles.toggleThumbOff,
        ]}
      />
    </View>
  </Pressable>
);

// ---- Main component (Step 5 body) -----------------------------------

export const CreatorStep5Tickets: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  editMode,
}) => {
  // ORCH-0704 v2 — sold-count map. Empty in create-flow + ORCH-0704 stub mode.
  const soldCountByTier = editMode?.soldCountByTier ?? {};
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const emptyError = showErrors
    ? errorForKey(errors, "tickets.empty")
    : undefined;

  const editingTicket: TicketStub | null =
    editingTicketId === null
      ? null
      : (draft.tickets.find((t) => t.id === editingTicketId) ?? null);

  // Sorted tickets — single source of truth for render order.
  const sortedTickets = sortTicketsByDisplayOrder(draft.tickets);

  const handleAddTicket = useCallback((): void => {
    setEditingTicketId(null);
    setSheetVisible(true);
  }, []);

  const handleEditTicket = useCallback((ticketId: string): void => {
    setEditingTicketId(ticketId);
    setSheetVisible(true);
  }, []);

  const handleDuplicateTicket = useCallback(
    (ticketId: string): void => {
      const original = draft.tickets.find((t) => t.id === ticketId);
      if (original === undefined) return;
      // displayOrder is OWNED by ticketDisplay.ts helpers — use nextDisplayOrder.
      const copy: TicketStub = {
        ...original,
        id: generateTicketId(),
        name:
          original.name.length > 0
            ? `${original.name} (copy)`
            : "Untitled (copy)",
        displayOrder: nextDisplayOrder(draft.tickets),
      };
      updateDraft({ tickets: [...draft.tickets, copy] });
    },
    [draft.tickets, updateDraft],
  );

  const handleRequestDelete = useCallback((ticketId: string): void => {
    setPendingDeleteId(ticketId);
  }, []);

  const handleConfirmDelete = useCallback((): void => {
    if (pendingDeleteId === null) return;
    // After delete, renormalize is handled implicitly — sortTicketsByDisplayOrder
    // tolerates gaps, but renormalize keeps storage tidy on next save.
    updateDraft({
      tickets: draft.tickets.filter((t) => t.id !== pendingDeleteId),
    });
    setPendingDeleteId(null);
  }, [pendingDeleteId, draft.tickets, updateDraft]);

  const handleCancelDelete = useCallback((): void => {
    setPendingDeleteId(null);
  }, []);

  const pendingDeleteTicket =
    pendingDeleteId === null
      ? null
      : (draft.tickets.find((t) => t.id === pendingDeleteId) ?? null);

  const handleSaveTicket = useCallback(
    (ticket: TicketStub): void => {
      if (editingTicketId !== null) {
        const next = draft.tickets.map((t) =>
          t.id === editingTicketId ? ticket : t,
        );
        updateDraft({ tickets: next });
      } else {
        updateDraft({ tickets: [...draft.tickets, ticket] });
      }
      setSheetVisible(false);
      setEditingTicketId(null);
    },
    [draft.tickets, editingTicketId, updateDraft],
  );

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
    setEditingTicketId(null);
  }, []);

  // displayOrder is OWNED by ticketDisplay.ts helpers — never set inline.
  const handleMoveUp = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketUp(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  const handleMoveDown = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketDown(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  // Summary computations — handle unlimited + free-only correctly.
  const hasUnlimitedCapacity = draft.tickets.some((t) => t.isUnlimited);
  const hasUnlimitedPaidTicket = draft.tickets.some(
    (t) => t.isUnlimited && !t.isFree,
  );
  const allTicketsFree = draft.tickets.every((t) => t.isFree);

  const totalAvailable = hasUnlimitedCapacity
    ? "Unlimited"
    : (() => {
        const sum = draft.tickets.reduce(
          (acc, t) => acc + (t.capacity ?? 0),
          0,
        );
        // formatCount is used inside formatTicketCapacity; keep here too.
        // Cycle 3 baseline used formatCount — preserve.
        return sum.toString();
      })();

  const maxRevenue = allTicketsFree
    ? "Free event"
    : hasUnlimitedPaidTicket
      ? "Unlimited"
      : formatGbpRound(
          draft.tickets.reduce(
            (sum, t) =>
              sum + (t.isFree ? 0 : (t.priceGbp ?? 0) * (t.capacity ?? 0)),
            0,
          ),
        );

  // Find the next available displayOrder for the new-ticket sheet.
  const nextOrder = nextDisplayOrder(draft.tickets);

  return (
    <View>
      {/* Existing tickets — sorted by displayOrder */}
      {sortedTickets.length > 0 ? (
        <View style={styles.ticketsCol}>
          {sortedTickets.map((t, i) => {
            // Find the original index for error lookup (errors keyed by
            // original tickets[i] index from validation, not sorted index)
            const origIdx = draft.tickets.findIndex((x) => x.id === t.id);
            const nameError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].name`)
              : undefined;
            const priceError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].price`)
              : undefined;
            const capacityError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].capacity`)
              : undefined;
            const passwordError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].password`)
              : undefined;
            const waitlistConflictError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].waitlistConflict`)
              : undefined;
            const minQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].minPurchaseQty`)
              : undefined;
            const maxQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].maxPurchaseQty`)
              : undefined;
            const firstError =
              nameError ??
              priceError ??
              capacityError ??
              passwordError ??
              waitlistConflictError ??
              minQtyError ??
              maxQtyError;
            return (
              <TicketCard
                key={t.id}
                ticket={t}
                index={i}
                isFirst={i === 0}
                isLast={i === sortedTickets.length - 1}
                onEdit={() => handleEditTicket(t.id)}
                onDuplicate={() => handleDuplicateTicket(t.id)}
                onDelete={() => handleRequestDelete(t.id)}
                onMoveUp={() => handleMoveUp(t.id)}
                onMoveDown={() => handleMoveDown(t.id)}
                errorMessage={firstError}
                soldCount={soldCountByTier[t.id] ?? 0}
              />
            );
          })}
        </View>
      ) : null}

      {emptyError !== undefined ? (
        <Text style={styles.helperError}>{emptyError}</Text>
      ) : null}

      <Pressable
        onPress={handleAddTicket}
        accessibilityRole="button"
        accessibilityLabel="Add ticket type"
        style={styles.addCta}
      >
        <Icon name="plus" size={16} color={accent.warm} />
        <Text style={styles.addCtaLabel}>Add ticket type</Text>
      </Pressable>

      {draft.tickets.length > 0 ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
          style={styles.summaryCard}
        >
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tickets available</Text>
            <Text style={styles.summaryValue}>{totalAvailable}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Max revenue</Text>
            <Text style={styles.summaryValue}>{maxRevenue}</Text>
          </View>
        </GlassCard>
      ) : null}

      <TicketStubSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onSave={handleSaveTicket}
        initial={editingTicket}
        nextOrder={nextOrder}
        soldCount={
          editingTicket !== null ? (soldCountByTier[editingTicket.id] ?? 0) : 0
        }
      />

      <ConfirmDialog
        visible={pendingDeleteId !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete this ticket?"
        description={
          pendingDeleteTicket !== null && pendingDeleteTicket.name.length > 0
            ? `"${pendingDeleteTicket.name}" will be removed from this event.`
            : "This ticket will be removed from this event."
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
      />
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  ticketsCol: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  field: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  cardError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  cardDisabled: {
    opacity: 0.55,
  },

  // Card row with reorder column on the left
  cardOuterRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.xs,
  },
  reorderCol: {
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    paddingTop: spacing.xs,
  },
  reorderBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  reorderBtnDisabled: {
    opacity: 0.35,
  },
  cardBodyWrap: {
    flex: 1,
    minWidth: 0,
  },

  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
  },
  cardTitleCol: {
    flex: 1,
  },
  cardTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  cardSub: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  cardActionButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardStatsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  cardStatCell: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radiusTokens.sm,
  },
  cardStatLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
    marginBottom: 2,
  },
  cardStatValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },

  addCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderStyle: "dashed",
    backgroundColor: glass.tint.profileBase,
  },
  addCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  summaryCard: {
    marginTop: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  summaryValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },

  // Sheet --------------------------------------------------------------
  bodyWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  inputWrapError: {
    borderColor: semantic.error,
  },
  // ORCH-0704 v2 — disabled state for locked tier fields (price/free/unlimited)
  inputWrapDisabled: {
    opacity: 0.5,
  },
  disabledRow: {
    opacity: 0.5,
  },
  // ORCH-0704 v2 — refund-first lock banner inside TicketStubSheet
  lockBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginBottom: spacing.lg,
  },
  lockBannerTextCol: {
    flex: 1,
    gap: 4,
  },
  lockBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  lockBannerBody: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  textInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
  },
  passwordRevealBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radiusTokens.sm,
  },
  passwordRevealLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  // Picker row (visibility row in sheet)
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pickerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  pickerPlaceholder: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
  },

  // Toggle row (reused for Free / Unlimited / new modifiers)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },

  // Min/max qty row
  qtyRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  qtyCell: {
    flex: 1,
  },

  // Action dock (matches Cycle 3+4 pattern)
  sheetActionDock: {
    marginTop: spacing.lg,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  sheetActionRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  actionCell: {
    flex: 1,
  },

  // Description (Cycle 6 5b absorption) ------------------------------
  descriptionWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  textInputMultiline: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
    minHeight: 64,
  },

  // Sale period (Cycle 6 5b absorption) -------------------------------
  saleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  salePickerRow: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  salePickerDockWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  salePickerDockCard: {
    // GlassCard provides surface; no extra styling.
  },
  salePickerDockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  salePickerDockTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  salePicker: {
    width: "100%",
  },

  // Visibility sub-sheet rows
  visRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs,
  },
  visRowActive: {
    backgroundColor: accent.tint,
  },
  visRowTextCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  visRowLabel: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  visRowLabelActive: {
    fontWeight: "600",
  },
  visRowSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});
