/**
 * META-ORCH-1148 sub-ORCH 2.1a — Availability module (config editor).
 *
 * Replaces the Availability ComingSoon slot. Writes venue_availability_config
 * (service periods, turn times by party size, buffer, max-per-slot, granularity,
 * advance window, min notice) + venue_blackouts. This config is exactly what the
 * engine RPC reads — NO client-side slot generation lives here. Manager-plus
 * rank gates the controls (RLS enforces server-side). Every Pressable carries an
 * a11y label (I-39). No dead taps.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useNavigation } from "expo-router";

import {
  accent,
  semantic,
  spacing,
  suiteFormMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  useDeleteVenueBlackout,
  useUpsertVenueAvailabilityConfig,
  useUpsertVenueBlackout,
  useVenueAvailabilityConfig,
  useVenueBlackouts,
} from "../../hooks/useVenueAvailability";
import { useVenueTables } from "../../hooks/useVenueTables";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { formatTimezoneLabel, getAllTimezones } from "../../utils/timezones";
import { setAvailabilityNumericToolbarState } from "../../wrappers/KeyboardToolbarRoot";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { ChevronRight } from "lucide-react-native";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { Skeleton } from "../ui/Skeleton";
import { Toast, type ToastKind } from "../ui/Toast";
import { useShareNetworkState } from "../ui/useShareNetworkState";
import { VenueBlackoutSheet } from "./VenueBlackoutSheet";
import type {
  ServicePeriod,
  VenueAvailabilityConfig,
  VenueAvailabilityConfigPatch,
  VenueBlackout,
  VenueBlackoutUpsert,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

const DAY_SHORT: readonly string[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const AVAILABILITY_FIELD_KEYS = [
  "turnTimes.1-2",
  "turnTimes.3-4",
  "turnTimes.5-6",
  "turnTimes.7+",
  "bufferMinutes",
  "maxReservationsPerSlot",
  "slotGranularityMinutes",
  "advanceWindowDays",
  "minNoticeMinutes",
] as const;

export type AvailabilityFieldKey = (typeof AVAILABILITY_FIELD_KEYS)[number];
export type AvailabilityNumericDraft = Record<AvailabilityFieldKey, string>;
export type AvailabilityDraftErrors = Record<
  AvailabilityFieldKey,
  string | null
>;

const TURN_FIELD_TO_ENGINE_KEY: Record<
  Extract<AvailabilityFieldKey, `turnTimes.${string}`>,
  string
> = {
  "turnTimes.1-2": "p2",
  "turnTimes.3-4": "p4",
  "turnTimes.5-6": "p6",
  "turnTimes.7+": "p8",
};

export const DEFAULT_NUMERIC_DRAFT: AvailabilityNumericDraft = {
  "turnTimes.1-2": "",
  "turnTimes.3-4": "",
  "turnTimes.5-6": "",
  "turnTimes.7+": "",
  bufferMinutes: "0",
  maxReservationsPerSlot: "",
  slotGranularityMinutes: "15",
  advanceWindowDays: "30",
  minNoticeMinutes: "0",
};

const TURN_ERROR = "Enter 1–600 minutes, or leave blank.";
const BUFFER_ERROR = "Enter 0–240 minutes.";
const MAX_SLOT_ERROR = "Enter 1–999, or leave blank for all tables.";
const GRANULARITY_ERROR = "Use 5, 10, 15, 20, 30, or 60 minutes.";
const ADVANCE_ERROR = "Enter 0–365 days.";
const NOTICE_ERROR = "Enter 0–10,080 minutes.";

export function sanitizeAvailabilityDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export function availabilityDraftFromConfig(
  config: VenueAvailabilityConfig | null | undefined,
): AvailabilityNumericDraft {
  if (config == null) return { ...DEFAULT_NUMERIC_DRAFT };
  const turnValue = (engineKey: string): string => {
    const value = config.turnTimes[engineKey];
    return value == null || value === 0 ? "" : String(value);
  };
  return {
    "turnTimes.1-2": turnValue("p2"),
    "turnTimes.3-4": turnValue("p4"),
    "turnTimes.5-6": turnValue("p6"),
    "turnTimes.7+": turnValue("p8"),
    bufferMinutes: String(config.bufferMinutes),
    maxReservationsPerSlot:
      config.maxReservationsPerSlot == null
        ? ""
        : String(config.maxReservationsPerSlot),
    slotGranularityMinutes: String(config.slotGranularityMinutes),
    advanceWindowDays: String(config.advanceWindowDays),
    minNoticeMinutes: String(config.minNoticeMinutes),
  };
}

function integerInRange(raw: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateAvailabilityDraft(
  draft: AvailabilityNumericDraft,
): AvailabilityDraftErrors {
  const turnError = (raw: string): string | null =>
    raw.length === 0 || integerInRange(raw, 1, 600) ? null : TURN_ERROR;
  return {
    "turnTimes.1-2": turnError(draft["turnTimes.1-2"]),
    "turnTimes.3-4": turnError(draft["turnTimes.3-4"]),
    "turnTimes.5-6": turnError(draft["turnTimes.5-6"]),
    "turnTimes.7+": turnError(draft["turnTimes.7+"]),
    bufferMinutes: integerInRange(draft.bufferMinutes, 0, 240)
      ? null
      : BUFFER_ERROR,
    maxReservationsPerSlot:
      draft.maxReservationsPerSlot.length === 0 ||
      integerInRange(draft.maxReservationsPerSlot, 1, 999)
        ? null
        : MAX_SLOT_ERROR,
    slotGranularityMinutes: ["5", "10", "15", "20", "30", "60"].includes(
      draft.slotGranularityMinutes,
    )
      ? null
      : GRANULARITY_ERROR,
    advanceWindowDays: integerInRange(draft.advanceWindowDays, 0, 365)
      ? null
      : ADVANCE_ERROR,
    minNoticeMinutes: integerInRange(draft.minNoticeMinutes, 0, 10080)
      ? null
      : NOTICE_ERROR,
  };
}

export function buildAvailabilityPatch(
  draft: AvailabilityNumericDraft,
): VenueAvailabilityConfigPatch {
  const errors = validateAvailabilityDraft(draft);
  if (Object.values(errors).some((error) => error !== null)) {
    throw new Error("availability_draft_invalid");
  }
  const turnTimes: Record<string, number> = {};
  for (const [fieldKey, engineKey] of Object.entries(
    TURN_FIELD_TO_ENGINE_KEY,
  )) {
    const raw = draft[fieldKey as AvailabilityFieldKey];
    if (raw.length > 0) turnTimes[engineKey] = Number(raw);
  }
  return {
    turnTimes,
    bufferMinutes: Number(draft.bufferMinutes),
    maxReservationsPerSlot:
      draft.maxReservationsPerSlot.length === 0
        ? null
        : Number(draft.maxReservationsPerSlot),
    slotGranularityMinutes: Number(draft.slotGranularityMinutes),
    advanceWindowDays: Number(draft.advanceWindowDays),
    minNoticeMinutes: Number(draft.minNoticeMinutes),
  };
}

export function availabilityDraftsEqual(
  left: AvailabilityNumericDraft,
  right: AvailabilityNumericDraft,
): boolean {
  return AVAILABILITY_FIELD_KEYS.every((key) => left[key] === right[key]);
}

function periodSummary(p: ServicePeriod): string {
  const days = p.days.map((d) => DAY_SHORT[d]).join(" ");
  return `${days} · ${p.start}–${p.end}`;
}

interface NumericFieldDefinition {
  key: AvailabilityFieldKey;
  label: string;
  accessibilityLabel: string;
  placeholder: string;
  testID: string;
}

const TURN_FIELDS: readonly NumericFieldDefinition[] = [
  {
    key: "turnTimes.1-2",
    label: "Party of 1–2",
    accessibilityLabel: "Turn time for party of 1 to 2, minutes",
    placeholder: "90",
    testID: "venue-avail-turn-p2",
  },
  {
    key: "turnTimes.3-4",
    label: "Party of 3–4",
    accessibilityLabel: "Turn time for party of 3 to 4, minutes",
    placeholder: "90",
    testID: "venue-avail-turn-p4",
  },
  {
    key: "turnTimes.5-6",
    label: "Party of 5–6",
    accessibilityLabel: "Turn time for party of 5 to 6, minutes",
    placeholder: "120",
    testID: "venue-avail-turn-p6",
  },
  {
    key: "turnTimes.7+",
    label: "Party of 7+",
    accessibilityLabel: "Turn time for party of 7 or more, minutes",
    placeholder: "120",
    testID: "venue-avail-turn-p8",
  },
];

const BOOKING_FIELDS: readonly NumericFieldDefinition[] = [
  {
    key: "bufferMinutes",
    label: "Buffer between seatings (min)",
    accessibilityLabel: "Buffer between seatings, minutes",
    placeholder: "0",
    testID: "venue-avail-buffer",
  },
  {
    key: "maxReservationsPerSlot",
    label: "Max reservations per slot (blank = all tables)",
    accessibilityLabel: "Maximum reservations per slot",
    placeholder: "All",
    testID: "venue-avail-maxslot",
  },
  {
    key: "slotGranularityMinutes",
    label: "Slot step (min: 5/10/15/20/30/60)",
    accessibilityLabel: "Slot step, minutes",
    placeholder: "15",
    testID: "venue-avail-granularity",
  },
  {
    key: "advanceWindowDays",
    label: "Book up to (days ahead)",
    accessibilityLabel: "Booking window, days ahead",
    placeholder: "30",
    testID: "venue-avail-advance",
  },
  {
    key: "minNoticeMinutes",
    label: "Minimum notice (min)",
    accessibilityLabel: "Minimum notice, minutes",
    placeholder: "0",
    testID: "venue-avail-minnotice",
  },
];

export interface VenueAvailabilityLeaveHandle {
  requestLeave: (onDiscard: () => void) => void;
}

export interface VenueAvailabilityModuleProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue this module is scoped to. */
  venueId?: string | null;
  testID?: string;
}

