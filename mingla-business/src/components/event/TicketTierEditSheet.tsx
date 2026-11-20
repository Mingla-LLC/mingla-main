/**
 * Ticket tier add/edit sheet — extracted from CreatorStep5Tickets.tsx
 * (Cycle 17d Stage 2 §F.3).
 *
 * Bundles the main edit Sheet + the 2 picker sub-sheets (VisibilitySheet,
 * AvailableAtSheet) + ToggleRow + co-domain helpers. Sub-sheets render
 * INSIDE the parent Sheet's children per
 * `feedback_rn_sub_sheet_must_render_inside_parent` global rule.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type {
  TicketAvailableAt,
  TicketStub,
  TicketVisibility,
} from "../../store/draftEventStore";
import { useEventWaitlist } from "../../hooks/useEventWaitlist";
import type { EventWaitlistEntry } from "../../services/waitlistService";
import { generateTicketId } from "../../utils/draftEventId";
import { saleWindowCaution } from "../../utils/saleWindowCaution";
import { isoFromSaleField, saleFieldValue } from "../../utils/saleWindowFields";
import { ticketPriceEntryMinimumMessage } from "../../utils/ticketPriceMinimum";
import { formatCurrency, minorFromMajor } from "../../utils/currency";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import { Button } from "../ui/Button";
import { HostDateTimeField } from "../ui/HostCalendarFields";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { UNSAVED_CHANGES_DIALOG } from "../../utils/unsavedChangesGuard";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import type { MultiDateEntry } from "../../store/draftEventStore";
import {
  busiestDaySold,
  formatDraftDayScopeLabel,
  liveDayIds,
} from "../../utils/ticketDayScope";
import {
  capacityHelper,
  capacityLabel,
  dayScopeHelper,
  priceHelper,
} from "../../utils/ticketDayScopeCopy";
import { ValidDaysSheet } from "./ValidDaysSheet";
import { TicketExtrasSection } from "./TicketExtrasSection";
import { supabase } from "../../services/supabase";
import { isFeatureEnabled } from "../../config/featureFlags";
import type { TicketExtraStub } from "../../store/draftEventStore";
import {
  extrasFromServer,
  extrasUnavailableFor,
  keepExtraDaysInTier,
  validateTicketExtra,
} from "../../utils/ticketExtras";
import type { NewTicketPreset } from "../../utils/ticketLinkEligibility";
import { canShowTicketTierDiscountControls } from "../discounts/ticketTierDiscountContract";

const TicketLinksSheet = React.lazy(() =>
  import("../guests/TicketLinksSheet").then((module) => ({
    default: module.TicketLinksSheet,
  })),
);

const ItemDiscountControls = React.lazy(() =>
  import("../discounts/ItemDiscountControls").then((module) => ({
    default: module.ItemDiscountControls,
  })),
);

const currencySymbol = (currency?: string): string | null => {
  if (currency === undefined || currency.trim().length === 0) return null;
  try {
    const parts = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.trim().toUpperCase(),
      maximumFractionDigits: 0,
    }).formatToParts(0);
    // #3341 — en-GB prints "NGN" for naira; the label should read "Price (₦)".
    return withCurrencyGlyph(
      parts.find((part) => part.type === "currency")?.value ?? currency,
      currency,
    );
  } catch {
    return currency.trim().toUpperCase();
  }
};

const isValidPriceInput = (value: string): boolean =>
  /^\d*(?:\.\d*)?$/.test(value);

const isValidCapacityInput = (value: string): boolean => /^\d*$/.test(value);

const hasSelectionRange = (
  value: unknown,
): value is { setSelectionRange: (start: number, end: number) => void } =>
  typeof value === "object" &&
  value !== null &&
  "setSelectionRange" in value &&
  typeof value.setSelectionRange === "function";

const reselectWebValueAfterPointer = (
  event: GestureResponderEvent,
  value: string,
): void => {
  if (Platform.OS !== "web" || value.length === 0) return;

  const target: unknown = event.currentTarget;
  requestAnimationFrame(() => {
    if (hasSelectionRange(target)) target.setSelectionRange(0, value.length);
  });
};

// ---- Visibility options ---------------------------------------------

const VISIBILITY_OPTIONS: readonly {
  id: TicketVisibility;
  label: string;
  sub: string;
}[] = [
  {
    id: "public",
    label: "Public",
    sub: "Shown to everyone on the public event page.",
  },
  {
    id: "hidden",
    label: "Hidden — private links only",
    sub: "Not listed publicly. Create revocable links for this ticket after saving.",
  },
  {
    id: "disabled",
    label: "Disabled — sales paused",
    sub: "Visible but greyed out. Buyers can't purchase.",
  },
];

interface VisibilitySheetProps {
  visible: boolean;
  current: TicketVisibility;
  onClose: () => void;
  onSelect: (v: TicketVisibility) => void;
}

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
                <Icon name="check" size={18} color={color.text1} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
};

// ---- Available-at options (Cycle 12) --------------------------------

const AVAILABLE_AT_OPTIONS: readonly {
  id: TicketAvailableAt;
  label: string;
  sub: string;
}[] = [
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

interface AvailableAtSheetProps {
  visible: boolean;
  current: TicketAvailableAt;
  onClose: () => void;
  onSelect: (v: TicketAvailableAt) => void;
}

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
                <Icon name="check" size={18} color={color.text1} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
};

// ---- ToggleRow ------------------------------------------------------

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

interface WaitlistEntriesSheetProps {
  visible: boolean;
  entries: EventWaitlistEntry[];
  onClose: () => void;
}

const maskEmail = (email: string | null): string => {
  if (email === null) return "No email";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "Email hidden";
  return `${local.slice(0, 1)}***@${domain}`;
};

const WaitlistEntryRow: React.FC<{ entry: EventWaitlistEntry }> = ({
  entry,
}) => (
  <View style={styles.waitlistEntryRow}>
    <View style={styles.waitlistEntryTextCol}>
      <Text style={styles.waitlistEntryName}>{entry.name ?? "Anonymous"}</Text>
      <Text style={styles.waitlistEntryMeta}>
        {maskEmail(entry.email)} · Qty {entry.qtyRequested} · {entry.status}
      </Text>
    </View>
  </View>
);

const WaitlistEntriesSheet: React.FC<WaitlistEntriesSheetProps> = ({
  visible,
  entries,
  onClose,
}) => (
  <Sheet visible={visible} onClose={onClose} snapPoint="full">
    <View style={styles.waitlistSheetBody}>
      <Text style={styles.sheetTitle}>Waitlist signups</Text>
      {entries.slice(0, 25).map((entry) => (
        <WaitlistEntryRow key={entry.id} entry={entry} />
      ))}
    </View>
  </Sheet>
);

// ---- TicketTierEditSheet (main export) ------------------------------

/** issue #3350 — typed fields whose red error waits for the organiser to leave them. */
interface TicketSheetTouched {
  name: boolean;
  price: boolean;
  capacity: boolean;
}

