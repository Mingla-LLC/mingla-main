import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ViewStyle } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  CalendarDays,
  Check,
  Copy,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Plus,
  Tag,
  Umbrella,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react-native";

import {
  accent,
  glass,
  radius,
  optionCardMinHeight,
  optionCardMinWidth,
  semantic,
  spacing,
  stayEditorFormMaxWidth,
  stayEditorSummaryMinWidth,
  stayEditorSummaryWidth,
  stayFieldNumBasis,
  stayFieldNumMinWidth,
  stayFieldPairMinWidth,
  stayInventoryMaxWidth,
  stayProseMaxWidth,
  suiteFormMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandDiscoveryCurrency } from "../../hooks/useBrandDiscoveryCurrency";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  stayInventoryKeys,
  useStayInventory,
} from "../../hooks/useStayInventory";
import {
  bulkCreateStayOfferings,
  changeStayOfferingStatus,
  createStayOffering,
  attachStayOfferingMedia,
  manageStayInventory,
  materializeStayPlaceWindows,
  replaceStayOfferingFees,
  replaceStayUnits,
  removeStayOfferingMedia,
  setStayOfferingPolicy,
  setStayOfferingPrice,
  updateStayOffering,
  upsertStayPlaceSchedule,
  upsertStayPlaceWindows,
  upsertStayRoomNights,
} from "../../services/stayInventoryService";
import {
  pickStayOfferingPhotos,
  stayOfferingMediaUrl,
  uploadStayOfferingPhoto,
} from "../../services/stayMediaService";
import type {
  CreateStayOfferingInput,
  StayBookingMode,
  StayInventorySnapshot,
  StayMediaInput,
  StayOfferingKind,
  StayOfferingRecord,
} from "../../types/stayInventory";
import {
  formatCurrency,
  majorFromMinor,
  minorFromMajor,
} from "../../utils/currency";
import { randomId } from "../../utils/randomId";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { ChipInput } from "../ui/ChipInput";
import { GlassCard } from "../ui/GlassCard";
import { NameBuilder } from "../ui/NameBuilder";
import { OptionCard } from "../ui/OptionCard";
import {
  matchesStayInventoryFilter,
  stayDraftReadiness,
  stayOfferingReadinessErrors,
  type StayInventoryFilter,
} from "./stayInventoryPresentation";
import {
  buildStayPlaceSchedule,
  stayRoomNightCalendarKey,
  type StayPlaceScheduleMode,
} from "./stayAvailabilityContracts";

const FILTERS: readonly { id: StayInventoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "room", label: "Rooms" },
  { id: "place", label: "Places" },
  { id: "draft", label: "Draft" },
  { id: "live", label: "Live" },
  { id: "paused", label: "Paused" },
];

const asPositiveInteger = (value: string, fallback = 1): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * #1501 §9 — the list normaliser. `amenities` / `bulkNames` / `unitNames` are
 * `string[]` in component state now (they used to be newline/comma strings
 * parsed by `splitList`), but the SHAPE emitted to the server is unchanged:
 * trimmed, de-duplicated, empties dropped, order preserved. `makeOffering`'s
 * `CreateStayOfferingInput` is byte-identical for identical operator input.
 *
 * Side benefit: an amenity that CONTAINS a comma ("bed, sofa and desk") used to
 * split into two on load, because `existing.amenities` was seeded with
 * `.join(", ")` and re-split. Arrays never round-trip through a delimiter.
 */
const normalizeList = (values: readonly string[]): string[] => [
  ...new Set(values.map((item) => item.trim()).filter(Boolean)),
];

function mutationCopy(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("stay_version_conflict")) {
    return "This Stay changed elsewhere. Reload before trying again.";
  }
  if (
    code.includes("paid_currency_not_ready") ||
    code.includes("stay_currency_required")
  ) {
    return "Connect a bank or choose the brand’s draft currency first.";
  }
  if (code.includes("currency_mismatch")) {
    return "The price must use this brand’s currency.";
  }
  if (code.includes("forbidden")) {
    return "Your staff permission does not allow this change.";
  }
  if (code.includes("stay_publish_incomplete")) {
    return "Finish the listed readiness items before making this live.";
  }
  return "That change did not save. Check your connection and try again.";
}

/**
 * #1501 §3 — THE TERMINOLOGY CONTRACT. Approved by Seth 2026-08-03, verbatim.
 *
 * Seth's report was blunt: "the terminology on the add form — don't know what
 * it means. I need to understand it." Every toggle pair used to be bare jargon
 * with zero helper text (Single/Bulk, Instant/Request, Interchangeable/Named
 * units, Exclusive units/Shared capacity, Public/Overnight guests only), and
 * the underlying meaning existed only in the source.
 *
 * These strings ARE the fix. They are a contract, not a suggestion — a silent
 * revert to jargon fails `stayTerminology.issue1501.test.ts`. Nothing here
 * changes what the server stores; the data contract is byte-identical.
 */
interface OptionCopy {
  readonly label: string;
  readonly helper: string;
  /** Concrete instance of the abstraction. Omitted where it would be noise. */
  readonly example?: string;
}

type StayChoiceId =
  | "room"
  | "place"
  | "addOne"
  | "addSeveral"
  | "instant"
  | "request"
  | "bookedWhole"
  | "sharedSpots"
  | "interchangeable"
  | "named"
  | "publicAccess"
  | "overnightOnly";

const STAY_CHOICE_COPY: Record<StayChoiceId, OptionCopy> = {
  room: {
    label: "Room",
    helper: "A space with a bed, booked by the night.",
    example: "Ocean-view double, Suite 4",
  },
  place: {
    label: "Place",
    helper: "Any other space guests can reserve — no bed involved.",
    example: "Pool cabana, spa room, private dining table",
  },
  addOne: {
    label: "Add one",
    helper: "Create a single Room or Place.",
  },
  addSeveral: {
    label: "Add several",
    helper:
      "Create many at once. They share every setting below — only the names differ.",
    example: "20 rooms in one go",
  },
  instant: {
    label: "Confirmed instantly",
    helper: "The guest books and it’s theirs straight away. You do nothing.",
  },
  request: {
    label: "You approve first",
    helper:
      "The guest asks; it’s held for you until you say yes in Reservations.",
  },
  bookedWhole: {
    label: "Booked whole",
    helper: "One booking takes the entire space. Nobody else is in it.",
    example: "a cabana one group has to themselves",
  },
  sharedSpots: {
    label: "Shared by the spot",
    helper: "You sell individual spots until the space is full.",
    example: "10 yoga mats sold as 10 separate bookings",
  },
  interchangeable: {
    label: "Any one will do",
    helper:
      "You have several identical ones. Mingla gives the guest whichever is free.",
    example: "8 identical standard doubles",
  },
  named: {
    label: "Each one is named",
    helper:
      "Every one has its own name or number, and Mingla tracks exactly which the guest gets.",
    example: "Room 101, Room 102, Room 103",
  },
  publicAccess: {
    label: "Anyone can book",
    helper:
      "Shows to everyone on Mingla, whether they’re staying with you or not.",
  },
  overnightOnly: {
    label: "Only guests staying here",
    helper:
      "Hidden from the public. Bookable only by someone who already has a room here.",
  },
};

/** Field labels + the helper sentence that explains each one (#1501 §3). */
const STAY_FIELD_COPY = {
  name: {
    label: "Name",
    helper: "What guests will see in search and on the booking page.",
  },
  names: {
    label: "Names",
    helper:
      "One per name — build them with the pattern below, or type your own.",
  },
  description: {
    label: "Description",
    helper:
      "What the guest is actually getting. Two or three lines is plenty.",
  },
  amenities: {
    label: "What’s included",
    helper: "Tap what this has. Type anything else and press enter.",
  },
  quantity: {
    label: "How many you have",
    helper: "The number of identical ones you can sell for the same night.",
    /** D-5: when each one is named, the count is the name count. */
    derivedHelper: "Set by the names below.",
  },
  capacity: {
    label: "Total spots",
    helper: "The most people who can share this space at the same time.",
  },
  maxGuests: {
    label: "Guests per booking",
    helper: "The most people allowed on one booking.",
  },
  unitNames: {
    label: "Name each one",
    helper: "Every unit needs its own name.",
  },
  price: {
    label: "Price per night",
    placeLabel: "Price per booking",
    helper: "What one booking costs before extra charges and tax.",
  },
  feeLabel: {
    label: "Extra charge name",
    helper:
      "One extra charge added to every booking. Leave both blank if you don’t have one.",
  },
  feeAmount: {
    label: "Extra charge amount",
    helper: "Added on top of the price, shown to the guest as its own line.",
  },
  policy: {
    label: "Cancellation policy",
    helper: "In your own words. Guests read this before they pay.",
  },
  noShow: {
    label: "If a guest never turns up, refund",
    helper:
      "0 means you keep the full amount. 100 means they get everything back.",
  },
} as const;

/**
 * #1501 §4.1 — kind-aware quick adds for "What's included". A hotelier should
 * be tapping, not typing, for the twenty things every room has.
 */
const ROOM_AMENITIES: readonly string[] = [
  "Wi-Fi",
  "Air conditioning",
  "Ensuite",
  "Balcony",
  "Sea view",
  "Accessible entrance",
  "Kitchenette",
  "TV",
  "Safe",
  "Workspace",
];

