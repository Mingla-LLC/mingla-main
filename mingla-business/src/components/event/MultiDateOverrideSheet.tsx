/**
 * MultiDateOverrideSheet — edit one MultiDateEntry's time + per-date overrides.
 *
 * Three classes of fields:
 *   - Time fields (startTime, endTime) — always editable, never inherited
 *   - Override fields (title, description, venueName, address, onlineUrl) —
 *     two visual states:
 *       1. Inheriting (default if entry has no override) → render as a chip
 *          "Inherits: {parent value}" with a ✕ button. Tap ✕ to override.
 *       2. Overriding (entry has explicit override OR user tapped ✕) → render
 *          as a TextInput + "Use main event" link to revert to inherit.
 *
 * Saves back as `{ startTime, endTime, overrides }`. Override fields with
 * empty/whitespace-only values save as null (= inherit from parent).
 *
 * Keyboard awareness (per persistent feedback rule
 * `feedback_keyboard_never_blocks_input.md`): ScrollView wraps content with
 * dynamic paddingBottom = keyboardHeight; bottom-most fields call deferred
 * scrollToEnd inside a useEffect on keyboardHeight (matches Cycle 3 wizard
 * root pattern). Sheet snap = "full" when keyboard is up so the form stays
 * above the keyboard.
 *
 * Per Cycle 4 spec §3.6 + 2026-04-30 founder feedback rework.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + state DELETED. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  DraftEvent,
  MultiDateEntry,
  MultiDateOverrides,
} from "../../store/draftEventStore";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
// issue #1027 Thread B — the ONE shared visible-native-input for web date/time.
import { WebDateTimeInput } from "../ui/WebDateTimeInput";

// ---- Public types ---------------------------------------------------

/** Patch shape returned to parent on save. */
export interface MultiDateOverrideSavePatch {
  startTime: string;
  endTime: string;
  overrides: MultiDateOverrides;
}

interface MultiDateOverrideSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the time + overrides patch on save. */
  onSave: (patch: MultiDateOverrideSavePatch) => void;
  /** The entry being edited; null = sheet should not render. */
  entry: MultiDateEntry | null;
  /** Index of the entry in the parent multiDates array — drives sheet title. */
  entryIndex: number;
  /** Parent draft — used to surface inherited values in chips. */
  parentDraft: DraftEvent;
}

// ---- Helpers --------------------------------------------------------

const trimToNull = (s: string): string | null => {
  const t = s.trim();
  return t.length === 0 ? null : t;
};

const dateFromHhmm = (hhmm: string): Date => {
  const d = new Date();
  const parts = hhmm.split(":");
  d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
  return d;
};