const UNTOUCHED: TicketSheetTouched = {
  name: false,
  price: false,
  capacity: false,
};

/** issue #3350 — one reason Save is disabled; `revealed` = shown as an error. */
interface SaveBlocker {
  message: string;
  revealed: boolean;
}

export interface TicketTierEditSheetProps {
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
  /**
   * issue #3313 — true on a recurring event, where capacity is PER NIGHT. The
   * field is labelled "Capacity per night" and its floor copy names the
   * busiest night. Defaults to false (every other event, byte-identical).
   */
  capacityPerNight?: boolean;
  /**
   * issue #3313 — the lowest capacity this ticket may be saved with once it
   * has sales. Defaults to `soldCount`; a recurring event passes its busiest
   * night's sold passes, since the run's total is not comparable with a
   * per-night capacity.
   */
  capacityFloor?: number;
  /**
   * issue #3281 — the event's dates when a ticket can be limited to some of
   * them. Null on every other event, where the sheet is unchanged.
   */
  dayScopeEntries?: readonly MultiDateEntry[] | null;
  /** Undefined hides the price arithmetic rather than guessing the mode. */
  dayScopePricingMode?: "per_day" | "all_days";
  /** Sold passes per date for this ticket. Null while unknown. */
  soldByDay?: Readonly<Record<string, number>> | null;
  /**
   * Cycle 13a J-T6 G2: when false, the Price field is rendered uneditable
   * with a helper hint pointing the operator at a finance_manager+ ask.
   * Defaults to true so create-flow + non-rank-aware callers stay backward
   * compatible.
   */
  canEditPrice?: boolean;
  /** ISO 4217 event/brand currency used for price copy in the sheet. */
  eventCurrency?: string;
  /** Brand owning this published tier; required by the server discount writer. */
  brandId?: string;
  /** Supabase events.id for planner waitlist reads on saved tiers. */
  eventId?: string | null;
  /**
   * issue #2590 — when the event's FIRST occurrence starts, ISO-8601.
   *
   * Used for one caution only: a sale window that closes before the doors open
   * turns away everyone who tries on the day. We Go Again Exhibition shipped
   * exactly that — sales ending 07:00 on the morning of a 13:00 event, six
   * hours early, almost certainly 19:00 misread on a 12-hour picker. Nothing in
   * the product said so, because a stored timestamp is invisible.
   *
   * Optional and defaulting to null so every existing caller — the create flow,
   * and any surface without a resolved date — behaves exactly as before.
   */
  eventStartsAtIso?: string | null;
  /**
   * issue #2590 — when the event's LAST occurrence ENDS, ISO-8601 UTC.
   *
   * Needed because "sales close before the doors" is the SINGLE-DAY shape of
   * the problem. On a multi-day event the damaging shape is different and the
   * first-occurrence check misses it entirely: We Go Again Exhibition sells
   * 29-30 Aug and closes sales at 07:00 on the 30th — comfortably AFTER Day 1
   * opened, so a first-occurrence comparison says nothing, while Day 2 cannot
   * be bought on the day at all. Both bounds are required to tell the two
   * apart. Optional and null in the create wizard.
   */
  eventEndsAtIso?: string | null;
  /**
   * issue #3645 — rendered directly under the Price field. The Tickets step
   * passes the "choose your payout country" card here so a price typed on a
   * brand with no currency asks for the country IN this sheet, while the host
   * is typing, instead of only after the ticket is saved. `priced` is true once
   * the field holds a price above zero on a ticket that is not free. Optional:
   * every other caller renders exactly as before.
   */
  renderUnderPrice?: (priced: boolean) => React.ReactNode;
  /**
   * issue #3827 — a NEW ticket opened from the private-link sheet's empty
   * state starts as a hidden paid ticket or a free ticket. Ignored when
   * `initial` is set (editing keeps the ticket's own values).
   */
  newTicketPreset?: NewTicketPreset | null;
  /** Published-event context for opening private links from a hidden tier. */
  privateLinksEnabled?: boolean;
  /** issue #3281 — editing a published event, where extras are read from the server. */
  liveEdit?: boolean;
  eventTitle?: string;
  allTickets?: TicketStub[];
}

/**
 * #4420 — the values the ticket form opens with. The sheet seeds its fields
 * from this when it opens, and a form whose fields still equal it has nothing
 * to lose, so closing it never asks.
 */
export interface TicketSheetFormValues {
  name: string;
  isFree: boolean;
  isUnlimited: boolean;
  priceText: string;
  capacityText: string;
  visibility: TicketVisibility;
  approvalRequired: boolean;
  waitlistEnabled: boolean;
  minQtyText: string;
  maxQtyText: string;
  allowTransfers: boolean;
  description: string;
  saleStartAt: string | null;
  saleEndAt: string | null;
  availableAt: TicketAvailableAt;
  validDayIds: string[] | null;
}