/** The same idea for a Place: no bed, so the vocabulary is different. */
const PLACE_AMENITIES: readonly string[] = [
  "Wi-Fi",
  "Shade",
  "Sun loungers",
  "Towels",
  "Outdoor shower",
  "Accessible entrance",
  "Private entrance",
  "Sound system",
  "Heating",
  "Table service",
];

/**
 * "Every unit needs its own name. You have {n} to name." — the count is live,
 * so the operator always knows how far through the list they are.
 */
const unitNamesHelper = (count: number): string =>
  `${STAY_FIELD_COPY.unitNames.helper} You have ${count} to name.`;

/**
 * One glyph per approved term. Icons carry no meaning on their own — they are
 * a recognition aid on a form an operator fills 40 times in a row. Every name
 * here is also registered in `src/shims/lucideReactNativeWebStub.js` so the
 * business WEB build ships the real glyph (I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL
 * INV-4 fails CI otherwise).
 */
const STAY_CHOICE_ICON: Record<
  StayChoiceId,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  room: BedDouble,
  place: Umbrella,
  addOne: Plus,
  addSeveral: Layers,
  instant: Zap,
  request: UserCheck,
  bookedWhole: Lock,
  sharedSpots: Users,
  interchangeable: Copy,
  named: Tag,
  publicAccess: Globe,
  overnightOnly: KeyRound,
};

/**
 * #1501 §3 — an explained choice, rendered as the shared `OptionCard`. The copy
 * comes from ONE contract table, so a term can never drift between the label,
 * the helper and the screen-reader hint.
 */
function ChoiceCard({
  id,
  selected,
  onPress,
  testID,
  disabled = false,
}: {
  id: StayChoiceId;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}): React.ReactElement {
  const copy = STAY_CHOICE_COPY[id];
  return (
    <OptionCard
      label={copy.label}
      helper={copy.helper}
      example={copy.example}
      icon={STAY_CHOICE_ICON[id]}
      selected={selected}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
    />
  );
}

/**
 * #1501 §5 — THE EDITOR'S DESKTOP GEOMETRY, in one place.
 *
 * Returns the COMPLETE style objects the editor applies — never an override
 * that sets a key to `undefined`, because react-native-web keeps the base
 * style's atomic class in the DOM and the cap silently survives (that is
 * exactly how #1484 shipped broken). Callers SELECT between whole objects.
 *
 * `showRail` is a CONTAINER query, not a viewport query. The Stay workspace is
 * ~252pt narrower than the viewport: at a 1440 viewport there are ~1156pt of
 * container, and 760 + 32 + 320 = 1112 fits with 44 to spare; at 1280 there are
 * ~996 and it does not, so the summary stacks above the CTA instead. Nothing is
 * lost, only reflowed.
 *
 * Exported so the web-resolver proof can render THESE EXACT OBJECTS through the
 * real react-native-web style compiler. A `ReactDOMServer.renderToStaticMarkup`
 * pass never fires `onLayout`, so the split branch is otherwise unreachable
 * from an SSR render — and a width contract that is only checked by
 * react-test-renderer is the #1484 blind spot all over again.
 */
export function stayEditorLayout(input: {
  isWideDesktop: boolean;
  containerWidth: number;
}): {
  showRail: boolean;
  page: ViewStyle;
  body: ViewStyle;
  formColumn: ViewStyle;
  rail: ViewStyle;
} {
  const showRail =
    input.isWideDesktop && input.containerWidth >= stayEditorSummaryMinWidth;
  if (!input.isWideDesktop) {
    return {
      showRail: false,
      page: styles.page,
      body: styles.editorStack,
      formColumn: styles.formColumn,
      rail: styles.summaryRailInRow,
    };
  }
  if (!showRail) {
    return {
      showRail: false,
      page: styles.pageForm,
      body: styles.editorStack,
      formColumn: styles.formColumn,
      rail: styles.summaryRailInRow,
    };
  }
  return {
    showRail: true,
    page: styles.pageEditorSplit,
    body: styles.editorSplitRow,
    formColumn: styles.formColumnInRow,
    rail: styles.summaryRailInRow,
  };
}

/**
 * #1501 §2 — the six sections, in the order a hotelier reasons: what it is ->
 * how guests book it -> how many -> what it costs -> photos. One long
 * undifferentiated stack of inputs was the second thing Seth flagged.
 */
const STAY_SECTION_COPY = {
  start: {
    title: "Start here",
    caption: "Two quick choices, then the details.",
  },
  identity: {
    title: "What it is",
    caption: "The part guests read before they book.",
  },
  booking: {
    title: "How guests book it",
    caption: "Who can book, and what happens when they do.",
  },
  inventory: {
    title: "How many you have",
    caption: "Your inventory for one date.",
  },
  money: {
    title: "What it costs",
    caption: "Prices and rules guests see before they pay.",
  },
  photos: {
    title: "Photos",
    caption: "The first one becomes the cover.",
  },
} as const;