const hhmmFromDate = (d: Date): string => {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

type TimePickerMode = "start" | "end" | null;

// issue #1027 Thread B — the hidden 1x1 opacity-0 pointer-events-none <input> +
// imperative browser-picker bridge is DELETED. Web renders visible native
// <input type=time> controls via the shared WebDateTimeInput (I-PROPOSED-1027-
// WEB-NATIVE-DATE-INPUT). iOS/Android keep the DateTimePicker Sheet/dialog flow.

// ---- Component ------------------------------------------------------

export const MultiDateOverrideSheet: React.FC<MultiDateOverrideSheetProps> = ({
  visible,
  onClose,
  onSave,
  entry,
  entryIndex,
  parentDraft,
}) => {
  const insets = useSafeAreaInsets();

  // Time state (always set; never inherited).
  const [startTime, setStartTime] = useState<string>("21:00");
  const [endTime, setEndTime] = useState<string>("03:00");

  // Override states — null = inheriting (chip shown), string = overriding
  // (input shown, may be empty if user tapped ✕ but hasn't typed).
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [onlineUrl, setOnlineUrl] = useState<string | null>(null);

  // Time picker
  const [pickerMode, setPickerMode] = useState<TimePickerMode>(null);
  const [tempPickerValue, setTempPickerValue] = useState<Date | null>(null);

  // issue #1027 Thread B — web hidden-input refs DELETED. The Start/End rows
  // render visible WebDateTimeInputs directly (no ref, no imperative trigger).

  // ORCH-0892-B v2: keyboard listener + deferred scroll plumbing DELETED.
  // KAS via SmartScrollView handles focused-input scroll automatically.
  // requestScrollToEnd retained as passthrough for onFocus child callbacks.
  const scrollRef = useRef<ScrollView | null>(null);

  const requestScrollToEnd = useCallback((): void => {
    requestAnimationFrame((): void => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  // Sync local state when sheet opens with an entry.
  useEffect(() => {
    if (!visible || entry === null) return;
    setStartTime(entry.startTime);
    setEndTime(entry.endTime);
    setTitle(entry.overrides.title);
    setDescription(entry.overrides.description);
    setVenueName(entry.overrides.venueName);
    setAddress(entry.overrides.address);
    setOnlineUrl(entry.overrides.onlineUrl);
  }, [visible, entry]);

  const showInPerson =
    parentDraft.format === "in_person" || parentDraft.format === "hybrid";
  const showOnline =
    parentDraft.format === "online" || parentDraft.format === "hybrid";

  // ---- Time picker handlers ----

  // issue #1027 Thread B — NATIVE-ONLY (iOS Sheet + Android dialog). Web rows
  // render visible WebDateTimeInputs that commit via their own onChange.
  const handleOpenTimePicker = useCallback(
    (mode: "start" | "end"): void => {
      // Native (iOS/Android): existing Sheet/dialog flow.
      const initial = mode === "start" ? dateFromHhmm(startTime) : dateFromHhmm(endTime);
      setTempPickerValue(initial);
      setPickerMode(mode);
    },
    [startTime, endTime],
  );

  const commitTimePickerValue = useCallback(
    (mode: TimePickerMode, d: Date): void => {
      if (mode === "start") setStartTime(hhmmFromDate(d));
      else if (mode === "end") setEndTime(hhmmFromDate(d));
    },
    [],
  );

  const handleTimePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        const mode = pickerMode;
        setPickerMode(null);
        if (event.type === "dismissed" || selected === undefined) return;
        commitTimePickerValue(mode, selected);
        return;
      }
      if (selected !== undefined) setTempPickerValue(selected);
    },
    [pickerMode, commitTimePickerValue],
  );

  const handleCloseTimePicker = useCallback((): void => {
    // iOS + Web both Done-commit; Android commits inline via per-change.
    if (
      Platform.OS !== "android" &&
      tempPickerValue !== null &&
      pickerMode !== null
    ) {
      commitTimePickerValue(pickerMode, tempPickerValue);
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [pickerMode, tempPickerValue, commitTimePickerValue]);

  // ---- Save ----

  const handleSave = useCallback((): void => {
    onSave({
      startTime,
      endTime,
      overrides: {
        title: title === null ? null : trimToNull(title),
        description: description === null ? null : trimToNull(description),
        venueName: showInPerson && venueName !== null ? trimToNull(venueName) : null,
        address: showInPerson && address !== null ? trimToNull(address) : null,
        onlineUrl: showOnline && onlineUrl !== null ? trimToNull(onlineUrl) : null,
      },
    });
  }, [
    startTime,
    endTime,
    title,
    description,
    venueName,
    address,
    onlineUrl,
    showInPerson,
    showOnline,
    onSave,
  ]);

  // ---- Render guards ----

  if (entry === null) {
    return null;
  }

  // Sheet snap — full when keyboard up; otherwise full (form is dense).
  const dynamicSnap = "full" as const;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={dynamicSnap}>
      <View style={styles.bodyWrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.sheetContent,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sheetTitle}>Edit date {entryIndex + 1}</Text>
        <Text style={styles.sheetSub}>
          Time always applies. Title, description, and location inherit from
          the main event unless you override them.
        </Text>

        {/* Time row — always editable.
            issue #1027 Thread B — web renders visible native <input type=time>
            controls; native keeps the Pressable → Sheet/dialog flow. */}
        <View style={styles.timeRow}>
          <View style={styles.timeCell}>
            <Text style={styles.fieldLabel}>Start</Text>
            {Platform.OS === "web" ? (
              <WebDateTimeInput
                type="time"
                value={startTime}
                ariaLabel="Pick start time"
                testID="override-start-web"
                onChangeValue={(v) => {
                  if (v.length === 0) return;
                  setStartTime(v);
                }}
              />
            ) : (
              <Pressable
                onPress={() => handleOpenTimePicker("start")}
                accessibilityRole="button"
                accessibilityLabel="Pick start time"
                style={styles.pickerRow}
              >
                <Text style={styles.pickerValue}>{startTime}</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.timeCell}>
            <Text style={styles.fieldLabel}>End</Text>
            {Platform.OS === "web" ? (
              <WebDateTimeInput
                type="time"
                value={endTime}
                ariaLabel="Pick end time"
                testID="override-end-web"
                onChangeValue={(v) => {
                  if (v.length === 0) return;
                  setEndTime(v);
                }}
              />
            ) : (
              <Pressable
                onPress={() => handleOpenTimePicker("end")}
                accessibilityRole="button"
                accessibilityLabel="Pick end time"
                style={styles.pickerRow}
              >
                <Text style={styles.pickerValue}>{endTime}</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Title */}
        <OverrideField
          label="Title"
          parentValue={parentDraft.name.length > 0 ? parentDraft.name : null}
          value={title}
          onOverride={() => setTitle("")}
          onRevert={() => setTitle(null)}
          onChangeText={setTitle}
          placeholder={
            parentDraft.name.length > 0
              ? `Override "${parentDraft.name}"`
              : "Custom title for this date"
          }
          accessibilityBase="title"
          onFocus={requestScrollToEnd}
        />

        {/* Description */}
        <OverrideField
          label="Description"
          parentValue={
            parentDraft.description.length > 0 ? parentDraft.description : null
          }
          value={description}
          onOverride={() => setDescription("")}
          onRevert={() => setDescription(null)}
          onChangeText={setDescription}
          placeholder="What's different about this date?"
          accessibilityBase="description"
          multiline
          onFocus={requestScrollToEnd}
        />

        {/* Venue + address (in_person + hybrid) */}
        {showInPerson ? (
          <>
            <OverrideField
              label="Venue name"
              parentValue={parentDraft.venueName}
              value={venueName}
              onOverride={() => setVenueName("")}
              onRevert={() => setVenueName(null)}
              onChangeText={setVenueName}
              placeholder="Custom venue for this date"
              accessibilityBase="venue name"
              onFocus={requestScrollToEnd}
            />
            <OverrideField
              label="Address"
              parentValue={parentDraft.address}
              value={address}
              onOverride={() => setAddress("")}
              onRevert={() => setAddress(null)}
              onChangeText={setAddress}
              placeholder="Custom address for this date"
              accessibilityBase="address"
              onFocus={requestScrollToEnd}
            />
          </>
        ) : null}

        {/* Online URL */}
        {showOnline ? (
          <OverrideField
            label="Online conferencing link"
            parentValue={parentDraft.onlineUrl}
            value={onlineUrl}
            onOverride={() => setOnlineUrl("")}
            onRevert={() => setOnlineUrl(null)}
            onChangeText={setOnlineUrl}
            placeholder="https://..."
            accessibilityBase="online URL"
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={requestScrollToEnd}
          />
        ) : null}

        {/* Action dock — sleek, matches Cycle 3 ticket-sheet pattern */}
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
                label="Save changes"
                variant="primary"
                size="md"
                onPress={handleSave}
                fullWidth
              />
            </View>
          </View>
        </GlassCard>

      </ScrollView>

      {/* Time picker dock — iOS Sheet+spinner. Web is handled via hidden
          inputs at component bottom (below); handleOpenTimePicker triggers
          them on web and returns early before reaching this dock. */}
      {pickerMode !== null && Platform.OS === "ios" ? (
        <View style={styles.pickerDockWrap}>
          <GlassCard
            variant="elevated"
            radius="xl"
            padding={spacing.md}
            style={styles.pickerDockCard}
          >
            <View style={styles.pickerDoneRow}>
              <Text style={styles.pickerDockTitle}>
                {pickerMode === "start" ? "Start time" : "End time"}
              </Text>
              <Button
                label="Done"
                variant="primary"
                size="md"
                onPress={handleCloseTimePicker}
              />
            </View>
            {tempPickerValue !== null ? (
              <DateTimePicker
                value={tempPickerValue}
                mode="time"
                display="spinner"
                onChange={handleTimePickerChange}
                is24Hour
                textColor="#FFFFFF"
                themeVariant="dark"
                style={styles.timePicker}
              />
            ) : null}
          </GlassCard>
        </View>
      ) : null}
      </View>

      {/* Android native time-picker dialog (auto-dismisses) */}
      {pickerMode !== null && Platform.OS === "android" ? (
        <DateTimePicker
          value={
            pickerMode === "start"
              ? dateFromHhmm(startTime)
              : dateFromHhmm(endTime)
          }
          mode="time"
          display="default"
          onChange={handleTimePickerChange}
          is24Hour
        />
      ) : null}

      {/* issue #1027 Thread B — web hidden HTML5 inputs DELETED; the Start/End
          rows above render visible WebDateTimeInputs on web. */}
    </Sheet>
  );
};

// ---- OverrideField sub-component ------------------------------------

interface OverrideFieldProps {
  label: string;
  /** The parent draft's value — shown in the "Inherits: ..." chip. */
  parentValue: string | null;
  /** null = inheriting (chip shown), string = overriding (input shown). */
  value: string | null;
  /** Tap ✕ on chip → flip to override mode (sets value to ""). */
  onOverride: () => void;
  /** Tap "Use main event" link → flip back to inherit (sets value to null). */
  onRevert: () => void;
  /** TextInput onChangeText. */
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityBase: string;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  onFocus?: () => void;
}

const OverrideField: React.FC<OverrideFieldProps> = ({
  label,
  parentValue,
  value,
  onOverride,
  onRevert,
  onChangeText,
  placeholder,
  accessibilityBase,
  multiline,
  autoCapitalize,
  autoCorrect,
  onFocus,
}) => {
  const isInheriting = value === null;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>

      {isInheriting ? (
        // Chip showing the inherited parent value — tap ✕ to override.
        <Pressable
          onPress={onOverride}
          accessibilityRole="button"
          accessibilityLabel={`Override ${accessibilityBase}`}
          style={styles.inheritChip}
        >
          <View style={styles.inheritChipTextCol}>
            <Text style={styles.inheritChipPrefix}>Inherits</Text>
            <Text style={styles.inheritChipValue} numberOfLines={multiline ? 2 : 1}>
              {parentValue !== null && parentValue.length > 0
                ? parentValue
                : `Main event has no ${accessibilityBase} yet`}
            </Text>
          </View>
          <View style={styles.inheritChipDismiss}>
            <Icon name="close" size={14} color={textTokens.tertiary} />
          </View>
        </Pressable>
      ) : (
        // Input + revert link.
        <>
          <View style={[styles.inputWrap, multiline && styles.textareaWrap]}>
            <TextInput
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={textTokens.quaternary}
              multiline={multiline}
              numberOfLines={multiline ? 3 : undefined}
              textAlignVertical={multiline ? "top" : "auto"}
              autoCapitalize={autoCapitalize}
              autoCorrect={autoCorrect}
              onFocus={onFocus}
              autoFocus
              style={[styles.textInput, multiline && styles.textarea]}
              accessibilityLabel={`${accessibilityBase} override`}
            />
          </View>
          <Pressable
            onPress={onRevert}
            accessibilityRole="button"
            accessibilityLabel={`Use main event ${accessibilityBase}`}
            hitSlop={6}
            style={styles.revertLink}
          >
            <Icon name="swap" size={12} color={accent.warm} />
            <Text style={styles.revertLinkLabel}>Use main event</Text>
          </Pressable>
        </>
      )}
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  bodyWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: 4,
  },
  sheetSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },

  // Time row -----------------------------------------------------------
  timeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  timeCell: {
    flex: 1,
  },
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

  // Inherit chip -------------------------------------------------------
  inheritChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  inheritChipTextCol: {
    flex: 1,
    minWidth: 0,
  },
  inheritChipPrefix: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 2,
  },
  inheritChipValue: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  inheritChipDismiss: {
    width: 28,
    height: 28,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },

  // Input + revert link ------------------------------------------------
  inputWrap: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textInput: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    padding: 0,
  },
  textareaWrap: {
    minHeight: 80,
  },
  textarea: {
    minHeight: 60,
  },
  revertLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  revertLinkLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  // Action dock --------------------------------------------------------
  sheetActionDock: {
    marginTop: spacing.sm,
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

  // Bottom-docked time picker ------------------------------------------
  // Outer wrap = positioning only (no visual). The GlassCard primitive
  // provides the L1-L4 glass surface treatment so the picker reads as
  // a glass dock matching the Mingla aesthetic (not a flat rectangle).
  pickerDockWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  pickerDockCard: {
    // GlassCard handles backgroundColor/border/blur via variant + radius.
    // No additional styling needed here; just a hook for future overrides.
  },
  pickerDoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  pickerDockTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  timePicker: {
    width: "100%",
  },
});