export const ticketSheetSeed = (
  initial: TicketStub | null,
  newTicketPreset: NewTicketPreset | null,
): TicketSheetFormValues =>
  initial !== null
    ? {
        name: initial.name,
        isFree: initial.isFree,
        isUnlimited: initial.isUnlimited,
        priceText:
          initial.priceGbp !== null && !initial.isFree ? String(initial.priceGbp) : "",
        capacityText:
          initial.capacity !== null && !initial.isUnlimited ? String(initial.capacity) : "",
        visibility: initial.visibility,
        approvalRequired: initial.approvalRequired,
        waitlistEnabled: initial.waitlistEnabled,
        minQtyText: String(initial.minPurchaseQty),
        maxQtyText: initial.maxPurchaseQty !== null ? String(initial.maxPurchaseQty) : "",
        allowTransfers: initial.allowTransfers,
        description: initial.description ?? "",
        saleStartAt: initial.saleStartAt,
        saleEndAt: initial.saleEndAt,
        availableAt: initial.availableAt,
        validDayIds: initial.validDayIds ?? null,
      }
    : {
        name: "",
        isFree: newTicketPreset === "free-guest-list",
        isUnlimited: false,
        priceText: "",
        capacityText: "",
        visibility: newTicketPreset === "hidden-paid" ? "hidden" : "public",
        approvalRequired: false,
        waitlistEnabled: false,
        minQtyText: "1",
        maxQtyText: "",
        allowTransfers: true,
        description: "",
        saleStartAt: null,
        saleEndAt: null,
        availableAt: "both",
        validDayIds: null,
      };

/** issue #3645 — is the text in the Price field a price above zero? */
export const ticketPriceTextIsPriced = (
  isFree: boolean,
  priceText: string,
): boolean => {
  if (isFree) return false;
  const value = Number.parseFloat(priceText);
  return Number.isFinite(value) && value > 0;
};