function Section({
  title,
  caption,
  testID,
  children,
}: {
  title: string;
  caption: string;
  testID: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCaption}>{caption}</Text>
      <GlassCard variant="base" style={styles.form}>
        {children}
      </GlassCard>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[
        styles.choice,
        selected && styles.choiceActive,
        disabled && styles.choiceDisabled,
      ]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * #1501 §1 — the AXIS a field is laid out on. `styles.field` used to be ONE
 * style (`{ flex: 1, minWidth: 140 }`) applied in BOTH a row context (where
 * `flex: 1` shares the WIDTH — correct) and stacked in a column context (where
 * the identical declaration shares the HEIGHT — the overlap bug). There is no
 * single style that is right in both, so the axis is now a REQUIRED decision at
 * every call site and each style names the one context it is legal in.
 *
 *   stack — stacked directly in a column; carries NO flex-axis key at all.
 *   pair  — a TEXT field inside `styles.row`; grows into the leftover space.
 *   num   — a NUMERIC field inside `styles.row`; fixed basis, never grows.
 *
 * See invariant I-AXIS-SCOPED-FLEX.
 */
type FieldSpan = "stack" | "pair" | "num";

/** Complete, mutually exclusive measures — selected, never layered. */
function fieldSpanStyle(span: FieldSpan): ViewStyle {
  if (span === "pair") return styles.fieldPair;
  if (span === "num") return styles.fieldNum;
  return styles.fieldStack;
}

function LabeledInput({
  label,
  helper,
  span,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  testID,
  editable = true,
}: {
  label: string;
  /**
   * Always present (#1501 §1 field anatomy: label -> helper -> input -> error).
   * The helper sits ABOVE the input so the operator reads the explanation
   * before deciding what to type.
   */
  helper?: string;
  /** REQUIRED — a new field cannot compile without choosing an axis. */
  span: FieldSpan;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  testID: string;
  editable?: boolean;
}): React.ReactElement {
  return (
    // `-field` suffix: the WRAPPER carries the axis measure, and the axis
    // regression proof has to read the wrapper, not the input (#1501 §1.4).
    // Additive — every pre-existing testID is preserved verbatim on the input.
    <View style={fieldSpanStyle(span)} testID={`${testID}-field`}>
      <Text style={styles.label}>{label}</Text>
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={helper}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        style={[
          styles.input,
          multiline && styles.multiline,
          !editable && styles.inputDisabled,
        ]}
        testID={testID}
      />
    </View>
  );
}

interface OfferingEditorProps {
  brandId: string;
  venueId: string;
  existing?: StayOfferingRecord | null;
  canManageInventory: boolean;
  canManageFinance: boolean;
  onClose: () => void;
}

/**
 * EXPORTED for the #1501 web-resolver regression proof only. The editor is
 * reached in the product exclusively through `StayInventoryManager`'s own
 * state; a `ReactDOMServer.renderToStaticMarkup` pass cannot press "Add", and a
 * react-test-renderer suite is structurally blind to react-native-web's class
 * resolution — which is exactly how #1484 shipped broken. Rendering the editor
 * directly through the REAL RNW style compiler is the only way to assert on the
 * CSS the browser actually applies.
 */
export function OfferingEditor({
  brandId,
  venueId,
  existing = null,
  canManageInventory,
  canManageFinance,
  onClose,
}: OfferingEditorProps): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const queryClient = useQueryClient();
  const currency = useBrandDiscoveryCurrency(brandId);
  const currencyCode = currency.data?.currencyCode ?? null;
  const [kind, setKind] = useState<StayOfferingKind>(existing?.kind ?? "room");
  const [bulk, setBulk] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [bulkNames, setBulkNames] = useState<string[]>([]);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [capacity, setCapacity] = useState(String(existing?.capacity ?? 10));
  const [maxGuests, setMaxGuests] = useState(String(existing?.max_guests ?? 2));
  const [price, setPrice] = useState(
    existing?.currentPrice && currencyCode
      ? String(
          majorFromMinor(
            existing.currentPrice.amount_minor,
            existing.currentPrice.currency_code,
          ),
        )
      : "",
  );
  const existingFee = existing?.currentFees?.[0] ?? null;
  const [feeLabel, setFeeLabel] = useState(existingFee?.label ?? "");
  const [feeAmount, setFeeAmount] = useState(
    existingFee?.amount_minor && existingFee.currency_code
      ? String(
          majorFromMinor(existingFee.amount_minor, existingFee.currency_code),
        )
      : "",
  );
  const [policy, setPolicy] = useState(
    existing?.currentPolicy?.cancellation_policy ?? "",
  );
  const [noShowPercent, setNoShowPercent] = useState(
    existing?.currentPolicy
      ? String(existing.currentPolicy.no_show_refund_basis_points / 100)
      : "0",
  );
  const [amenities, setAmenities] = useState<string[]>(
    existing?.amenities ?? [],
  );
  const [unitNames, setUnitNames] = useState<string[]>(
    (existing?.units ?? []).map((unit) => unit.name),
  );
  const [confirmationMode, setConfirmationMode] = useState<StayBookingMode>(
    existing?.confirmation_mode ?? "request",
  );
  const [namedUnits, setNamedUnits] = useState(
    existing?.unit_naming_mode === "named",
  );
  const [sharedCapacity, setSharedCapacity] = useState(
    existing?.inventory_basis === "shared_capacity",
  );
  const [overnightOnly, setOvernightOnly] = useState(
    existing?.access_scope === "overnight_guests_only",
  );
  const [media, setMedia] = useState<StayMediaInput[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resultCopy, setResultCopy] = useState<string | null>(null);
  // #1501 §5 — the rail threshold is a CONTAINER query fed by `onLayout`, not a
  // viewport query. The Stay workspace is ~252pt narrower than the viewport, so
  // a viewport threshold would promise a rail that does not fit. 0 until the
  // first layout pass, which correctly means "no rail yet".
  const [editorWidth, setEditorWidth] = useState(0);

  // ── D-4 (APPROVED) ────────────────────────────────────────────────────────
  // "Add several" FORCES "Any one will do". Bulk + named units used to write
  // the IDENTICAL unit-name list into every one of the N offerings, because
  // `makeOffering` closes over one `parsedUnits`. That is a data trap, not a
  // feature — so the identity group is hidden in bulk and the mode is derived,
  // never read straight from state.
  const namedUnitsActive = namedUnits && !bulk;
  // ── D-5 (APPROVED) ────────────────────────────────────────────────────────
  // "How many you have" is DERIVED from the name count when each one is named,
  // and rendered read-only. The server already requires
  // `quantity === units.length`; deriving it deletes that error class.
  const derivedQuantity = namedUnitsActive
    ? String(normalizeList(unitNames).length)
    : quantity;
  // #1501 — the partial-failure banner is mirrored in a ref so `onSuccess`
  // reads THIS attempt's outcome instead of whatever the last render captured.
  const resultCopyRef = useRef<string | null>(null);
  const showResult = (copy: string | null): void => {
    resultCopyRef.current = copy;
    setResultCopy(copy);
  };

  const save = useMutation({
    // #1501 (spec §7 open question 2) — `resultCopy` was WRITE-ONCE. A bulk
    // partial failure set it, `onSuccess` only closes the editor when it is
    // null, and nothing ever cleared it — so every later successful save in
    // that session silently refused to close, with no error to explain it.
    // Clearing it at the START of each mutate makes the banner describe THIS
    // attempt only.
    onMutate: () => {
      showResult(null);
    },
    mutationFn: async (): Promise<StayInventorySnapshot> => {
      const names = bulk ? normalizeList(bulkNames) : [name.trim()];
      if (names.length === 0 || names.some((item) => item.length === 0)) {
        throw new Error("name_required");
      }
      if (canManageFinance && Number(price) > 0 && currencyCode === null) {
        throw new Error("stay_currency_required");
      }
      const parsedUnits = normalizeList(unitNames);
      // D-5 (approved): "How many you have" is DERIVED from the named list, so
      // the server's `quantity === units.length` requirement cannot be violated
      // and the `named_units_incomplete` error class is deleted rather than
      // explained. The only thing left to check is that a named offering has at
      // least one name.
      const count = namedUnitsActive
        ? parsedUnits.length
        : asPositiveInteger(quantity);
      if (canManageInventory && namedUnitsActive && parsedUnits.length === 0) {
        throw new Error("named_units_incomplete");
      }
      const fees: CreateStayOfferingInput["fees"] =
        canManageFinance &&
        feeLabel.trim() &&
        Number(feeAmount) > 0 &&
        currencyCode
          ? [
              {
                feeKey: `custom_${feeLabel
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_")}`,
                label: feeLabel.trim(),
                calculation:
                  kind === "room"
                    ? "fixed_per_room_night"
                    : "fixed_per_place_booking",
                amountMinor: minorFromMajor(Number(feeAmount), currencyCode),
                currencyCode,
                displayMode: "separate",
              },
            ]
          : [];
      const policyInput: CreateStayOfferingInput["policy"] =
        canManageFinance && policy.trim()
          ? {
              cancellationPolicy: policy.trim(),
              noShowRefundBasisPoints: Math.max(
                0,
                Math.min(10000, Math.round(Number(noShowPercent) * 100)),
              ),
              operatorCancelRefundBasisPoints: 10000,
            }
          : undefined;
      const priceInput: CreateStayOfferingInput["price"] =
        canManageFinance && Number(price) > 0 && currencyCode
          ? {
              amountMinor: minorFromMajor(Number(price), currencyCode),
              currencyCode,
            }
          : undefined;
      const makeOffering = (itemName: string): CreateStayOfferingInput => ({
        kind,
        name: itemName,
        description: description.trim(),
        confirmationMode,
        inventoryBasis:
          kind === "room"
            ? "pooled_units"
            : sharedCapacity
              ? "shared_capacity"
              : "exclusive_units",
        unitNamingMode: namedUnitsActive ? "named" : "interchangeable",
        quantity: sharedCapacity ? undefined : count,
        capacity: sharedCapacity ? asPositiveInteger(capacity) : undefined,
        minGuests: 1,
        maxGuests: asPositiveInteger(maxGuests),
        maxAdults: kind === "room" ? asPositiveInteger(maxGuests) : undefined,
        maxChildren: kind === "room" ? 0 : undefined,
        placePricingBasis: kind === "place" ? "per_booking" : undefined,
        amenities: normalizeList(amenities),
        accessScope:
          kind === "place" && overnightOnly
            ? "overnight_guests_only"
            : "public",
        units: namedUnitsActive
          ? parsedUnits.map((unitName) => ({ name: unitName }))
          : undefined,
        media: canManageInventory ? media : [],
        price: priceInput,
        fees,
        policy: policyInput,
      });

      if (existing) {
        let inventory =
          queryClient.getQueryData<StayInventorySnapshot>(
            stayInventoryKeys.detail(venueId),
          ) ??
          (await manageStayInventory<StayInventorySnapshot>({
            action: "get",
            venueId,
          }));
        if (canManageInventory) {
          inventory = (
            await updateStayOffering({
              venueId,
              offeringId: existing.id,
              expectedVersion: existing.version,
              patch: {
                name: names[0],
                description: description.trim(),
                confirmationMode,
                amenities: normalizeList(amenities),
                accessScope:
                  kind === "place" && overnightOnly
                    ? "overnight_guests_only"
                    : "public",
              },
            })
          ).inventory;
        }
        const nextVersion = (): number => {
          const current = inventory.offerings.find(
            (item) => item.id === existing.id,
          );
          if (!current) throw new Error("stay_offering_not_found");
          return current.version;
        };
        if (canManageFinance && priceInput) {
          inventory = (
            await setStayOfferingPrice({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              price: priceInput,
            })
          ).inventory;
        }
        if (canManageFinance && policyInput) {
          inventory = (
            await setStayOfferingPolicy({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              policy: policyInput,
            })
          ).inventory;
        }
        if (canManageFinance) {
          inventory = (
            await replaceStayOfferingFees({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              fees,
            })
          ).inventory;
        }
        if (canManageInventory && namedUnitsActive) {
          inventory = (
            await replaceStayUnits({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              units: parsedUnits.map((unitName) => ({ name: unitName })),
            })
          ).inventory;
        }
        for (const photo of canManageInventory ? media : []) {
          inventory = (
            await attachStayOfferingMedia({
              venueId,
              offeringId: existing.id,
              expectedVersion: nextVersion(),
              media: photo,
            })
          ).inventory;
        }
        return inventory;
      }
      if (!canManageInventory) throw new Error("forbidden");
      if (bulk) {
        const response = await bulkCreateStayOfferings({
          venueId,
          idempotencyKey: randomId(),
          items: names.map(makeOffering),
        });
        if (response.job.failed_count > 0) {
          showResult(
            `${response.job.succeeded_count} created; ${response.job.failed_count} need review. Nothing was auto-published.`,
          );
        }
        const refreshed = await manageStayInventory<StayInventorySnapshot>({
          action: "get",
          venueId,
        });
        return refreshed;
      }
      return (
        await createStayOffering({
          venueId,
          offering: makeOffering(names[0]),
        })
      ).inventory;
    },
    onSuccess: (inventory) => {
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      if (resultCopyRef.current === null) onClose();
    },
  });
  const removeMedia = useMutation({
    mutationFn: async (mediaId: string) => {
      if (!existing) throw new Error("stay_media_not_found");
      const latest = queryClient.getQueryData<StayInventorySnapshot>(
        stayInventoryKeys.detail(venueId),
      );
      const latestOffering = latest?.offerings.find(
        (offering) => offering.id === existing.id,
      );
      return removeStayOfferingMedia({
        venueId,
        mediaId,
        expectedVersion: latestOffering?.version ?? existing.version,
      });
    },
    onSuccess: ({ inventory }, mediaId) => {
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      setRemovedMediaIds((current) => [...current, mediaId]);
    },
  });

  const addPhotos = async (): Promise<void> => {
    setUploading(true);
    setMediaError(null);
    try {
      const assets = await pickStayOfferingPhotos(
        Math.max(0, 20 - media.length),
      );
      const uploaded: StayMediaInput[] = [];
      for (let index = 0; index < assets.length; index += 1) {
        try {
          uploaded.push(
            await uploadStayOfferingPhoto({
              brandId,
              venueId,
              asset: assets[index],
              isCover: media.length === 0 && index === 0,
              altText: `${name || kind} photo ${media.length + index + 1}`,
            }),
          );
        } catch {
          setMediaError(
            `${uploaded.length} uploaded; ${assets.length - uploaded.length} could not upload. Retry the missing photos.`,
          );
          break;
        }
      }
      setMedia((current) => [...current, ...uploaded]);
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : "Couldn’t open photos.",
      );
    } finally {
      setUploading(false);
    }
  };

  const localValidation =
    save.error instanceof Error &&
    ["name_required", "named_units_incomplete"].includes(save.error.message)
      ? save.error.message === "name_required"
        ? "Add a name for every Room or Place."
        : "Each one is named, so add at least one name below."
      : save.isError
        ? mutationCopy(save.error)
        : null;

  // #1501 §5 — the readiness checklist the summary rail shows, mirroring
  // `stayOfferingReadinessErrors` label-for-label so a draft and a saved row
  // never describe the same requirement two different ways.
  const readiness = stayDraftReadiness({
    description,
    photoCount: (existing?.media?.length ?? 0) + media.length,
    hasPrice: canManageFinance && Number(price) > 0 && currencyCode !== null,
    hasPolicy: canManageFinance && policy.trim().length > 0,
    namedUnits: namedUnitsActive,
    unitNameCount: unitNames.length,
  });

  const draftNames = bulk ? normalizeList(bulkNames) : [name.trim()].filter(Boolean);
  const draftCount = bulk ? draftNames.length : 1;
  const kindLabel = kind === "room" ? "Room" : "Place";
  const ctaLabel = existing
    ? "Save changes"
    : bulk
      ? "Create drafts"
      : "Create draft";

  // The rail renders only when the CONTAINER can actually hold
  // form column + gap + rail. Below the threshold the same summary stacks above
  // the CTA — nothing is lost, only reflowed.
  const layout = stayEditorLayout({
    isWideDesktop,
    containerWidth: editorWidth,
  });
  const showRail = layout.showRail;

  const summary = (
    <View style={styles.summaryBody} testID="stay-offering-summary">
      <Text style={styles.summaryEyebrow}>You’re creating</Text>
      <Text style={styles.summaryHeadline}>
        {`${draftCount} ${kindLabel} draft${draftCount === 1 ? "" : "s"}`}
      </Text>
      {draftNames.length > 0 ? (
        <Text style={styles.summaryNames} testID="stay-offering-summary-names">
          {draftNames.length > 4
            ? `${draftNames.slice(0, 3).join(", ")} … ${draftNames[draftNames.length - 1]}`
            : draftNames.join(", ")}
        </Text>
      ) : (
        <Text style={styles.summaryNames}>
          {bulk ? "Add the names below." : "Give it a name below."}
        </Text>
      )}
      <View style={styles.summaryFacts}>
        <Text style={styles.summaryFact}>
          {canManageFinance && Number(price) > 0 && currencyCode
            ? formatCurrency(
                minorFromMajor(Number(price), currencyCode),
                currencyCode,
                true,
              )
            : "No price yet"}
        </Text>
        <Text style={styles.summaryFact}>
          {confirmationMode === "instant"
            ? STAY_CHOICE_COPY.instant.label
            : STAY_CHOICE_COPY.request.label}
        </Text>
        <Text style={styles.summaryFact}>
          {`Up to ${asPositiveInteger(maxGuests)} per booking`}
        </Text>
        <Text style={styles.summaryFact}>
          {amenities.length > 0
            ? `${amenities.length} thing${amenities.length === 1 ? "" : "s"} included`
            : "Nothing included yet"}
        </Text>
        <Text style={styles.summaryFact}>
          {`${(existing?.media?.length ?? 0) + media.length} photo${
            (existing?.media?.length ?? 0) + media.length === 1 ? "" : "s"
          }`}
        </Text>
      </View>
      <Text style={styles.summaryEyebrow}>Before these can go live</Text>
      <View style={styles.summaryChecks} testID="stay-offering-readiness">
        {readiness.map((item) => (
          <Text
            key={item.id}
            // Never red: an unfinished draft is not an error.
            style={item.done ? styles.checkDone : styles.checkPending}
            testID={`stay-readiness-${item.id}`}
          >
            {`${item.done ? "✓" : "○"} ${item.label}`}
          </Text>
        ))}
      </View>
      {canManageFinance && currencyCode === null ? (
        <Text style={styles.error}>
          Choose the brand’s provisional currency or connect its bank before
          adding prices.
        </Text>
      ) : null}
      {localValidation ? (
        <Text style={styles.error}>{localValidation}</Text>
      ) : null}
      {resultCopy ? <Text style={styles.warning}>{resultCopy}</Text> : null}
      {/* EXACTLY ONE CTA renders at a time, so `stay-offering-save` is never
          ambiguous to an operator, a screen reader, or a test. */}
      <Button
        label={ctaLabel}
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={uploading || (!canManageInventory && !canManageFinance)}
        fullWidth
        testID="stay-offering-save"
      />
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={layout.page}
      onLayout={(event) => setEditorWidth(event.nativeEvent.layout.width)}
      testID="stay-offering-editor-scroll"
    >
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>
            {existing ? `Edit ${existing.name}` : "Add Rooms or Places"}
          </Text>
          <Text style={styles.helper}>
            Drafts stay private until every server readiness check passes.
          </Text>
          {!canManageInventory && canManageFinance ? (
            <Text style={styles.warning}>
              Your role can manage prices, fees and policies, but not Room or
              Place details.
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close editor"
          onPress={onClose}
        >
          <X size={22} color={textTokens.secondary} />
        </Pressable>
      </View>
      <View
        style={layout.body}
        testID="stay-offering-layout"
      >
        <View
          style={layout.formColumn}
          testID="stay-offering-form-column"
        >
          {!existing ? (
            <Section
              title={STAY_SECTION_COPY.start.title}
              caption={STAY_SECTION_COPY.start.caption}
              testID="stay-section-start"
            >
              <View style={styles.choices}>
                <ChoiceCard
                  id="room"
                  selected={kind === "room"}
                  onPress={() => setKind("room")}
                  testID="stay-add-room"
                />
                <ChoiceCard
                  id="place"
                  selected={kind === "place"}
                  onPress={() => setKind("place")}
                  testID="stay-add-place"
                />
              </View>
              <View style={styles.choices}>
                <ChoiceCard
                  id="addOne"
                  selected={!bulk}
                  onPress={() => setBulk(false)}
                  testID="stay-add-single"
                />
                <ChoiceCard
                  id="addSeveral"
                  selected={bulk}
                  onPress={() => setBulk(true)}
                  testID="stay-add-bulk"
                />
              </View>
            </Section>
          ) : (
            // Edit mode: `updateStayOffering` omits `kind`, so the type cannot
            // change after creation. A read-only strip states what it is
            // instead of offering a control that would silently do nothing.
            <View style={styles.chipStrip} testID="stay-offering-kind-strip">
              <Text style={styles.chipStripText}>
                {existing.kind === "room"
                  ? STAY_CHOICE_COPY.room.label
                  : STAY_CHOICE_COPY.place.label}
              </Text>
              <Text style={styles.chipStripText}>
                {existing.confirmation_mode === "instant"
                  ? STAY_CHOICE_COPY.instant.label
                  : STAY_CHOICE_COPY.request.label}
              </Text>
              <Text style={styles.chipStripText}>
                {existing.unit_naming_mode === "named"
                  ? STAY_CHOICE_COPY.named.label
                  : STAY_CHOICE_COPY.interchangeable.label}
              </Text>
            </View>
          )}

          <Section
            title={STAY_SECTION_COPY.identity.title}
            caption={STAY_SECTION_COPY.identity.caption}
            testID="stay-section-identity"
          >
            {bulk ? (
              <NameBuilder
                label={STAY_FIELD_COPY.names.label}
                helper={STAY_FIELD_COPY.names.helper}
                values={bulkNames}
                onChange={setBulkNames}
                placeholder={
                  kind === "room" ? "Ocean-view double" : "Pool cabana"
                }
                patternPlaceholder={kind === "room" ? "Room" : "Cabana"}
                editable={canManageInventory}
                testID="stay-bulk-names"
              />
            ) : (
              <LabeledInput
                span="stack"
                label={STAY_FIELD_COPY.name.label}
                helper={STAY_FIELD_COPY.name.helper}
                value={name}
                onChangeText={setName}
                placeholder={
                  kind === "room" ? "Ocean-view double" : "Pool cabana"
                }
                editable={canManageInventory}
                testID="stay-offering-name"
              />
            )}
            <LabeledInput
              span="stack"
              label={STAY_FIELD_COPY.description.label}
              helper={STAY_FIELD_COPY.description.helper}
              value={description}
              onChangeText={setDescription}
              placeholder="What guests are reserving"
              multiline
              editable={canManageInventory}
              testID="stay-offering-description"
            />
            <ChipInput
              label={STAY_FIELD_COPY.amenities.label}
              helper={STAY_FIELD_COPY.amenities.helper}
              values={amenities}
              onChange={setAmenities}
              suggestions={kind === "room" ? ROOM_AMENITIES : PLACE_AMENITIES}
              placeholder="Anything else? Type it and press enter"
              editable={canManageInventory}
              testID="stay-offering-amenities"
            />
          </Section>

          <Section
            title={STAY_SECTION_COPY.booking.title}
            caption={STAY_SECTION_COPY.booking.caption}
            testID="stay-section-booking"
          >
            <View style={styles.choices}>
              <ChoiceCard
                id="instant"
                selected={confirmationMode === "instant"}
                onPress={() => setConfirmationMode("instant")}
                disabled={!canManageInventory}
                testID="stay-offering-instant"
              />
              <ChoiceCard
                id="request"
                selected={confirmationMode === "request"}
                onPress={() => setConfirmationMode("request")}
                disabled={!canManageInventory}
                testID="stay-offering-request"
              />
            </View>
            {kind === "place" ? (
              <View style={styles.choices}>
                <ChoiceCard
                  id="publicAccess"
                  selected={!overnightOnly}
                  onPress={() => setOvernightOnly(false)}
                  disabled={!canManageInventory}
                  testID="stay-place-public"
                />
                <ChoiceCard
                  id="overnightOnly"
                  selected={overnightOnly}
                  onPress={() => setOvernightOnly(true)}
                  disabled={!canManageInventory}
                  testID="stay-place-overnight-only"
                />
              </View>
            ) : null}
          </Section>

          <Section
            title={STAY_SECTION_COPY.inventory.title}
            caption={STAY_SECTION_COPY.inventory.caption}
            testID="stay-section-inventory"
          >
            {kind === "place" ? (
              <View style={styles.choices}>
                <ChoiceCard
                  id="bookedWhole"
                  selected={!sharedCapacity}
                  onPress={() => setSharedCapacity(false)}
                  disabled={!canManageInventory}
                  testID="stay-place-exclusive"
                />
                <ChoiceCard
                  id="sharedSpots"
                  selected={sharedCapacity}
                  onPress={() => setSharedCapacity(true)}
                  disabled={!canManageInventory}
                  testID="stay-place-capacity"
                />
              </View>
            ) : null}
            <View style={styles.row} testID="stay-offering-count-row">
              {!sharedCapacity ? (
                <LabeledInput
                  span="num"
                  label={STAY_FIELD_COPY.quantity.label}
                  // D-5 (APPROVED): derived from the named list, so the
                  // server's `quantity === units.length` rule cannot break.
                  helper={
                    namedUnitsActive
                      ? STAY_FIELD_COPY.quantity.derivedHelper
                      : STAY_FIELD_COPY.quantity.helper
                  }
                  value={derivedQuantity}
                  onChangeText={setQuantity}
                  placeholder="1"
                  keyboardType="numeric"
                  editable={canManageInventory && !namedUnitsActive}
                  testID="stay-offering-quantity"
                />
              ) : (
                <LabeledInput
                  span="num"
                  label={STAY_FIELD_COPY.capacity.label}
                  helper={STAY_FIELD_COPY.capacity.helper}
                  value={capacity}
                  onChangeText={setCapacity}
                  placeholder="10"
                  keyboardType="numeric"
                  editable={canManageInventory}
                  testID="stay-offering-capacity"
                />
              )}
              <LabeledInput
                span="num"
                label={STAY_FIELD_COPY.maxGuests.label}
                helper={STAY_FIELD_COPY.maxGuests.helper}
                value={maxGuests}
                onChangeText={setMaxGuests}
                placeholder="2"
                keyboardType="numeric"
                editable={canManageInventory}
                testID="stay-offering-guests"
              />
            </View>
            {!sharedCapacity ? (
              bulk ? (
                // D-4 (APPROVED): naming individual units while adding several
                // would write the SAME list into every offering. Hidden, not
                // disabled — an option you cannot use is noise.
                <Text style={styles.helper} testID="stay-units-bulk-note">
                  Naming individual units is available after you create them.
                </Text>
              ) : (
                <>
                  <View style={styles.choices}>
                    <ChoiceCard
                      id="interchangeable"
                      selected={!namedUnits}
                      onPress={() => setNamedUnits(false)}
                      disabled={!canManageInventory}
                      testID="stay-units-pooled"
                    />
                    <ChoiceCard
                      id="named"
                      selected={namedUnits}
                      onPress={() => setNamedUnits(true)}
                      disabled={!canManageInventory}
                      testID="stay-units-named"
                    />
                  </View>
                  {namedUnitsActive ? (
                    <NameBuilder
                      label={STAY_FIELD_COPY.unitNames.label}
                      helper={unitNamesHelper(unitNames.length)}
                      values={unitNames}
                      onChange={setUnitNames}
                      placeholder={kind === "room" ? "Room 101" : "Cabana 1"}
                      patternPlaceholder={kind === "room" ? "Room" : "Cabana"}
                      editable={canManageInventory}
                      testID="stay-unit-names"
                    />
                  ) : null}
                </>
              )
            ) : null}
          </Section>

          <Section
            title={STAY_SECTION_COPY.money.title}
            caption={STAY_SECTION_COPY.money.caption}
            testID="stay-section-money"
          >
            {canManageFinance ? (
              <>
                <View style={styles.row} testID="stay-offering-price-row">
                  <LabeledInput
                    span="num"
                    label={`${
                      kind === "room"
                        ? STAY_FIELD_COPY.price.label
                        : STAY_FIELD_COPY.price.placeLabel
                    }${currencyCode ? ` (${currencyCode})` : ""}`}
                    helper={STAY_FIELD_COPY.price.helper}
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    testID="stay-offering-price"
                  />
                  <LabeledInput
                    span="num"
                    label={STAY_FIELD_COPY.feeAmount.label}
                    helper={STAY_FIELD_COPY.feeAmount.helper}
                    value={feeAmount}
                    onChangeText={setFeeAmount}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    testID="stay-offering-fee-amount"
                  />
                </View>
                <LabeledInput
                  span="stack"
                  label={STAY_FIELD_COPY.feeLabel.label}
                  helper={STAY_FIELD_COPY.feeLabel.helper}
                  value={feeLabel}
                  onChangeText={setFeeLabel}
                  placeholder="Resort fee"
                  testID="stay-offering-fee-label"
                />
                <LabeledInput
                  span="stack"
                  label={STAY_FIELD_COPY.policy.label}
                  helper={STAY_FIELD_COPY.policy.helper}
                  value={policy}
                  onChangeText={setPolicy}
                  placeholder="Free cancellation until 48 hours before arrival"
                  multiline
                  testID="stay-offering-policy"
                />
                <LabeledInput
                  span="num"
                  label={STAY_FIELD_COPY.noShow.label}
                  helper={STAY_FIELD_COPY.noShow.helper}
                  value={noShowPercent}
                  onChangeText={setNoShowPercent}
                  placeholder="0"
                  keyboardType="numeric"
                  testID="stay-offering-no-show"
                />
              </>
            ) : (
              <Text
                style={styles.warning}
                testID="stay-finance-permission-copy"
              >
                Pricing, fees and cancellation policies require Stay finance
                permission. You can save this as an unpriced draft.
              </Text>
            )}
          </Section>

          {canManageInventory ? (
            <Section
              title={STAY_SECTION_COPY.photos.title}
              caption={STAY_SECTION_COPY.photos.caption}
              testID="stay-section-photos"
            >
              <View style={styles.photoBlock}>
                <Text style={styles.helper}>
                  Add up to 20. The first successful upload becomes the cover.
                </Text>
                <Button
                  label={uploading ? "Uploading…" : "Add photos"}
                  onPress={addPhotos}
                  loading={uploading}
                  variant="secondary"
                  size="sm"
                  testID="stay-offering-add-photos"
                />
                {existing ? (
                  <View style={styles.mediaStrip}>
                    {(existing.media ?? [])
                      .filter((item) => !removedMediaIds.includes(item.id))
                      .map((item) => (
                        <View key={item.id} style={styles.mediaThumbWrap}>
                          <Image
                            source={{
                              uri: stayOfferingMediaUrl(
                                item.storage_object_name,
                              ),
                            }}
                            accessibilityLabel={
                              item.alt_text ?? `${existing.name} photo`
                            }
                            style={styles.mediaThumb}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${item.alt_text ?? "photo"}`}
                            disabled={removeMedia.isPending}
                            onPress={() => removeMedia.mutate(item.id)}
                            style={styles.mediaRemove}
                            testID={`stay-media-remove-${item.id}`}
                          >
                            <X size={14} color={textTokens.primary} />
                          </Pressable>
                        </View>
                      ))}
                  </View>
                ) : null}
                <Text style={styles.helper}>
                  {(existing?.media?.length ?? 0) + media.length} total after
                  save
                </Text>
                {mediaError ? (
                  <Text style={styles.error}>{mediaError}</Text>
                ) : null}
                {removeMedia.isError ? (
                  <Text style={styles.error}>
                    {mutationCopy(removeMedia.error)}
                  </Text>
                ) : null}
              </View>
            </Section>
          ) : null}

          {/* Below the rail threshold the SAME summary stacks here, directly
              above the CTA. Nothing is lost, only reflowed. */}
          {showRail ? null : summary}
        </View>
        {showRail ? (
          <View style={layout.rail} testID="stay-offering-rail">
            {summary}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function OfferingRow({
  offering,
  venueId,
  onEdit,
  canManageInventory,
  canManageFinance,
}: {
  offering: StayOfferingRecord;
  venueId: string;
  onEdit: () => void;
  canManageInventory: boolean;
  canManageFinance: boolean;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const errors = stayOfferingReadinessErrors(offering);
  const statusMutation = useMutation({
    mutationFn: (status: "live" | "paused") =>
      changeStayOfferingStatus({
        venueId,
        offeringId: offering.id,
        expectedVersion: offering.version,
        status,
      }),
    onSuccess: ({ inventory }) =>
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory),
  });
  const cover = (offering.media ?? []).find(
    (item) => item.is_cover && item.status === "ready",
  );
  const inventoryCopy =
    offering.inventory_basis === "shared_capacity"
      ? `${offering.capacity ?? 0} guests`
      : offering.unit_naming_mode === "named"
        ? `${offering.quantity ?? 0} named units`
        : `${offering.quantity ?? 0} interchangeable`;
  return (
    <GlassCard variant="base" style={styles.rowCard}>
      <View style={styles.rowTop}>
        {cover ? (
          <Image
            source={{ uri: stayOfferingMediaUrl(cover.storage_object_name) }}
            accessibilityLabel={cover.alt_text ?? `${offering.name} cover`}
            style={styles.cover}
          />
        ) : (
          <View style={styles.coverFallback}>
            <BedDouble size={24} color={accent.warm} />
          </View>
        )}
        <View style={styles.flex}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.cardTitle}>{offering.name}</Text>
            <Text style={styles.status}>{offering.status.toUpperCase()}</Text>
          </View>
          <Text style={styles.helper}>
            {offering.kind === "room" ? "Room" : "Place"} · {inventoryCopy} ·{" "}
            {offering.confirmation_mode === "instant" ? "Instant" : "Request"}
          </Text>
          <Text style={styles.price}>
            {offering.currentPrice
              ? formatCurrency(
                  offering.currentPrice.amount_minor,
                  offering.currentPrice.currency_code,
                  true,
                )
              : "Price not set"}
          </Text>
          <Text style={styles.helper}>
            {offering.nextAvailability
              ? `Next: ${offering.nextAvailability}`
              : "No open future availability"}
          </Text>
        </View>
      </View>
      {errors.length > 0 ? (
        <View style={styles.readiness}>
          {errors.map((error) => (
            <Text key={error} style={styles.warning}>
              • {error}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.ready}>
          <Check size={14} color={semantic.success} /> Ready for status review
        </Text>
      )}
      {statusMutation.isError ? (
        <Text style={styles.error}>{mutationCopy(statusMutation.error)}</Text>
      ) : null}
      <View style={styles.actions}>
        {canManageInventory || canManageFinance ? (
          <Button
            label={canManageInventory ? "Edit" : "Pricing"}
            onPress={onEdit}
            variant="secondary"
            size="sm"
            leadingIcon="edit"
            testID={`stay-edit-${offering.id}`}
          />
        ) : null}
        {canManageInventory && offering.status === "live" ? (
          <Button
            label="Pause"
            onPress={() => statusMutation.mutate("paused")}
            variant="secondary"
            size="sm"
            loading={statusMutation.isPending}
            testID={`stay-pause-${offering.id}`}
          />
        ) : canManageInventory ? (
          <Button
            label="Make live"
            onPress={() => statusMutation.mutate("live")}
            size="sm"
            disabled={errors.length > 0}
            loading={statusMutation.isPending}
            testID={`stay-live-${offering.id}`}
          />
        ) : null}
      </View>
    </GlassCard>
  );
}

function AvailabilityManager({
  venueId,
  offerings,
  timezone,
  canManageFinance,
}: {
  venueId: string;
  offerings: StayOfferingRecord[];
  timezone: string;
  canManageFinance: boolean;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(offerings[0]?.id ?? "");
  const selected =
    offerings.find((item) => item.id === selectedId) ?? offerings[0];
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [quantity, setQuantity] = useState("1");
  const [stopSell, setStopSell] = useState(false);
  const [overridePrice, setOverridePrice] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [mode, setMode] = useState<StayPlaceScheduleMode>("fixed_slots");
  const currencyCode = selected?.currentPrice?.currency_code ?? null;

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("stay_offering_not_found");
      if (selected.kind === "room") {
        const start = new Date(`${fromDate}T12:00:00Z`);
        const end = new Date(`${toDate}T12:00:00Z`);
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime()) ||
          end < start
        ) {
          throw new Error("invalid_date_range");
        }
        const nights: Record<string, unknown>[] = [];
        for (
          let cursor = start;
          cursor <= end;
          cursor = new Date(cursor.getTime() + 86400000)
        ) {
          const row: Record<string, unknown> = {
            localDate: cursor.toISOString().slice(0, 10),
            sellableQuantity: asPositiveInteger(quantity),
            stopSell,
            minimumNights: 1,
          };
          const existing = (selected.roomNights ?? []).find(
            (night) => night.local_date === row.localDate,
          );
          if (existing) row.expectedVersion = existing.version;
          if (overridePrice && currencyCode) {
            row.priceOverrideMinor = minorFromMajor(
              Number(overridePrice),
              currencyCode,
            );
            row.currencyCode = currencyCode;
          }
          nights.push(row);
        }
        return upsertStayRoomNights({
          venueId,
          offeringId: selected.id,
          nights,
        });
      }
      const existingWindows = (selected.placeWindows ?? []).filter(
        (windowRow) =>
          windowRow.local_date >= fromDate && windowRow.local_date <= toDate,
      );
      if (existingWindows.length > 0) {
        return upsertStayPlaceWindows({
          venueId,
          windows: existingWindows.map((windowRow) => ({
            windowId: windowRow.id,
            expectedVersion: windowRow.version,
            stopSell,
            ...(overridePrice && currencyCode
              ? {
                  priceOverrideMinor: minorFromMajor(
                    Number(overridePrice),
                    currencyCode,
                  ),
                  currencyCode,
                }
              : {}),
          })),
        });
      }
      const scheduled = await upsertStayPlaceSchedule({
        venueId,
        offeringId: selected.id,
        schedule: buildStayPlaceSchedule({
          mode,
          timezone,
          fromDate,
          toDate,
          startTime,
          endTime,
          stopSell,
        }),
      });
      if (stopSell) return scheduled;
      const updated = scheduled.inventory.offerings.find(
        (offering) => offering.id === selected.id,
      );
      const rule = [...(updated?.placeScheduleRules ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id))
        .at(-1);
      if (!rule) throw new Error("stay_schedule_rule_not_found");
      const materialized = await materializeStayPlaceWindows({
        venueId,
        scheduleRuleId: rule.id,
        fromDate,
        toDate: mode === "fixed_slots" ? fromDate : toDate,
      });
      const created =
        materialized.inventory.offerings
          .find((offering) => offering.id === selected.id)
          ?.placeWindows?.filter(
            (windowRow) =>
              windowRow.local_date >= fromDate &&
              windowRow.local_date <= toDate,
          ) ?? [];
      if (!overridePrice || !currencyCode || created.length === 0) {
        return materialized;
      }
      return upsertStayPlaceWindows({
        venueId,
        windows: created.map((windowRow) => ({
          windowId: windowRow.id,
          expectedVersion: windowRow.version,
          priceOverrideMinor: minorFromMajor(
            Number(overridePrice),
            currencyCode,
          ),
          currencyCode,
          stopSell: false,
        })),
      });
    },
    onSuccess: ({ inventory }) =>
      queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory),
  });

  if (!selected) {
    return (
      <Text style={styles.helper}>
        Add a Room or Place before setting availability.
      </Text>
    );
  }
  return (
    <View style={styles.availability}>
      <Text style={styles.label}>Offering</Text>
      <View style={styles.choices}>
        {offerings.map((offering) => (
          <Choice
            key={offering.id}
            label={offering.name}
            selected={offering.id === selected.id}
            onPress={() => setSelectedId(offering.id)}
            testID={`stay-availability-${offering.id}`}
          />
        ))}
      </View>
      <View style={styles.row}>
        <LabeledInput
          span="pair"
          label={selected.kind === "room" ? "First night" : "Start date"}
          value={fromDate}
          onChangeText={setFromDate}
          placeholder="YYYY-MM-DD"
          testID="stay-availability-from"
        />
        <LabeledInput
          span="pair"
          label={selected.kind === "room" ? "Last night" : "End date"}
          value={toDate}
          onChangeText={setToDate}
          placeholder="YYYY-MM-DD"
          testID="stay-availability-to"
        />
      </View>
      {selected.kind === "room" ? (
        <View style={styles.row}>
          <LabeledInput
            span="num"
            label="Sellable rooms"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="1"
            keyboardType="numeric"
            testID="stay-night-quantity"
          />
          {canManageFinance ? (
            <LabeledInput
              span="num"
              label={`Price override${currencyCode ? ` (${currencyCode})` : ""}`}
              value={overridePrice}
              onChangeText={setOverridePrice}
              placeholder="Optional"
              keyboardType="decimal-pad"
              testID="stay-night-price"
            />
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.choices}>
            <Choice
              label="Fixed"
              selected={mode === "fixed_slots"}
              onPress={() => setMode("fixed_slots")}
              testID="stay-place-fixed"
            />
            <Choice
              label="Repeating"
              selected={mode === "repeating_windows"}
              onPress={() => setMode("repeating_windows")}
              testID="stay-place-repeating"
            />
            <Choice
              label="Full day"
              selected={mode === "full_day"}
              onPress={() => setMode("full_day")}
              testID="stay-place-full-day"
            />
          </View>
          <View style={styles.row}>
            <LabeledInput
              span="num"
              label="Starts"
              value={startTime}
              onChangeText={setStartTime}
              placeholder="09:00"
              testID="stay-place-start-time"
            />
            <LabeledInput
              span="num"
              label="Ends"
              value={endTime}
              onChangeText={setEndTime}
              placeholder="17:00"
              testID="stay-place-end-time"
            />
            {canManageFinance ? (
              <LabeledInput
                span="num"
                label={`Price override${currencyCode ? ` (${currencyCode})` : ""}`}
                value={overridePrice}
                onChangeText={setOverridePrice}
                placeholder="Optional"
                keyboardType="decimal-pad"
                testID="stay-place-price"
              />
            ) : null}
          </View>
        </>
      )}
      <Choice
        label="Stop sell / blackout"
        selected={stopSell}
        onPress={() => setStopSell((value) => !value)}
        testID="stay-stop-sell"
      />
      {save.isError ? (
        <Text style={styles.error}>{mutationCopy(save.error)}</Text>
      ) : null}
      <Button
        label={stopSell ? "Save blackout" : "Open availability"}
        onPress={() => save.mutate()}
        loading={save.isPending}
        fullWidth
        testID="stay-availability-save"
      />
      <Text style={styles.helper}>
        The server checks dates, quantities, permissions, currency and edit
        versions before saving.
      </Text>
      {!canManageFinance ? (
        <Text style={styles.warning} testID="stay-availability-finance-copy">
          Your inventory changes will use the saved base price. Price overrides
          require Stay finance permission.
        </Text>
      ) : null}
      <View style={styles.calendarList}>
        <Text style={styles.label}>Current calendar</Text>
        {selected.kind === "room" ? (
          (selected.roomNights ?? []).length > 0 ? (
            (selected.roomNights ?? []).slice(0, 40).map((night) => (
              <View
                key={stayRoomNightCalendarKey(selected.id, night.local_date)}
                style={styles.calendarRow}
              >
                <Text style={styles.calendarDate}>{night.local_date}</Text>
                <Text style={styles.helper}>
                  {night.stop_sell
                    ? "Blackout"
                    : `${night.sellable_quantity} room${night.sellable_quantity === 1 ? "" : "s"}`}
                  {night.price_override_minor && night.currency_code
                    ? ` · ${formatCurrency(
                        night.price_override_minor,
                        night.currency_code,
                        true,
                      )}`
                    : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.helper}>No Room nights saved yet.</Text>
          )
        ) : (selected.placeWindows ?? []).length > 0 ? (
          (selected.placeWindows ?? []).slice(0, 40).map((windowRow) => (
            <View key={windowRow.id} style={styles.calendarRow}>
              <Text style={styles.calendarDate}>{windowRow.local_date}</Text>
              <Text style={styles.helper}>
                {windowRow.stop_sell
                  ? "Blackout"
                  : `${new Date(windowRow.starts_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}–${new Date(windowRow.ends_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`}
                {windowRow.price_override_minor && windowRow.currency_code
                  ? ` · ${formatCurrency(
                      windowRow.price_override_minor,
                      windowRow.currency_code,
                      true,
                    )}`
                  : ""}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.helper}>No Place windows saved yet.</Text>
        )}
      </View>
    </View>
  );
}

export function StayInventoryManager({
  brandId,
  venueId,
  mode,
}: {
  brandId: string;
  venueId: string;
  mode: "inventory" | "availability";
}): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const inventory = useStayInventory(venueId);
  const [filter, setFilter] = useState<StayInventoryFilter>("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<StayOfferingRecord | "new" | null>(null);
  const offerings = useMemo(
    () => inventory.data?.offerings ?? [],
    [inventory.data?.offerings],
  );
  const canManageInventory =
    inventory.data?.permissions.canManageInventory ?? false;
  const canManageFinance =
    inventory.data?.permissions.canManageFinance ?? false;
  const filtered = useMemo(
    () =>
      offerings.filter((offering) =>
        matchesStayInventoryFilter({ offering, filter, search }),
      ),
    [filter, offerings, search],
  );

  if (inventory.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={accent.warm} />
        <Text style={styles.helper}>Loading Stay inventory…</Text>
      </View>
    );
  }
  if (inventory.isError && !inventory.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.cardTitle}>Rooms & Places could not load</Text>
        <Text style={styles.helper}>
          Your saved data is safe. Check your connection and retry.
        </Text>
        <Button
          label="Retry"
          onPress={async () => {
            await inventory.refetch();
          }}
          testID="stay-inventory-retry"
        />
      </View>
    );
  }
  if (editor !== null) {
    return (
      <OfferingEditor
        brandId={brandId}
        venueId={venueId}
        existing={editor === "new" ? null : editor}
        canManageInventory={canManageInventory}
        canManageFinance={canManageFinance}
        onClose={() => setEditor(null)}
      />
    );
  }
  return (
    <ScrollView
      contentContainerStyle={isWideDesktop ? styles.pageDesktop : styles.page}
      testID="stay-inventory-list-scroll"
    >
      {inventory.isError ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.warning}>
            You’re seeing saved inventory while offline. Reconnect before
            changing it.
          </Text>
        </View>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>
            {mode === "inventory" ? "Rooms & Places" : "Availability & pricing"}
          </Text>
          <Text style={styles.helper}>
            {mode === "inventory"
              ? "Rooms and reservable Places share one Stay manager."
              : "Manage Room nights and scheduled Place windows together."}
          </Text>
        </View>
        {mode === "inventory" ? (
          <Button
            label="Add"
            onPress={() => setEditor("new")}
            disabled={!canManageInventory}
            size="sm"
            testID="stay-inventory-add"
          />
        ) : null}
      </View>
      {mode === "inventory" ? (
        <>
          {!canManageInventory ? (
            <Text
              style={styles.warning}
              testID="stay-inventory-permission-copy"
            >
              Your role can view Rooms and Places, but Stay inventory permission
              is required to add or change them.
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel="Search Rooms and Places"
            value={search}
            onChangeText={setSearch}
            placeholder="Search Rooms & Places"
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
            testID="stay-inventory-search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.choices}
          >
            {FILTERS.map((item) => (
              <Choice
                key={item.id}
                label={item.label}
                selected={filter === item.id}
                onPress={() => setFilter(item.id)}
                testID={`stay-filter-${item.id}`}
              />
            ))}
          </ScrollView>
          {filtered.length === 0 ? (
            <GlassCard variant="base" style={styles.empty}>
              <BedDouble size={30} color={accent.warm} />
              <Text style={styles.cardTitle}>
                {offerings.length === 0
                  ? "No Rooms or Places yet"
                  : "No matching inventory"}
              </Text>
              <Text style={styles.helper}>
                Add one Room or Place, or create several drafts in bulk.
              </Text>
              <Button
                label="Add Room or Place"
                onPress={() => setEditor("new")}
                disabled={!canManageInventory}
                testID="stay-inventory-empty-add"
              />
            </GlassCard>
          ) : (
            filtered.map((offering) => (
              <OfferingRow
                key={offering.id}
                offering={offering}
                venueId={venueId}
                onEdit={() => setEditor(offering)}
                canManageInventory={canManageInventory}
                canManageFinance={canManageFinance}
              />
            ))
          )}
        </>
      ) : (
        <GlassCard variant="base" style={styles.form}>
          <CalendarDays size={26} color={accent.warm} />
          {canManageInventory ? (
            <AvailabilityManager
              venueId={venueId}
              offerings={offerings}
              timezone={inventory.data?.settings?.timezone ?? "UTC"}
              canManageFinance={canManageFinance}
            />
          ) : (
            <Text
              style={styles.warning}
              testID="stay-availability-permission-copy"
            >
              Stay inventory permission is required to open Room nights or Place
              windows.
            </Text>
          )}
        </GlassCard>
      )}
    </ScrollView>
  );
}

/** Geometry shared by every page measure below (see the note on `page`). */
const PAGE_BASE = {
  padding: spacing.md,
  paddingBottom: spacing.xxl * 3,
  gap: spacing.md,
  width: "100%",
} as const;

const styles = StyleSheet.create({
  // #1484 — COMPLETE, MUTUALLY EXCLUSIVE measures; exactly ONE is selected.
  // NEVER layered as `[page, <override setting maxWidth to undefined>]` — on
  // react-native-web such an override does not clear the base declaration (the
  // base's atomic `r-maxWidth-*` class survives into the DOM), so the cap
  // silently persists. Omitting the KEY is the only form the web resolver
  // honours. (ORCH-1184 did exactly this for `desktopCentered`, which is why
  // the venue suite was never affected.)
  page: {
    ...PAGE_BASE,
    // Phone / web-phone readable measure (unchanged; tokenised).
    maxWidth: stayInventoryMaxWidth,
    alignSelf: "center",
  },
  // WIDE DESKTOP, the Rooms & Places / Availability LIST: no `maxWidth` key at
  // all — the shared SuiteDesktopShell workspace owns the gutters and the left
  // anchor, so the list fills the workspace instead of leaving a dead gutter.
  pageDesktop: {
    ...PAGE_BASE,
    alignSelf: "flex-start",
  },
  // WIDE DESKTOP, the embedded `OfferingEditor` EDITABLE FORM. "Fill the
  // screen" is right for tables and wrong for forms: a text field stretched
  // across a 2,000px monitor is unusable. The editor keeps the same readable
  // measure as Stay Settings (`suiteFormMaxWidth`), left-anchored — while the
  // surrounding LIST stays uncapped. That distinction is the point.
  pageForm: {
    ...PAGE_BASE,
    maxWidth: suiteFormMaxWidth,
    alignSelf: "flex-start",
  },
  // #1501 §5 — WIDE DESKTOP *with room for the summary rail*. The PAGE releases
  // its cap here and the measure discipline moves onto the form COLUMN
  // (`formColumnInRow`, capped at `stayEditorFormMaxWidth`), because a page
  // capped at 720 cannot hold 760 + 32 + 320. This is what unlocks the rail and
  // answers "it doesn't fill the space" WITHOUT producing a 1,400pt-wide text
  // input. Below the container threshold the editor keeps `pageForm` exactly as
  // it shipped. Complete objects, selected — never an override.
  pageEditorSplit: {
    ...PAGE_BASE,
    alignSelf: "flex-start",
  },
  // The editor body: form column beside the rail, or one stacked column.
  editorSplitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: spacing.xl,
    width: "100%",
  },
  editorStack: { width: "100%", minWidth: 0, gap: spacing.lg },
  // STACK measure — no flex-axis key (I-AXIS-SCOPED-FLEX).
  formColumn: { width: "100%", minWidth: 0, gap: spacing.lg },
  // ROW-ONLY: the readable measure of the form column itself. `flexShrink: 1`
  // + `flexBasis: 0` + `flexGrow: 1` means it takes everything the rail leaves,
  // up to its own cap.
  formColumnInRow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    maxWidth: stayEditorFormMaxWidth,
    gap: spacing.lg,
  },
  // ROW-ONLY: fixed rail. `position: "sticky"` is deliberately NOT used — RN
  // has no such value and RN-web support is unverified; a non-sticky rail is
  // correct without it.
  summaryRailInRow: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: stayEditorSummaryWidth,
    width: stayEditorSummaryWidth,
  },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
  sectionCaption: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
    maxWidth: stayProseMaxWidth,
  },
  summaryBody: { gap: spacing.sm },
  summaryEyebrow: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  summaryHeadline: { ...typography.h3, color: textTokens.primary },
  summaryNames: {
    ...typography.bodySm,
    color: textTokens.secondary,
    maxWidth: stayProseMaxWidth,
  },
  summaryFacts: { gap: spacing.xxs },
  summaryFact: { ...typography.bodySm, color: textTokens.secondary },
  summaryChecks: { gap: spacing.xxs },
  // NEVER red on either branch: an unfinished draft is not an error.
  checkDone: { ...typography.bodySm, color: semantic.success },
  checkPending: { ...typography.bodySm, color: textTokens.tertiary },
  chipStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chipStripText: {
    ...typography.caption,
    color: textTokens.secondary,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: { ...typography.h2, color: textTokens.primary },
  cardTitle: { ...typography.h3, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  // #1501 §1 field anatomy — the helper sits between the LABEL and the INPUT,
  // never between an input and the next label (that ambiguity is what made the
  // old stack read as chaos). Capped at the prose measure so it wraps like
  // prose rather than running the width of a desktop column.
  fieldHelper: {
    ...typography.caption,
    color: textTokens.secondary,
    maxWidth: stayProseMaxWidth,
  },
  flex: { flex: 1, minWidth: 0 },
  form: { gap: spacing.md },
  // ── #1501 §1 — AXIS-SCOPED FIELD MEASURES (I-AXIS-SCOPED-FLEX) ───────────
  // The deleted `field: { flex: 1, minWidth: 140, gap: spacing.xs }` carried a
  // flex-axis key and was applied under TWO different `flexDirection` contexts.
  // In `styles.form` (a column) `flex: 1` told every field to take an equal
  // share of the container HEIGHT; a field whose input carries `minHeight: 96`
  // then rendered taller than its allotted box, overflowed its own `View`, and
  // the next field's label painted on top. Same bug class as #1484's
  // `flexBasis: 320`. Each entry below is legal under exactly ONE
  // `flexDirection`, and its NAME says which.
  //
  // STACK — column context. NO flex-axis key at all, so nothing can ever
  // resolve against the cross axis again.
  fieldStack: { width: "100%", minWidth: 0, gap: spacing.xs },
  // PAIR — a TEXT field inside `styles.row`. Grows into whatever the numeric
  // siblings leave behind (`flexBasis: 0` + `flexGrow: 1`).
  fieldPair: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: stayFieldPairMinWidth,
    gap: spacing.xs,
  },
  // NUM — a NUMERIC field inside `styles.row`. Fixed basis, never grows: a
  // quantity box stretched across a desktop column is the defect, not the fix.
  fieldNum: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: stayFieldNumBasis,
    minWidth: stayFieldNumMinWidth,
    gap: spacing.xs,
  },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
  },
  // PROSE inputs are capped at a readable measure. Without the cap a
  // description box on a wide desktop column becomes a single unreadable line.
  multiline: {
    minHeight: 96,
    maxWidth: stayProseMaxWidth,
    textAlignVertical: "top",
    paddingTop: spacing.sm,
  },
  inputDisabled: { opacity: 0.55 },
  // #1501 §1 — `twoCol` renamed to `row` because it is not always two columns;
  // it is THE row context, and it is the only place a `fieldPair`/`fieldNum`
  // measure is legal. `alignItems: "flex-start"` is LOAD-BEARING: RN's default
  // `stretch` makes every child as tall as the tallest sibling, which is the
  // second-order version of the same overlap bug.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.md,
    alignItems: "flex-start",
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: glass.tint.profileBase,
  },
  choiceActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235,120,37,0.14)",
  },
  choiceDisabled: { opacity: 0.55 },
  choiceText: { ...typography.bodySm, color: textTokens.secondary },
  choiceTextActive: { color: accent.warm, fontWeight: "700" },
  // #1501 §3 — an EXPLAINED choice is a card, not a pill: it has to hold a
  // label, a helper sentence and an example without truncating any of them.
  // ROW-ONLY (I-AXIS-SCOPED-FLEX): the name says `Row` because the flex-axis
  // keys below are only meaningful inside `styles.choices`
  // (`flexDirection: "row"`). Never apply this in a column.
  choiceRowCard: {
    borderRadius: radius.lg,
    minHeight: optionCardMinHeight,
    minWidth: optionCardMinWidth,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: spacing.xxs,
    paddingVertical: spacing.md,
  },
  choiceHelper: { ...typography.caption, color: textTokens.secondary },
  choiceExample: { ...typography.caption, color: textTokens.tertiary },
  photoBlock: { gap: spacing.sm },
  mediaStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mediaThumbWrap: { position: "relative" },
  mediaThumb: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  mediaRemove: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,18,0.82)",
  },
  error: { ...typography.bodySm, color: semantic.error },
  warning: { ...typography.bodySm, color: semantic.warning },
  ready: {
    ...typography.bodySm,
    color: semantic.success,
    flexDirection: "row",
    alignItems: "center",
  },
  empty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  rowCard: { gap: spacing.md },
  rowTop: { flexDirection: "row", gap: spacing.md },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cover: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  coverFallback: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  status: { ...typography.caption, color: accent.warm, fontWeight: "800" },
  price: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  readiness: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  availability: { gap: spacing.md },
  offlineBanner: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
    padding: spacing.md,
  },
  calendarList: { gap: spacing.sm, marginTop: spacing.md },
  calendarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  calendarDate: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
});

export default StayInventoryManager;
