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
import { useEventWaitlist } from "../../hooks/useEventWaitlist";
import type { EventWaitlistEntry } from "../../services/waitlistService";
import { generateTicketId } from "../../utils/draftEventId";
import { saleWindowCaution } from "../../utils/saleWindowCaution";
import { formatCurrency, minorFromMajor } from "../../utils/currency";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
// #2664 — Android has no `datetime` picker mode; the sale window has to step
// date -> time and combine. See the module header for the crash mechanism.
import {
  type AndroidDateTimeStep,
  combineAndroidDateAndTime,
  seedAndroidTimeStep,
} from "../../utils/androidDateTimeStep";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import type { MultiDateEntry } from "../../store/draftEventStore";
import {
  capacityHelper,
  capacityLabel,
  dayScopeHelper,
  formatDraftDayScopeLabel,
  priceHelper,
} from "../../utils/ticketDayScope";
import { ValidDaysSheet } from "./ValidDaysSheet";
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

// ---- Web datetime helpers -------------------------------------------

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
                <Icon name="check" size={18} color={accent.warm} />
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
                <Icon name="check" size={18} color={accent.warm} />
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
  eventTitle?: string;
  allTickets?: TicketStub[];
}

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
  // Sale-period picker — bottom-docked inline (same pattern as
  // MultiDateOverrideSheet's time picker). NOT a nested Sheet.
  const [salePickerMode, setSalePickerMode] = useState<"start" | "end" | null>(
    null,
  );
  const [salePickerTemp, setSalePickerTemp] = useState<Date | null>(null);
  // #2664 — Android two-step. `saleAndroidStep` says which real Android mode is
  // presented (`date` then `time`); `saleAndroidDatePart` holds the step-1
  // calendar date while step 2 is up. NOTHING is committed until step 2 sets —
  // cancelling either dialog must leave saleStartAt/saleEndAt untouched.
  const [saleAndroidStep, setSaleAndroidStep] =
    useState<AndroidDateTimeStep | null>(null);
  const [saleAndroidDatePart, setSaleAndroidDatePart] = useState<Date | null>(
    null,
  );

  // Web hidden input refs — tap row → showPicker()/.click() opens browser
  // native datetime picker directly. No Sheet, no Done button on web.
  const saleStartInputRef = useRef<HTMLInputElement | null>(null);
  const saleEndInputRef = useRef<HTMLInputElement | null>(null);

  // Visibility sub-sheet
  const [visSheetVisible, setVisSheetVisible] = useState<boolean>(false);
  const [validDaysSheetVisible, setValidDaysSheetVisible] = useState<boolean>(false);
  const [validDayIds, setValidDayIds] = useState<string[] | null>(null);

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
      setValidDayIds(initial.validDayIds ?? null);
    } else {
      setName("");
      setIsFree(newTicketPreset === "free-guest-list");
      setIsUnlimited(false);
      setPriceText("");
      setCapacityText("");
      setVisibility(newTicketPreset === "hidden-paid" ? "hidden" : "public");
      setApprovalRequired(false);
      setWaitlistEnabled(false);
      setMinQtyText("1");
      setMaxQtyText("");
      setAllowTransfers(true);
      setDescription("");
      setSaleStartAt(null);
      setSaleEndAt(null);
      setAvailableAt("both");
      setValidDayIds(null);
    }
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
  const capacityInvalid =
    !isUnlimited &&
    (capacityText.trim().length === 0 ||
      !Number.isFinite(parsedCapacityValue) ||
      parsedCapacityValue <= 0);
  // issue #3313 — the floor is the busiest night on a recurring event.
  const minimumCapacity = capacityFloor ?? soldCount;
  // issue #3281 — on a multi-date event the list decides the capacity unit.
  const dayScoped = dayScopeEntries !== null;
  const dayLimited = dayScoped && validDayIds !== null;
  const dayScopeOrphaned = dayLimited && validDayIds.length === 0;
  const capacityBelowSold =
    isPriceLocked &&
    !isUnlimited &&
    Number.isFinite(parsedCapacityValue) &&
    parsedCapacityValue < minimumCapacity;

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
    !capacityInvalid &&
    !capacityBelowSold &&
    !dayScopeOrphaned;

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
        : `Capacity is below the ${soldCount} ticket${soldCount === 1 ? "" : "s"} already sold.`,
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
  const anyBlockerRevealed = saveBlockers.some((blocker) => blocker.revealed);
  const showPriceError = priceInvalid && touched.price;
  const showCapacityInvalid = capacityInvalid && touched.capacity;
  const showCapacityBelowSold = capacityBelowSold && touched.capacity;

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
      const initial = initialIso !== null ? new Date(initialIso) : new Date();
      setSalePickerTemp(initial);
      // #2664 — Android opens on the DATE half of the sequence. iOS keeps its
      // single `datetime` spinner, which is a real mode there.
      setSaleAndroidStep(Platform.OS === "android" ? "date" : null);
      setSaleAndroidDatePart(null);
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
        const step = saleAndroidStep;
        // #2664 — cancelling EITHER dialog abandons the whole edit. A dismiss on
        // the time step must not silently persist the date the operator already
        // picked; the sale window is committed once, from both halves, or never.
        if (event.type === "dismissed" || selected === undefined) {
          setSalePickerMode(null);
          setSaleAndroidStep(null);
          setSaleAndroidDatePart(null);
          return;
        }
        if (step === "date") {
          // Step 1 of 2. Hold the calendar date and advance to the clock —
          // the dialog stays open, and saleStartAt/saleEndAt are untouched.
          setSaleAndroidDatePart(selected);
          setSaleAndroidStep("time");
          return;
        }
        // Step 2 of 2 — combine and commit.
        setSalePickerMode(null);
        setSaleAndroidStep(null);
        setSaleAndroidDatePart(null);
        if (saleAndroidDatePart === null) return;
        commitSalePickerValue(
          mode,
          combineAndroidDateAndTime(saleAndroidDatePart, selected),
        );
        return;
      }
      // iOS: track temp value; commit on Done.
      if (selected !== undefined) setSalePickerTemp(selected);
    },
    [
      salePickerMode,
      saleAndroidStep,
      saleAndroidDatePart,
      commitSalePickerValue,
    ],
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
    setSaleAndroidStep(null);
    setSaleAndroidDatePart(null);
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
  ]);

  // issue #3281 — the row's answer, and the price sentence under the input.
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
                <Icon name="chevD" size={16} color={textTokens.tertiary} />
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
                  placeholderTextColor={textTokens.quaternary}
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
                  placeholderTextColor={textTokens.quaternary}
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
                    : `Cannot go below ${soldCount} tickets sold. Increase capacity or refund existing buyers first.`}
                </Text>
              ) : isPriceLocked ? (
                <Text style={styles.helperHint}>
                  {capacityPerNight
                    ? `Minimum capacity per night = ${minimumCapacity} (busiest night so far).`
                    : `Minimum capacity = ${soldCount} (already sold).`}
                </Text>
              ) : capacityPerNight ? (
                <Text style={styles.helperHint}>
                  Each date of this event can sell this many.
                </Text>
              ) : dayScoped ? (
                <Text style={styles.helperHint}>
                  {capacityHelper(
                    validDayIds,
                    dayScopeEntries ?? [],
                    Number.isFinite(parsedCapacityValue) ? parsedCapacityValue : null,
                    dayScopePricingMode,
                  )}
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
              <Icon name="chevR" size={16} color={textTokens.tertiary} />
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

      {/* Android native dialog — auto-dismisses. #2664: Android registers only
          `date` and `time` pickers, so this steps date -> time and combines;
          `mode="datetime"` crashed on unmount here. Same shape as
          CreatorStep2When's Android branch. */}
      {salePickerMode !== null &&
      Platform.OS === "android" &&
      saleAndroidStep !== null ? (
        <DateTimePicker
          value={
            saleAndroidStep === "time" && saleAndroidDatePart !== null
              ? seedAndroidTimeStep(
                  saleAndroidDatePart,
                  salePickerTemp ?? new Date(),
                )
              : salePickerMode === "start"
                ? saleStartAt !== null
                  ? new Date(saleStartAt)
                  : new Date()
                : saleEndAt !== null
                  ? new Date(saleEndAt)
                  : new Date()
          }
          mode={saleAndroidStep === "date" ? "date" : "time"}
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
              saleStartAt !== null
                ? datetimeLocalFromDate(new Date(saleStartAt))
                : ""
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
              saleEndAt !== null
                ? datetimeLocalFromDate(new Date(saleEndAt))
                : ""
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

  // Field + helpers
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
  // issue #2590 — a caution, deliberately NOT `semantic.error`. It does not
  // block the save, and colouring it like a failure would teach organisers to
  // ignore the colour that does mean failure.
  helperHintWarn: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  // issue #2590 — the blocking problems, restated at the button.
  saveBlockerBox: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.errorTint,
    gap: spacing.xxs,
    marginBottom: spacing.md,
  },
  saveBlockerTitle: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: semantic.error,
  },
  saveBlockerItem: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
  },
  // issue #3350 — the same list before the organiser has left a field with a
  // problem: a neutral to-do, not a failure.
  saveBlockerBoxPending: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  saveBlockerPendingText: {
    color: textTokens.secondary,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },

  // Inputs
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  inputWrapError: {
    borderColor: semantic.error,
  },
  inputWrapDisabled: {
    opacity: 0.5,
  },
  disabledRow: {
    opacity: 0.5,
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

  // Lock banner
  lockBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
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
  waitlistPanel: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  waitlistPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  waitlistPanelTitle: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  waitlistSeeAll: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  waitlistEntryRow: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  waitlistEntryTextCol: {
    gap: 2,
  },
  waitlistEntryName: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  waitlistEntryMeta: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  waitlistSheetBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },

  // Picker rows
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pickerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  pickerTextWrap: {
    flex: 1,
    gap: 2,
    paddingRight: spacing.sm,
  },
  pickerPlaceholder: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
  },

  // Toggle row (Free / Unlimited / new modifiers)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
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

  // Action dock
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

  // Description
  descriptionWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
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

  // Sale period
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
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    overflow: "hidden",
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

  // Visibility / Available-at sub-sheet rows
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