export const TicketTierEditSheet: React.FC<TicketTierEditSheetProps> = ({
  visible,
  onClose,
  onSave,
  initial,
  nextOrder,
  soldCount = 0,
  capacityPerNight = false,
  capacityFloor,
  dayScopeEntries = null,
  dayScopePricingMode,
  soldByDay = {},
  eventStartsAtIso = null,
  eventEndsAtIso = null,
  canEditPrice = true,
  eventCurrency,
  brandId,
  eventId = null,
  renderUnderPrice,
  newTicketPreset = null,
  privateLinksEnabled = false,
  liveEdit = false,
  eventTitle = "Event",
  allTickets = [],
}) => {
  // ORCH-0704 v2: when this tier has sales, lock price + isFree + isUnlimited
  // fields and surface the refund-first messaging.
  // Cycle 13a J-T6 G2: ALSO lock when caller's rank is below
  // MIN_RANK.EDIT_TICKET_PRICE — finance_manager+ only.
  const isPriceLocked = soldCount > 0 || !canEditPrice;
  const isPriceLockedByRank = !canEditPrice && soldCount === 0;
  const insets = useSafeAreaInsets();

  // Existing v3 state
  const [name, setName] = useState<string>("");
  const [isFree, setIsFree] = useState<boolean>(false);
  const [isUnlimited, setIsUnlimited] = useState<boolean>(false);
  const [priceText, setPriceText] = useState<string>("");
  const [capacityText, setCapacityText] = useState<string>("");
  // issue #3350 — a field's red error waits until the organiser LEAVES it (the
  // app's touched-on-blur pattern: checkout buyer details, guest reservations,
  // Add person). Save stays disabled while anything is invalid (#1959), so
  // blur is the reveal. Reset every time the sheet opens.
  const [touched, setTouched] = useState<TicketSheetTouched>(UNTOUCHED);

  // Cycle 5 (v4) modifier state
  const [visibility, setVisibility] = useState<TicketVisibility>("public");
  const [approvalRequired, setApprovalRequired] = useState<boolean>(false);
  const [waitlistEnabled, setWaitlistEnabled] = useState<boolean>(false);
  const [minQtyText, setMinQtyText] = useState<string>("1");
  const [maxQtyText, setMaxQtyText] = useState<string>("");
  const [allowTransfers, setAllowTransfers] = useState<boolean>(true);

  // Cycle 6 (5b absorption — schema v5):
  const [description, setDescription] = useState<string>("");
  const [saleStartAt, setSaleStartAt] = useState<string | null>(null);
  const [saleEndAt, setSaleEndAt] = useState<string | null>(null);
  // Visibility sub-sheet
  const [visSheetVisible, setVisSheetVisible] = useState<boolean>(false);
  const [validDaysSheetVisible, setValidDaysSheetVisible] = useState<boolean>(false);
  const [validDayIds, setValidDayIds] = useState<string[] | null>(null);
  // issue #3281 — this tier's extras, edited in place and saved with the tier.
  const [extras, setExtras] = useState<TicketExtraStub[]>([]);
  // A saved tier on a published event reads its extras when the sheet opens;
  // the boot payload never carries them. `loadedExtras` is what the server has.
  const [extrasRead, setExtrasRead] = useState<
    "none" | "loading" | "loaded" | "failed"
  >("none");
  const loadedExtras = useRef<string | null>(null);

  // Cycle 12 — Available-at sub-sheet
  const [availableAt, setAvailableAt] = useState<TicketAvailableAt>("both");
  const priceCurrency = initial?.currency ?? eventCurrency;
  const priceCurrencyLabel = currencySymbol(priceCurrency);
  const lockedPriceLabel =
    priceCurrency !== undefined &&
    priceCurrency.trim().length > 0 &&
    Number.isFinite(Number.parseFloat(priceText))
      ? formatCurrency(Number.parseFloat(priceText), priceCurrency)
      : "—";
  const [availSheetVisible, setAvailSheetVisible] = useState<boolean>(false);
  const [waitlistEntriesSheetVisible, setWaitlistEntriesSheetVisible] =
    useState<boolean>(false);
  const [privateLinksVisible, setPrivateLinksVisible] = useState(false);
  // #4420 — closing the sheet with unsaved edits asks first.
  const [discardOpen, setDiscardOpen] = useState<boolean>(false);
  const eventWaitlistQuery = useEventWaitlist(eventId);

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
    setTouched(UNTOUCHED);
    const seed = ticketSheetSeed(initial, newTicketPreset);
    setName(seed.name);
    setIsFree(seed.isFree);
    setIsUnlimited(seed.isUnlimited);
    setPriceText(seed.priceText);
    setCapacityText(seed.capacityText);
    setVisibility(seed.visibility);
    setApprovalRequired(seed.approvalRequired);
    setWaitlistEnabled(seed.waitlistEnabled);
    setMinQtyText(seed.minQtyText);
    setMaxQtyText(seed.maxQtyText);
    setAllowTransfers(seed.allowTransfers);
    setDescription(seed.description);
    setSaleStartAt(seed.saleStartAt);
    setSaleEndAt(seed.saleEndAt);
    setAvailableAt(seed.availableAt);
    setValidDayIds(seed.validDayIds);
    setExtras(initial?.extras ?? []);
    loadedExtras.current = null;
    setExtrasRead(
      initial !== null && extrasUnavailableFor(liveEdit, initial) ? "loading" : "none",
    );
    setDiscardOpen(false);
  }, [visible, initial, newTicketPreset]);

  const isEditMode = initial !== null;

  // Inline validation hints (live — not from validateTickets, just for UX feedback)
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
  // issue #2590 — a sale window that leaves part of the event unbuyable.
  // A CAUTION, never a block: an organiser may genuinely want to stop selling
  // the night before. The rule itself lives in `saleWindowCaution` so it can be
  // executed in a test — the first version of it, written inline here, compared
  // only against the FIRST occurrence and therefore said nothing about the very
  // event that motivated it.
  const windowCaution = saleWindowCaution(
    saleEndAt,
    eventStartsAtIso,
    eventEndsAtIso,
  );
  const saleEndsBeforeDoors = windowCaution === "closes-before-doors";
  const saleEndsMidEvent = windowCaution === "closes-mid-event";
  const waitlistRow =
    initial !== null
      ? (eventWaitlistQuery.data?.find(
          (row) => row.ticketTypeId === initial.id,
        ) ?? null)
      : null;
  const waitlistTotal =
    (waitlistRow?.waitingCount ?? 0) + (waitlistRow?.invitedCount ?? 0);

  // ORCH-0704 v2 — capacity floor inline validation when tier has sales.
  const parsedCapacityValue = parseInt(capacityText, 10);
  const parsedPriceValue = Number(priceText);
  const priceInvalid =
    !isFree &&
    (priceText.trim().length === 0 ||
      !Number.isFinite(parsedPriceValue) ||
      parsedPriceValue <= 0);
  // issue #3355 — Seth's decision 6: a new or changed paid price must clear
  // the payment provider's minimum (the server refuses it otherwise).
  const priceMinimumMessage = priceInvalid
    ? null
    : ticketPriceEntryMinimumMessage({
        isFree,
        priceText,
        currency: priceCurrency,
        initialIsFree: initial?.isFree ?? null,
        initialPriceMajor: initial?.priceGbp ?? null,
        isPriceLocked,
      });
  const capacityInvalid =
    !isUnlimited &&
    (capacityText.trim().length === 0 ||
      !Number.isFinite(parsedCapacityValue) ||
      parsedCapacityValue <= 0);
  // issue #3313 — the floor is the busiest night on a recurring event.
  // issue #3281 — on a multi-date event the list decides the capacity unit.
  const dayScoped = dayScopeEntries !== null;
  const dayLimited = dayScoped && validDayIds !== null;
  const dayScopeOrphaned =
    dayLimited && liveDayIds(validDayIds, dayScopeEntries ?? []).length === 0;
  const minimumCapacity =
    dayLimited && soldByDay !== null
      ? busiestDaySold(soldByDay)
      : (capacityFloor ?? soldCount);
  const capacityBelowSold =
    isPriceLocked &&
    !isUnlimited &&
    Number.isFinite(parsedCapacityValue) &&
    parsedCapacityValue < minimumCapacity;

  // issue #3281 — narrowing the tier's dates narrows its extras now, so the
  // save button judges what will be sent; an extra left with no date is shown
  // as an error the organiser can fix by choosing again.
  useEffect(() => {
    setExtras((current) =>
      keepExtraDaysInTier(current, dayScoped && validDayIds !== null ? validDayIds : null),
    );
  }, [dayScoped, validDayIds]);

  // issue #3281 — the dates this tier admits, for its extras to choose from.
  const tierDayEntries =
    dayScopeEntries === null
      ? null
      : validDayIds === null
        ? dayScopeEntries
        : dayScopeEntries.filter((entry) => validDayIds.includes(entry.id));
  // A published tier whose extras failed to load can't replace them safely.
  // A new tier (a local `t_*` id) has nothing on the server yet, so it can
  // always take extras; only a saved tier (a row id) depends on the read.
  const extrasUnavailable = extrasRead === "loading" || extrasRead === "failed";
  useEffect(() => {
    if (extrasRead !== "loading" || initial === null) return;
    if (eventId === null || eventId === undefined) {
      setExtrasRead("failed");
      return;
    }
    let live = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc(
          "business_event_ticket_extras",
          { p_event_id: eventId },
        );
        if (!live) return;
        if (error !== null || data === null) {
          setExtrasRead("failed");
          return;
        }
        const list =
          extrasFromServer((data as Record<string, unknown>)[initial.id]) ?? [];
        loadedExtras.current = JSON.stringify(list);
        setExtras(list);
        setExtrasRead("loaded");
      } catch {
        if (live) setExtrasRead("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [extrasRead, eventId, initial]);
  const extrasInvalid = extras.some(
    (extra) => validateTicketExtra(extra, { tierIsFree: isFree }) !== null,
  );

  // Save is gated by name + ALL inline validation hints. The publish-gate
  // validator (validateTickets) catches the same conditions globally;
  // gating Save locally prevents the user from persisting bad combinations
  // into the draft in the first place.
  const canSave =
    name.trim().length > 0 &&
    !waitlistConflict &&
    !minTooLow &&
    !maxLessThanMin &&
    !descriptionTooLong &&
    !saleEndBeforeStart &&
    !priceInvalid &&
    priceMinimumMessage === null &&
    !capacityInvalid &&
    !capacityBelowSold &&
    !dayScopeOrphaned &&
    !extrasInvalid;

  // issue #2590 — one list, rendered at the button. Derived from the SAME
  // predicates that gate `canSave`, never a second copy of the rules: a
  // summary that can disagree with the button is worse than no summary.
  // issue #3350 — every blocker is still LISTED (a greyed-out Save is never
  // unexplained), but one from a typed field is only `revealed` — red — once
  // that field has been left. Until then it reads as a neutral to-do.
  const saveBlockers: SaveBlocker[] = [];
  const block = (message: string, revealed = true): void => {
    saveBlockers.push({ message, revealed });
  };
  if (name.trim().length === 0) block("Give this ticket a name.", touched.name);
  if (priceInvalid)
    block("Enter a valid price, or mark it free.", touched.price);
  if (priceMinimumMessage !== null) block(priceMinimumMessage);
  if (capacityInvalid) {
    block(
      "Enter a capacity above zero, or mark it unlimited.",
      touched.capacity,
    );
  }
  if (capacityBelowSold) {
    block(
      capacityPerNight
        ? `Capacity per night is below the ${minimumCapacity} ticket${minimumCapacity === 1 ? "" : "s"} already sold for the busiest night.`
        : `Capacity is below the ${minimumCapacity} ticket${minimumCapacity === 1 ? "" : "s"} already sold.`,
      touched.capacity,
    );
  }
  if (minTooLow) block("Minimum per buyer must be at least 1.");
  if (maxLessThanMin) {
    block("Maximum per buyer is lower than the minimum.");
  }
  if (waitlistConflict) {
    block("A waitlist needs a limited capacity.");
  }
  if (descriptionTooLong) {
    block("Description is over 280 characters.");
  }
  if (saleEndBeforeStart) {
    block("Sales close before they open.");
  }
  if (dayScopeOrphaned) {
    block("Pick at least one day, or choose All dates.");
  }
  if (extrasInvalid) {
    block("Finish or remove the extras marked in red.");
  }
  const anyBlockerRevealed = saveBlockers.some((blocker) => blocker.revealed);
  const showPriceError = priceInvalid && touched.price;
  const showCapacityInvalid = capacityInvalid && touched.capacity;
  const showCapacityBelowSold = capacityBelowSold && touched.capacity;

  const extrasOut = keepExtraDaysInTier(
    extras,
    dayScoped && validDayIds !== null ? validDayIds : null,
  );
  const extrasToSend: TicketExtraStub[] | null =
    extrasRead === "loaded"
      ? JSON.stringify(extrasOut) === loadedExtras.current
        ? null
        : extrasOut
      : extrasRead === "none" && (initial?.extras !== undefined || extras.length > 0)
        ? extrasOut
        : null;

  // #4420 — the form has something to lose when a field differs from what it
  // opened with, or its extras changed (a published tier's extras are judged
  // only once read; while reading or after a failed read they cannot change).
  const seedValues = ticketSheetSeed(initial, newTicketPreset);
  const currentValues: TicketSheetFormValues = {
    name, isFree, isUnlimited, priceText, capacityText, visibility,
    approvalRequired, waitlistEnabled, minQtyText, maxQtyText, allowTransfers,
    description, saleStartAt, saleEndAt, availableAt, validDayIds,
  };
  const extrasChanged =
    extrasRead === "loaded"
      ? JSON.stringify(extras) !== loadedExtras.current
      : extrasRead === "none" &&
        JSON.stringify(extras) !== JSON.stringify(initial?.extras ?? []);
  const hasUnsavedEdits =
    visible &&
    (JSON.stringify(currentValues) !== JSON.stringify(seedValues) || extrasChanged);
  // Every way out (scrim tap, Escape, Android back, drag, Cancel) funnels here.
  const handleRequestClose = useCallback((): void => {
    if (hasUnsavedEdits) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [hasUnsavedEdits, onClose]);

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
      // issue #3281 — an explicit null clears a list. A date mode that cannot
      // scope keeps the stored list untouched, and the server ignores it.
      ...(dayScoped
        ? { validDayIds }
        : initial?.validDayIds !== undefined
          ? { validDayIds: initial.validDayIds }
          : {}),
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
      // issue #3827 — passwords are retired in favour of revocable private
      // links. Saving an old draft also scrubs any persisted password state.
      passwordProtected: false,
      password: null,
      passwordConfigured: false,
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
      // issue #3281 — a published tier sends its extras only when they changed
      // from what the server has; a draft sends them once it has any. An
      // unread or failed read never sends, so the server's extras are kept.
      ...(extrasToSend !== null ? { extras: extrasToSend } : {}),
    };
    onSave(ticket);
  }, [
    extrasToSend,
    name,
    isFree,
    isUnlimited,
    priceText,
    capacityText,
    visibility,
    approvalRequired,
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
    dayScoped,
    validDayIds,
    extras,
  ]);

  // issue #3281 — the row's answer, and the sentences under the inputs.
  const dayCapacityHelper = dayScoped
    ? capacityHelper(
        validDayIds,
        dayScopeEntries ?? [],
        Number.isFinite(parsedCapacityValue) ? parsedCapacityValue : null,
        dayScopePricingMode,
      )
    : null;
  const validDayLabel =
    validDayIds === null
      ? "All dates"
      : (formatDraftDayScopeLabel(dayScopeEntries ?? [], validDayIds) ??
        "No days selected");
  const dayCount = validDayIds?.length ?? dayScopeEntries?.length ?? 0;
  const parsedDayPrice = Number.parseFloat(priceText);
  const dayPriceHelper =
    priceCurrency !== null &&
    priceCurrency !== undefined &&
    Number.isFinite(parsedDayPrice) &&
    parsedDayPrice > 0
      ? priceHelper(
          dayCount,
          dayScopePricingMode,
          formatCurrency(parsedDayPrice, priceCurrency),
          formatCurrency(parsedDayPrice * dayCount, priceCurrency),
        )
      : null;

  // Visibility row label
  const visibilityLabel =
    VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? "Public";

  // Cycle 12 — Available-at row label
  const availableAtLabel =
    AVAILABLE_AT_OPTIONS.find((o) => o.id === availableAt)?.label ??
    "Online and at the door";

  return (
    <Sheet
      visible={visible}
      onClose={handleRequestClose}
      dismissGuard={() => hasUnsavedEdits}
      onRequestClose={handleRequestClose}
      snapPoint="full"
    >
      <View style={styles.bodyWrap}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.sheetContent,
            { paddingBottom: insets.bottom + space[4] },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sheetTitle}>
            {isEditMode ? "Edit ticket" : "Add ticket type"}
          </Text>

          {/* ORCH-0704 v2 — refund-first lock banner shown when this tier has sales */}
          {isPriceLocked ? (
            <View style={styles.lockBanner}>
              <Icon name="flag" size={16} color={color.text1} />
              <View style={styles.lockBannerTextCol}>
                <Text style={styles.lockBannerTitle}>
                  {soldCount} ticket{soldCount === 1 ? "" : "s"} sold
                </Text>
                <Text style={styles.lockBannerBody}>
                  Existing buyers are protected at the price they paid. To
                  change price or free/paid, refund those buyers first (then add
                  a new tier). Other modifiers, description, and visibility can
                  be edited.
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
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder="e.g. General Admission"
                placeholderTextColor={color.text4}
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
                placeholderTextColor={color.text4}
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

          {/* issue #3281 — which dates this ticket admits. */}
          {dayScopeEntries !== null ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Valid on</Text>
              <Pressable
                onPress={() => setValidDaysSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={`Valid on: ${validDayLabel}`}
                accessibilityHint="Opens the day picker"
                testID="issue-3281-valid-on-row"
                style={[styles.pickerRow, dayScopeOrphaned && styles.inputWrapError]}
              >
                <Text style={styles.pickerValue}>{validDayLabel}</Text>
                <Icon name="chevD" size={16} color={color.text3} />
              </Pressable>
              <Text style={dayScopeOrphaned ? styles.helperError : styles.helperHint}>
                {dayScopeHelper(
                  validDayIds,
                  dayScopeEntries.length,
                  soldCount > 0,
                )}
              </Text>
            </View>
          ) : null}

          {/* Price (when not free) — ORCH-0704 v2: locked when sales exist */}
          {!isFree ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                {priceCurrencyLabel !== null
                  ? `Price (${priceCurrencyLabel})`
                  : "Price"}
              </Text>
              <View
                style={[
                  styles.inputWrap,
                  isPriceLocked ? styles.inputWrapDisabled : null,
                ]}
              >
                <TextInput
                  value={priceText}
                  onChangeText={(value) => {
                    if (isValidPriceInput(value)) setPriceText(value);
                  }}
                  placeholder="35"
                  placeholderTextColor={color.text4}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  onPressIn={(event) =>
                    reselectWebValueAfterPointer(event, priceText)
                  }
                  onBlur={() => setTouched((t) => ({ ...t, price: true }))}
                  style={styles.textInput}
                  editable={!isPriceLocked}
                  accessibilityLabel={
                    priceCurrency !== undefined &&
                    priceCurrency.trim().length > 0
                      ? `Ticket price in ${priceCurrency.trim().toUpperCase()}`
                      : "Ticket price"
                  }
                />
              </View>
              {showPriceError ? (
                <Text style={styles.helperError}>
                  Enter a price greater than zero, or mark this ticket free.
                </Text>
              ) : priceMinimumMessage !== null ? (
                <Text style={styles.helperError}>{priceMinimumMessage}</Text>
              ) : dayScoped && dayPriceHelper !== null ? (
                <Text style={styles.helperHint}>{dayPriceHelper}</Text>
              ) : isPriceLockedByRank ? (
                <Text style={styles.helperHint}>
                  You can&apos;t change ticket prices with your current role. A
                  finance manager or above can.
                </Text>
              ) : isPriceLocked ? (
                <Text style={styles.helperHint}>
                  Existing buyers locked at {lockedPriceLabel}. Change applies
                  to new buyers only — refund first to change.
                </Text>
              ) : null}
              {/* #3645 — e.g. the payout country prompt, as the price is typed. */}
              {renderUnderPrice?.(ticketPriceTextIsPriced(isFree, priceText))}
            </View>
          ) : null}

          {canShowTicketTierDiscountControls({
            hasPersistedTier: initial !== null,
            privateLinksEnabled,
            hasEventId: eventId !== null,
            hasBrandId: brandId !== undefined,
            canEditPrice,
            isFree,
          }) ? (
            <React.Suspense fallback={null}>
              <Text style={styles.sectionHeader}>Sale price</Text>
              <ItemDiscountControls
                brandId={brandId!}
                itemId={initial!.id}
                itemKind="ticket_type"
                listingKind="event"
                itemLabel={initial!.name}
                currency={priceCurrency}
                listUnitCents={
                  initial!.priceGbp == null
                    ? null
                    : minorFromMajor(initial!.priceGbp, priceCurrency ?? "GBP")
                }
                allowLabel="Allow discounts"
                saleLabel="Offer a sale price"
                countLimit
                testID="ticket-tier-discount-controls"
              />
            </React.Suspense>
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
              <Text style={styles.fieldLabel}>
                {capacityPerNight
                  ? "Capacity per night"
                  : dayScoped
                    ? capacityLabel(dayLimited)
                    : "Capacity"}
              </Text>
              <View
                style={[
                  styles.inputWrap,
                  showCapacityBelowSold && styles.inputWrapError,
                ]}
              >
                <TextInput
                  value={capacityText}
                  onChangeText={(value) => {
                    if (isValidCapacityInput(value)) setCapacityText(value);
                  }}
                  placeholder="200"
                  placeholderTextColor={color.text4}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  onPressIn={(event) =>
                    reselectWebValueAfterPointer(event, capacityText)
                  }
                  onBlur={() => setTouched((t) => ({ ...t, capacity: true }))}
                  style={styles.textInput}
                  accessibilityLabel={
                    capacityPerNight
                      ? "Ticket capacity per night"
                      : dayScoped
                        ? dayLimited
                          ? "Ticket capacity per day"
                          : "Total ticket capacity"
                        : "Ticket capacity"
                  }
                />
              </View>
              {showCapacityInvalid ? (
                <Text style={styles.helperError}>
                  Enter a whole-number capacity greater than zero, or mark this
                  ticket unlimited.
                </Text>
              ) : showCapacityBelowSold ? (
                <Text style={styles.helperError}>
                  {capacityPerNight
                    ? `Cannot go below ${minimumCapacity} tickets sold for the busiest night. Increase capacity or refund existing buyers first.`
                    : `Cannot go below ${minimumCapacity} tickets sold. Increase capacity or refund existing buyers first.`}
                </Text>
              ) : isPriceLocked ? (
                <Text style={styles.helperHint}>
                  {capacityPerNight
                    ? `Minimum capacity per night = ${minimumCapacity} (busiest night so far).`
                    : `Minimum capacity = ${minimumCapacity} (already sold).`}
                </Text>
              ) : capacityPerNight ? (
                <Text style={styles.helperHint}>
                  Each date of this event can sell this many.
                </Text>
              ) : dayCapacityHelper !== null ? (
                <Text style={styles.helperHint}>{dayCapacityHelper}</Text>
              ) : null}
            </View>
          ) : null}

          {/* #3281 — dark until buyers can buy extras; a tier that already has
              some keeps them editable. */}
          {isFeatureEnabled("extras") || extras.length > 0 ? (
          <TicketExtrasSection
            extras={extras}
            onChange={setExtras}
            tierName={name}
            tierIsFree={isFree}
            currencyCode={(priceCurrency ?? "").trim().toUpperCase() || "GBP"}
            formatPrice={(major) =>
              priceCurrency !== undefined && priceCurrency.trim().length > 0
                ? formatCurrency(major, priceCurrency)
                : String(major)}
            tierDayEntries={tierDayEntries}
            unavailable={extrasUnavailable}
            loading={extrasRead === "loading"}
          />
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
              <Icon name="chevD" size={16} color={color.text3} />
            </Pressable>
          </View>

          {privateLinksEnabled &&
          initial !== null &&
          visibility === "hidden" &&
          eventId !== null ? (
            <Pressable
              onPress={() => setPrivateLinksVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Manage private links for ${initial.name}`}
              style={styles.pickerRow}
            >
              <View style={styles.pickerTextWrap}>
                <Text style={styles.fieldLabel}>Private links</Text>
                <Text style={styles.helperHint}>
                  Create, copy, reset or revoke access to this hidden ticket.
                </Text>
              </View>
              <Icon name="chevR" size={16} color={color.text3} />
            </Pressable>
          ) : null}

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
              <Icon name="chevD" size={16} color={color.text3} />
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
            label="Enable waitlist"
            sub="When this ticket sells out, buyers can join a waitlist."
            value={waitlistEnabled}
            onChange={setWaitlistEnabled}
            accessibilityLabel="Enable waitlist"
          />

          {waitlistConflict ? (
            <Text style={styles.helperError}>
              Unlimited tickets do not need a waitlist — turn one off.
            </Text>
          ) : null}

          {waitlistEnabled &&
          initial !== null &&
          waitlistRow !== null &&
          waitlistTotal > 0 ? (
            <View style={styles.waitlistPanel}>
              <View style={styles.waitlistPanelHeader}>
                <Text style={styles.waitlistPanelTitle}>
                  Waitlist · {waitlistRow.waitingCount} waiting ·{" "}
                  {waitlistRow.invitedCount} invited
                </Text>
                <Pressable
                  onPress={() => setWaitlistEntriesSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="See all waitlist signups"
                  hitSlop={8}
                >
                  <Text style={styles.waitlistSeeAll}>See all</Text>
                </Pressable>
              </View>
              {waitlistRow.recent.slice(0, 5).map((entry) => (
                <WaitlistEntryRow key={entry.id} entry={entry} />
              ))}
            </View>
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
                  placeholderTextColor={color.text4}
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
                  placeholderTextColor={color.text4}
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
              Maximum cannot be less than minimum.
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
            <HostDateTimeField
              label="Sales open"
              accessibilityLabel="Sale start date and time"
              placeholder="Not scheduled"
              value={saleFieldValue(saleStartAt)}
              onChangeValue={(next) => setSaleStartAt(isoFromSaleField(next))}
              onClear={() => setSaleStartAt(null)}
              testID="ticket-sale-start"
            />
          </View>

          <View style={styles.field}>
            <View style={saleEndBeforeStart ? styles.inputWrapError : undefined}>
              <HostDateTimeField
                label="Sales close"
                accessibilityLabel="Sale end date and time"
                placeholder="Not scheduled"
                hasError={saleEndBeforeStart}
                value={saleFieldValue(saleEndAt)}
                min={saleStartAt !== null ? saleFieldValue(saleStartAt).date : undefined}
                onChangeValue={(next) => setSaleEndAt(isoFromSaleField(next))}
                onClear={() => setSaleEndAt(null)}
                testID="ticket-sale-end"
              />
            </View>
            {saleEndBeforeStart ? (
              <Text style={styles.helperError}>
                Sales close must be after sales open.
              </Text>
            ) : saleEndsMidEvent ? (
              /* issue #2590 — the multi-day shape. Distinct copy, because the
                 organiser's mistake and its consequence are different here. */
              <Text style={styles.helperHintWarn}>
                Heads up: sales stop while this event is still running, so the
                later days can&apos;t be bought on the day. Move it to the
                event&apos;s end time to sell throughout.
              </Text>
            ) : saleEndsBeforeDoors ? (
              /* issue #2590 — a CAUTION, not a block. Save stays enabled: an
                 organiser may genuinely want to stop selling the night before.
                 It exists because a stored timestamp is invisible, which is how
                 We Go Again ended up closing six hours before its own doors. */
              <Text style={styles.helperHintWarn}>
                Heads up: sales close before this event starts, so nobody can
                get a ticket on the day. Set it to the event&apos;s end time to
                sell right through, or leave it if you meant to close early.
              </Text>
            ) : (
              <Text style={styles.helperHint}>
                Leave blank for sales-open-immediately and
                sales-close-at-event-start.
              </Text>
            )}
          </View>

          {/* #2879 Ilashe P0 — transfer UI removed until buyer/admin transfer ships.
              allowTransfers remains in save payload from initial draft for P1. */}

          {/* Action dock */}
          <GlassCard
            variant="elevated"
            padding={0}
            radius="xxl"
            style={styles.sheetActionDock}
          >
            {/* issue #2590 — the SAME problems, restated at the button.
                Seth's ask, and the right one: a disabled Save with the reason
                200px up the sheet is a dead control. Errors block; the caution
                above never appears here, because it does not block. */}
            {saveBlockers.length > 0 ? (
              <View
                style={[
                  styles.saveBlockerBox,
                  anyBlockerRevealed ? null : styles.saveBlockerBoxPending,
                ]}
                testID="ticket-save-blockers"
              >
                <Text
                  style={[
                    styles.saveBlockerTitle,
                    anyBlockerRevealed ? null : styles.saveBlockerPendingText,
                  ]}
                >
                  {saveBlockers.length === 1
                    ? "One thing to fix before saving"
                    : `${saveBlockers.length} things to fix before saving`}
                </Text>
                {saveBlockers.map((blocker) => (
                  <Text
                    key={blocker.message}
                    style={[
                      styles.saveBlockerItem,
                      blocker.revealed ? null : styles.saveBlockerPendingText,
                    ]}
                  >
                    {`\u2022 ${blocker.message}`}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.sheetActionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="md"
                  onPress={handleRequestClose}
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

      </View>

      {dayScopeEntries !== null ? (
        <ValidDaysSheet
          visible={validDaysSheetVisible}
          entries={dayScopeEntries}
          selected={validDayIds}
          soldByDay={soldByDay}
          onChange={setValidDayIds}
          onClose={() => setValidDaysSheetVisible(false)}
        />
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

      <WaitlistEntriesSheet
        visible={waitlistEntriesSheetVisible}
        entries={waitlistRow?.recent ?? []}
        onClose={() => setWaitlistEntriesSheetVisible(false)}
      />

      {eventId !== null && initial !== null ? (
        <React.Suspense fallback={null}>
          <TicketLinksSheet
            visible={privateLinksVisible}
            eventId={eventId}
            eventTitle={eventTitle}
            tickets={allTickets.length > 0 ? allTickets : [initial]}
            initialTicketTypeId={initial.id}
            startCreating
            onClose={() => setPrivateLinksVisible(false)}
          />
        </React.Suspense>
      ) : null}

      {/* #4420 — unsaved ticket edits on close */}
      <ConfirmDialog
        visible={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        title={UNSAVED_CHANGES_DIALOG.title}
        description={UNSAVED_CHANGES_DIALOG.description}
        confirmLabel={UNSAVED_CHANGES_DIALOG.confirmLabel}
        cancelLabel={UNSAVED_CHANGES_DIALOG.cancelLabel}
        variant="simple"
        destructive
        testID="ticket-sheet-discard-dialog"
      />
    </Sheet>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  // Sheet body / scroll
  bodyWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // #4420 (native run): no side padding here. Sheet's body already pads by
  // SHEET_SIDE_GUTTER, so a second gutter pushed the content to 44pt.
  sheetContent: {
    paddingTop: space[2],
  },
  sheetTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    marginBottom: space[2],
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.text1,
    marginTop: space[6],
    marginBottom: space[2],
  },

  // Field + helpers
  field: {
    marginBottom: space[2],
  },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
    marginBottom: space[1],
  },
  helperError: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
    marginTop: space[1],
    marginBottom: space[2],
  },
  // issue #2590 — a caution, deliberately NOT `color.danger`. It does not
  // block the save, and colouring it like a failure would teach organisers to
  // ignore the colour that does mean failure.
  helperHintWarn: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text1,
    marginTop: space[1],
    marginBottom: space[2],
  },
  // issue #2590 — the blocking problems, restated at the button.
  saveBlockerBox: {
    padding: space[4],
    borderRadius: radiusTokens.md,
    backgroundColor: color.errorTint,
    borderWidth: 1,
    borderColor: color.errorTint,
    gap: space[1],
    marginBottom: space[4],
  },
  saveBlockerTitle: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "600",
    color: color.danger,
  },
  saveBlockerItem: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
  },
  // issue #3350 — the same list before the organiser has left a field with a
  // problem: a neutral to-do, not a failure.
  saveBlockerBoxPending: {
    backgroundColor: color.fill.inset,
    borderColor: color.line,
  },
  saveBlockerPendingText: {
    color: color.text2,
  },
  helperHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: space[1],
  },

  // Inputs
  inputWrap: {
    paddingHorizontal: space[4],
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  inputWrapError: {
    borderColor: color.danger,
  },
  inputWrapDisabled: {
    opacity: 0.5,
  },
  disabledRow: {
    opacity: 0.5,
  },
  textInput: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text1,
    padding: 0,
    margin: 0,
  },
  passwordRevealBtn: {
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radiusTokens.sm,
  },
  passwordRevealLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text1,
  },

  // Lock banner
  lockBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
    marginBottom: space[6],
  },
  lockBannerTextCol: {
    flex: 1,
    gap: 4,
  },
  lockBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: color.text1,
  },
  lockBannerBody: {
    fontSize: 12,
    lineHeight: 16,
    color: color.text2,
  },
  waitlistPanel: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    padding: space[4],
    marginTop: space[1],
    marginBottom: space[4],
    gap: space[2],
  },
  waitlistPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  waitlistPanelTitle: {
    flex: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  waitlistSeeAll: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  waitlistEntryRow: {
    paddingVertical: space[1],
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  waitlistEntryTextCol: {
    gap: 2,
  },
  waitlistEntryName: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  waitlistEntryMeta: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  waitlistSheetBody: {
    flex: 1,
    // #4420: the Sheet owns the 20 side padding.
    paddingTop: space[6],
    gap: space[2],
  },

  // Picker rows
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  pickerValue: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  pickerTextWrap: {
    flex: 1,
    gap: 2,
    paddingRight: space[2],
  },

  // Toggle row (Free / Unlimited / new modifiers)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[2],
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: space[2],
  },
  toggleLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  toggleSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: color.fill.step,
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: color.paper,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: color.text1,
  },
  toggleThumbOff: {
    backgroundColor: color.text1,
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    backgroundColor: color.ink,
    transform: [{ translateX: 18 }],
  },

  // Min/max qty row
  qtyRow: {
    flexDirection: "row",
    gap: space[2],
  },
  qtyCell: {
    flex: 1,
  },

  // Action dock
  sheetActionDock: {
    marginTop: space[6],
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

  // Description
  descriptionWrap: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 80,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  textInputMultiline: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text1,
    padding: 0,
    margin: 0,
    minHeight: 64,
  },


  // Visibility / Available-at sub-sheet rows
  visRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    marginBottom: space[1],
  },
  visRowActive: {
    backgroundColor: color.fill.tabOn,
  },
  visRowTextCol: {
    flex: 1,
    marginRight: space[2],
  },
  visRowLabel: {
    fontSize: type.body.fontSize,
    color: color.text1,
  },
  visRowLabelActive: {
    fontWeight: "600",
  },
  visRowSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
});