export const VenueAvailabilityModule = forwardRef<
  VenueAvailabilityLeaveHandle,
  VenueAvailabilityModuleProps
>(function VenueAvailabilityModule(
  { brandId, venueId = null, testID },
  forwardedRef,
): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  const navigation = useNavigation();
  const online = useShareNetworkState();
  const { width, fontScale } = useWindowDimensions();
  const stackNumericRows = fontScale >= 1.3 || (width > 0 && width - 64 < 280);

  const configQuery = useVenueAvailabilityConfig(brandId, venueId);
  const upsertConfig = useUpsertVenueAvailabilityConfig(brandId, venueId);
  const blackoutsQuery = useVenueBlackouts(brandId, venueId);
  const upsertBlackout = useUpsertVenueBlackout(brandId, venueId);
  const deleteBlackout = useDeleteVenueBlackout(brandId, venueId);
  const tablesQuery = useVenueTables(brandId, venueId);

  const config = configQuery.data;
  const servicePeriods = useMemo<ServicePeriod[]>(
    () => config?.servicePeriods ?? [],
    [config],
  );
  const blackouts = blackoutsQuery.data ?? [];
  const tables = tablesQuery.data ?? [];

  const [blackoutSheetOpen, setBlackoutSheetOpen] = useState<boolean>(false);
  const [editBlackout, setEditBlackout] = useState<VenueBlackout | null>(null);
  const [draft, setDraft] = useState<AvailabilityNumericDraft>(() => ({
    ...DEFAULT_NUMERIC_DRAFT,
  }));
  const [baseline, setBaseline] = useState<AvailabilityNumericDraft>(() => ({
    ...DEFAULT_NUMERIC_DRAFT,
  }));
  const [touched, setTouched] = useState<Set<AvailabilityFieldKey>>(
    () => new Set(),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "success" | "serverError" | "offline"
  >("idle");
  const [toast, setToast] = useState<{
    kind: ToastKind;
    message: string;
  } | null>(null);
  const [discardDialogVisible, setDiscardDialogVisible] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const activeFieldIndexRef = useRef<number | null>(null);
  const initiallySelectedRef = useRef<Set<AvailabilityFieldKey>>(new Set());
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const sanctionedExitRef = useRef(false);
  const draftRef = useRef(draft);

  const errors = useMemo(() => validateAvailabilityDraft(draft), [draft]);
  const isValid = useMemo(
    () => Object.values(errors).every((error) => error === null),
    [errors],
  );
  const isDirty = useMemo(
    () => !availabilityDraftsEqual(draft, baseline),
    [baseline, draft],
  );
  const dirtyRef = useRef(isDirty);

  useEffect(() => {
    draftRef.current = draft;
    dirtyRef.current = isDirty;
  }, [draft, isDirty]);

  // Server refetches may refresh a clean, unfocused form. They never replace a
  // dirty/focused draft, which is the integrity boundary this issue repairs.
  useEffect(() => {
    if (!configQuery.isSuccess) return;
    if (dirtyRef.current || activeFieldIndexRef.current !== null) return;
    const next = availabilityDraftFromConfig(configQuery.data);
    setDraft(next);
    setBaseline(next);
    setTouched(new Set());
    setSubmitted(false);
  }, [configQuery.data, configQuery.isSuccess]);

  const restoreActiveFieldFocus = useCallback((): void => {
    const index = activeFieldIndexRef.current;
    if (index !== null) inputRefs.current[index]?.focus();
  }, []);

  const requestLeave = useCallback((onDiscard: () => void): void => {
    if (!dirtyRef.current) {
      onDiscard();
      return;
    }
    pendingLeaveRef.current = onDiscard;
    setDiscardDialogVisible(true);
  }, []);

  useImperativeHandle(forwardedRef, () => ({ requestLeave }), [requestLeave]);

  useEffect(() => {
    if (!isDirty || Platform.OS !== "web") return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "Your availability edits have not been saved.";
    };
    globalThis.addEventListener?.("beforeunload", guard);
    return () => globalThis.removeEventListener?.("beforeunload", guard);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const unsubscribe = navigation.addListener(
      "beforeRemove" as never,
      (raw: unknown) => {
        if (sanctionedExitRef.current) {
          sanctionedExitRef.current = false;
          return;
        }
        const event = raw as {
          preventDefault: () => void;
          data: { action: unknown };
        };
        event.preventDefault();
        requestLeave(() => {
          sanctionedExitRef.current = true;
          navigation.dispatch(event.data.action as never);
        });
      },
    );
    return unsubscribe;
  }, [isDirty, navigation, requestLeave]);

  /* ----- timezone (issue #1586) -----
   * The clock every published trading hour is expressed in, and the clock the
   * public venue page resolves "open now" against. It is DERIVED from the
   * venue's coordinates the moment the venue is provisioned — nobody is asked —
   * but the operator is the authority the instant they touch it: choosing here
   * writes `iana_timezone_source = 'operator'` and the derivation never returns
   * to this row.
   *
   * The list only mounts when the picker is opened, so the ~400-entry
   * `Intl.supportedValuesOf("timeZone")` enumeration and its per-row offset
   * formatting stay off the module's first render.
   */
  const [tzPickerOpen, setTzPickerOpen] = useState<boolean>(false);
  const [tzQuery, setTzQuery] = useState<string>("");
  const tzSource = config?.ianaTimezoneSource ?? "default";
  const tzValue = config?.ianaTimezone ?? null;
  const tzOptions = useMemo<string[]>(
    () => (tzPickerOpen ? getAllTimezones() : []),
    [tzPickerOpen],
  );
  const tzFiltered = useMemo<string[]>(() => {
    const q = tzQuery.trim().toLowerCase();
    if (q.length === 0) return tzOptions.slice(0, 60);
    return tzOptions.filter((z) => z.toLowerCase().includes(q)).slice(0, 60);
  }, [tzOptions, tzQuery]);
  const handleChooseTimezone = useCallback(
    (zone: string): void => {
      if (!canMutate) return;
      upsertConfig.mutate({ ianaTimezone: zone });
      setTzPickerOpen(false);
      setTzQuery("");
    },
    [canMutate, upsertConfig],
  );

  /* ----- service periods (ORCH-1190 #2: READ-ONLY here) -----
   * Service periods are DERIVED from the venue's opening hours (ORCH-1186 Leg 1,
   * brand_hours = the single owner — I-PROPOSED-1186-HOURS-SINGLE-OWNER). This
   * module DISPLAYS them read-only and routes the operator to the Settings hours
   * editor to change them; it NEVER edits/adds hours inline (that would create a
   * second hours owner). The in-suite switch goes through the venueSuiteStore's
   * `selectModule` (a state change, never router.push — preserves the nav-lock).
   */
  const goToSettingsHours = useCallback((): void => {
    useVenueSuiteStore.getState().selectModule?.("settings");
  }, []);

  /* ----- numeric form ----- */
  const handleNumericChange = useCallback(
    (key: AvailabilityFieldKey, raw: string): void => {
      if (!canMutate || upsertConfig.isPending) return;
      const next = sanitizeAvailabilityDigits(raw);
      setDraft((current) => ({ ...current, [key]: next }));
      setSaveState("idle");
    },
    [canMutate, upsertConfig.isPending],
  );

  const handleNumericFocus = useCallback(
    (index: number, key: AvailabilityFieldKey): void => {
      activeFieldIndexRef.current = index;
      setAvailabilityNumericToolbarState({
        previousDisabled: index === 0,
        nextDisabled: index === AVAILABILITY_FIELD_KEYS.length - 1,
        focusPrevious: () => inputRefs.current[index - 1]?.focus(),
        focusNext: () => inputRefs.current[index + 1]?.focus(),
      });
      if (!initiallySelectedRef.current.has(key)) {
        initiallySelectedRef.current.add(key);
        requestAnimationFrame(() => {
          const valueLength = draftRef.current[key].length;
          inputRefs.current[index]?.setNativeProps({
            selection: { start: 0, end: valueLength },
          });
        });
      }
    },
    [],
  );

  const handleNumericBlur = useCallback((key: AvailabilityFieldKey): void => {
    setTouched((current) => new Set(current).add(key));
    requestAnimationFrame(() => {
      const next = inputRefs.current.findIndex((ref) => ref?.isFocused());
      if (next === -1) {
        activeFieldIndexRef.current = null;
        setAvailabilityNumericToolbarState(null);
      }
    });
  }, []);

  useEffect(() => () => setAvailabilityNumericToolbarState(null), []);

  const handleSave = useCallback((): void => {
    setSubmitted(true);
    if (!isValid || !isDirty || upsertConfig.isPending) return;
    Keyboard.dismiss();
    setAvailabilityNumericToolbarState(null);
    activeFieldIndexRef.current = null;
    if (!online) {
      const message =
        "You’re offline. Your changes are still here — reconnect and try again.";
      setSaveState("offline");
      setToast({ kind: "error", message });
      return;
    }
    const savedDraft = { ...draftRef.current };
    upsertConfig.mutate(buildAvailabilityPatch(savedDraft), {
      onSuccess: () => {
        setBaseline(savedDraft);
        setDraft(savedDraft);
        setTouched(new Set());
        setSubmitted(false);
        setSaveState("success");
        setToast({ kind: "success", message: "Availability updated." });
        HapticFeedback.success();
      },
      onError: () => {
        const message =
          "We couldn’t save availability. Your changes are still here — try again.";
        setSaveState("serverError");
        setToast({ kind: "error", message });
      },
    });
  }, [isDirty, isValid, online, upsertConfig]);

  const handleKeepEditing = useCallback((): void => {
    setDiscardDialogVisible(false);
    pendingLeaveRef.current = null;
    restoreActiveFieldFocus();
  }, [restoreActiveFieldFocus]);

  const handleDiscard = useCallback((): void => {
    const leave = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    setDiscardDialogVisible(false);
    setDraft(baseline);
    setTouched(new Set());
    setSubmitted(false);
    setSaveState("idle");
    leave?.();
  }, [baseline]);

  /* ----- blackouts ----- */
  const openAddBlackout = useCallback((): void => {
    setEditBlackout(null);
    setBlackoutSheetOpen(true);
  }, []);
  const openEditBlackout = useCallback((b: VenueBlackout): void => {
    setEditBlackout(b);
    setBlackoutSheetOpen(true);
  }, []);
  const handleSaveBlackout = useCallback(
    (input: VenueBlackoutUpsert): void => {
      upsertBlackout.mutate(input, {
        onSuccess: () => setBlackoutSheetOpen(false),
      });
    },
    [upsertBlackout],
  );
  const handleDeleteBlackout = useCallback((): void => {
    if (editBlackout === null) return;
    deleteBlackout.mutate(editBlackout.id, {
      onSuccess: () => setBlackoutSheetOpen(false),
    });
  }, [editBlackout, deleteBlackout]);

  const renderNumericField = useCallback(
    (field: NumericFieldDefinition, index: number): React.ReactElement => {
      const error = errors[field.key];
      const showError = error !== null && (submitted || touched.has(field.key));
      return (
        <View key={field.key} style={styles.numericFieldGroup}>
          <View
            style={[
              styles.turnRow,
              stackNumericRows ? styles.turnRowStacked : null,
            ]}
          >
            <Text style={styles.turnLabel}>{field.label}</Text>
            <View
              style={
                stackNumericRows ? styles.turnInputStacked : styles.turnInput
              }
            >
              <Input
                ref={(instance) => {
                  inputRefs.current[index] = instance;
                }}
                value={draft[field.key]}
                onChangeText={(value) => handleNumericChange(field.key, value)}
                onFocus={() => handleNumericFocus(index, field.key)}
                onBlur={() => handleNumericBlur(field.key)}
                onSubmitEditing={
                  Platform.OS === "web" &&
                  index < AVAILABILITY_FIELD_KEYS.length - 1
                    ? () => inputRefs.current[index + 1]?.focus()
                    : Platform.OS === "web"
                      ? handleSave
                      : undefined
                }
                blurOnSubmit={false}
                variant="number"
                placeholder={field.placeholder}
                disabled={!canMutate || upsertConfig.isPending}
                accessibilityLabel={field.accessibilityLabel}
                error={showError ? error : null}
                errorId={`${field.testID}-error`}
                renderErrorMessage={false}
                enterKeyHint={
                  index === AVAILABILITY_FIELD_KEYS.length - 1 ? "done" : "next"
                }
                testID={field.testID}
              />
            </View>
          </View>
          {showError ? (
            <Text
              accessibilityRole="alert"
              aria-live="assertive"
              nativeID={`${field.testID}-error`}
              style={styles.inlineError}
              testID={`${field.testID}-error`}
            >
              {error}
            </Text>
          ) : null}
        </View>
      );
    },
    [
      canMutate,
      draft,
      errors,
      handleNumericBlur,
      handleNumericChange,
      handleNumericFocus,
      handleSave,
      stackNumericRows,
      submitted,
      touched,
      upsertConfig.isPending,
    ],
  );

  return (
    <View style={styles.host} testID={testID ?? "venue-availability-module"}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Availability</Text>
        <Text style={styles.subtitle}>
          Set when guests can book, how long a table turns, and any closures.
        </Text>
      </View>

      {/* Timezone — issue #1586. Derived automatically; correctable here. */}
      <GlassCard variant="base" style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Timezone</Text>
          {canMutate ? (
            <Button
              label={tzPickerOpen ? "Cancel" : "Change"}
              onPress={() => {
                setTzPickerOpen(!tzPickerOpen);
                setTzQuery("");
              }}
              variant="secondary"
              size="sm"
              accessibilityLabel={
                tzPickerOpen
                  ? "Cancel changing timezone"
                  : "Change venue timezone"
              }
              testID="venue-avail-tz-toggle"
            />
          ) : null}
        </View>
        {/* NO CLAIM WHEN THERE IS NOTHING TO CLAIM. A venue whose zone could not
            be worked out from its location shows the absence plainly rather
            than showing "UTC", which is a real zone and would read as a
            deliberate setting. */}
        {tzSource === "default" || tzValue === null ? (
          <Text style={styles.emptyLine} testID="venue-avail-tz-unset">
            Not set. We could not work out this venue’s timezone from its
            location, so your opening hours are shown without an “open now”
            answer. Pick one and guests see whether you’re open right now.
          </Text>
        ) : (
          <>
            <Text style={styles.periodName} testID="venue-avail-tz-value">
              {formatTimezoneLabel(tzValue)}
            </Text>
            <Text style={styles.sectionHint} testID="venue-avail-tz-source">
              {tzSource === "operator"
                ? "You set this. It stays exactly as you left it."
                : "Set automatically from this venue's location. Change it any time and yours wins."}
            </Text>
          </>
        )}
        {tzPickerOpen && canMutate ? (
          <View style={styles.tzPicker}>
            <Input
              value={tzQuery}
              onChangeText={setTzQuery}
              placeholder="Search timezones…"
              accessibilityLabel="Search timezones"
              testID="venue-avail-tz-search"
            />
            <ScrollView
              style={styles.tzList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {tzFiltered.length === 0 ? (
                <Text style={styles.emptyLine}>
                  No timezones match that search.
                </Text>
              ) : (
                tzFiltered.map((zone) => (
                  <Pressable
                    key={zone}
                    onPress={() => handleChooseTimezone(zone)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use timezone ${zone}`}
                    style={styles.tzRow}
                    testID={`venue-avail-tz-option-${zone}`}
                  >
                    <Text
                      style={
                        zone === tzValue ? styles.tzRowActive : styles.tzRowText
                      }
                    >
                      {formatTimezoneLabel(zone)}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        ) : null}
      </GlassCard>

      {/* Service periods — ORCH-1190 #2: READ-ONLY, derived from opening hours.
          No inline add/edit (that would create a second hours owner). The only
          affordance routes to the Settings hours editor. */}
      <GlassCard variant="base" style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Service periods</Text>
        </View>
        <Text
          style={styles.sectionHint}
          testID="venue-avail-periods-source-note"
        >
          Pulled from your opening hours. Guests can reserve during the times
          your venue is open.
        </Text>
        {servicePeriods.length === 0 ? (
          <Text style={styles.emptyLine}>
            No service periods yet. Set your opening hours in Settings and they
            show up here automatically.
          </Text>
        ) : (
          servicePeriods.map((p, idx) => (
            <View
              key={`${p.name}-${idx}`}
              accessibilityRole="text"
              accessibilityLabel={`Service period ${p.name}, ${periodSummary(p)}`}
              style={styles.periodRow}
              testID={`venue-avail-period-${idx}`}
            >
              <View style={styles.flex1}>
                <Text style={styles.periodName}>{p.name}</Text>
                <Text style={styles.periodMeta}>{periodSummary(p)}</Text>
              </View>
            </View>
          ))
        )}
        {canMutate ? (
          <Button
            label="Edit hours in Settings"
            onPress={goToSettingsHours}
            variant="secondary"
            size="sm"
            leadingIcon="settings"
            style={styles.periodEditBtn}
            accessibilityLabel="Edit opening hours in Settings"
            testID="venue-avail-edit-hours-in-settings"
          />
        ) : null}
      </GlassCard>

      {configQuery.isLoading ? (
        <View
          accessibilityLabel="Loading booking settings"
          accessibilityLiveRegion="polite"
          style={styles.numericLoadingRegion}
          testID="venue-avail-numeric-loading"
        >
          {[0, 1].map((card) => (
            <GlassCard key={card} variant="base" contentStyle={styles.section}>
              <Skeleton width={150} height={16} />
              {[0, 1, 2, 3].map((row) => (
                <View key={row} style={styles.turnRow} accessible={false}>
                  <Skeleton width="55%" height={16} />
                  <Skeleton width={96} height={48} />
                </View>
              ))}
            </GlassCard>
          ))}
        </View>
      ) : configQuery.isError ? (
        <GlassCard variant="base" contentStyle={styles.section}>
          <Text style={styles.loadErrorTitle}>
            Couldn’t load booking settings
          </Text>
          <Text style={styles.sectionHint}>
            Give it another try. Nothing has been changed.
          </Text>
          <Button
            label="Try again"
            onPress={() => void configQuery.refetch()}
            variant="secondary"
            size="md"
            testID="venue-avail-config-retry"
          />
        </GlassCard>
      ) : (
        <>
          {/* Turn times */}
          <GlassCard variant="base" contentStyle={styles.section}>
            <Text style={styles.sectionTitle}>Turn time by party size</Text>
            <Text style={styles.sectionHint}>
              How long a seating lasts, in minutes. Leave blank to skip a
              bucket.
            </Text>
            {TURN_FIELDS.map((field, index) =>
              renderNumericField(field, index),
            )}
          </GlassCard>

          {/* Booking controls */}
          <GlassCard variant="base" contentStyle={styles.section}>
            <Text style={styles.sectionTitle}>Booking controls</Text>
            {BOOKING_FIELDS.map((field, index) =>
              renderNumericField(field, TURN_FIELDS.length + index),
            )}
            {canMutate ? (
              <View style={styles.saveBlock}>
                {!isValid && (submitted || touched.size > 0) ? (
                  <Text
                    accessibilityRole="alert"
                    style={styles.formError}
                    testID="venue-avail-form-invalid"
                  >
                    Fix the highlighted fields before saving.
                  </Text>
                ) : null}
                {saveState === "serverError" ? (
                  <Text
                    style={styles.formError}
                    testID="venue-avail-save-error"
                  >
                    We couldn’t save availability. Your changes are still here —
                    try again.
                  </Text>
                ) : null}
                {saveState === "offline" ? (
                  <Text
                    style={styles.formError}
                    testID="venue-avail-save-offline"
                  >
                    You’re offline. Your changes are still here — reconnect and
                    try again.
                  </Text>
                ) : null}
                <Button
                  label={
                    upsertConfig.isPending
                      ? "Saving…"
                      : saveState === "serverError" || saveState === "offline"
                        ? "Try again"
                        : "Save changes"
                  }
                  onPress={handleSave}
                  variant="primary"
                  size="lg"
                  shape="pill"
                  accentColor={accent.warm}
                  loading={upsertConfig.isPending}
                  disabled={!isDirty || !isValid || upsertConfig.isPending}
                  fullWidth
                  testID="venue-avail-save"
                />
              </View>
            ) : null}
          </GlassCard>
        </>
      )}

      {/* Blackouts */}
      <GlassCard variant="base" style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Blackout dates</Text>
          {canMutate ? (
            <Button
              label="Add"
              onPress={openAddBlackout}
              variant="secondary"
              size="sm"
              leadingIcon="plus"
              testID="venue-avail-add-blackout"
            />
          ) : null}
        </View>
        {blackouts.length === 0 ? (
          <Text style={styles.emptyLine}>
            No blackouts. Add holidays or closures to block bookings on those
            dates.
          </Text>
        ) : (
          blackouts.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => (canMutate ? openEditBlackout(b) : undefined)}
              disabled={!canMutate}
              accessibilityRole="button"
              accessibilityLabel={`Edit blackout from ${b.dateStart}`}
              style={styles.periodRow}
              testID={`venue-avail-blackout-${b.id}`}
            >
              <View style={styles.flex1}>
                <Text style={styles.periodName}>
                  {b.dateStart === b.dateEnd
                    ? b.dateStart
                    : `${b.dateStart} → ${b.dateEnd}`}
                </Text>
                <Text style={styles.periodMeta}>
                  {b.appliesTo === "all"
                    ? "Whole venue"
                    : b.appliesTo === "zone"
                      ? `Zone: ${b.zone ?? "—"}`
                      : "One table"}
                  {b.reason != null ? ` · ${b.reason}` : ""}
                </Text>
              </View>
              {canMutate ? (
                <ChevronRight size={18} color={textTokens.tertiary} />
              ) : null}
            </Pressable>
          ))
        )}
      </GlassCard>

      {!canMutate ? (
        <Text style={styles.readOnlyNote}>
          You can view availability. Ask a manager or owner to make changes.
        </Text>
      ) : null}

      <VenueBlackoutSheet
        visible={blackoutSheetOpen}
        onClose={() => setBlackoutSheetOpen(false)}
        blackout={editBlackout}
        tables={tables}
        onSave={handleSaveBlackout}
        onDelete={editBlackout !== null ? handleDeleteBlackout : undefined}
        saving={upsertBlackout.isPending}
      />
      <ConfirmDialog
        visible={discardDialogVisible}
        onClose={handleKeepEditing}
        onConfirm={handleDiscard}
        title="Discard availability changes?"
        description="Your edits won’t be saved if you leave now."
        variant="simple"
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        destructive
        initialFocus="cancel"
        restoreFocus={restoreActiveFieldFocus}
        cancelTestID="venue-avail-keep-editing"
        confirmTestID="venue-avail-discard"
        testID="venue-avail-discard-dialog"
      />
      <Toast
        visible={toast !== null}
        kind={toast?.kind ?? "success"}
        message={toast?.message ?? ""}
        onDismiss={() => setToast(null)}
        testID="venue-avail-toast"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    alignSelf: "flex-start",
    width: "100%",
    maxWidth: suiteFormMaxWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    gap: spacing.xxs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  section: {
    gap: spacing.sm,
  },
  numericLoadingRegion: {
    gap: spacing.md,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  sectionHint: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  emptyLine: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
    gap: spacing.xxs,
  },
  periodName: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  periodMeta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  periodEditBtn: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  turnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: spacing.md,
  },
  turnRowStacked: {
    alignItems: "stretch",
    flexDirection: "column",
    rowGap: spacing.xs,
  },
  numericFieldGroup: {
    gap: spacing.xs,
  },
  turnLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
  },
  turnInput: {
    width: 96,
  },
  turnInputStacked: {
    width: "100%",
  },
  inlineError: {
    ...typography.bodySm,
    color: semantic.error,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  saveBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  formError: {
    ...typography.bodySm,
    color: semantic.error,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  loadErrorTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  tzPicker: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  tzList: {
    maxHeight: 220,
  },
  tzRow: {
    paddingVertical: spacing.sm,
  },
  tzRowText: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  tzRowActive: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  readOnlyNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
  },
});

export default VenueAvailabilityModule;
