/**
 * ORCH-1186-C — add/edit MENU CATEGORY sheet (a `menus` row).
 *
 * Mirrors VenueTableSheet's canonical Sheet + Field + Button pattern. Name
 * (required) + optional description + the #1789 SERVICE WINDOW.
 * Delete (manager + edit mode) lives inside the sheet behind a ConfirmDialog
 * (honest cascade copy).
 *
 * SET-A, FOREVER (SPEC #1788 P-61): this is an AUTHORING form. An authoring
 * form never becomes a buying form — no ordering / basket / quantity /
 * payment control here, ever, even though the menu itself becomes orderable
 * under #1767. Enforced by orch-1186c-menu-display-only.mjs SET-A.
 *
 * Issue #1789 (SPEC #1788 P-12): a category can carry a service window
 * (breakfast 07:00–11:00) and a day set. Both blank = always available, which
 * is exactly today's behaviour. An end BEFORE a start means the window wraps
 * past midnight — a late-night menu — and the UI says so out loud. The window
 * is evaluated in VENUE-LOCAL time SERVER-SIDE via the shipped #1403 timezone
 * ladder; this sheet never consults the device clock.
 */

import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { WebDateTimeInput } from "../ui/WebDateTimeInput";
import type { Menu } from "../../services/menusService";
import {
  DAY_LABELS,
  normalizeTimeInput,
  serviceWindowSummary,
  validateServiceWindow,
} from "./menuDepth";
import { MenuTextCounter } from "./MenuTextCounter";
import {
  MENU_TEXT_SAVE_COPY,
  menuTextFieldIds,
  validateMenuText,
  type MenuTextField as MenuTextFieldKind,
  type MenuTextSaveFailure,
} from "./menuTextValidation";

export interface MenuCategorySheetSaveInput {
  id: string;
  name: string;
  description: string | null;
  // Issue #1789 (SPEC #1788 P-12) — null/null = always available.
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  /** ISO day-of-week 1..7; null = every day. */
  serviceDays: number[] | null;
}

export interface MenuCategorySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  category: Menu | null;
  onSave: (input: MenuCategorySheetSaveInput) => void;
  saving: boolean;
  saveFailed?: boolean;
  /** Typed save failure for parent integrations; legacy boolean remains valid. */
  saveFailure?: MenuTextSaveFailure | null;
  /** Clear a parent-owned typed failure when this form starts a new attempt. */
  onClearSaveFailure?: () => void;
  /** Delete the category being edited (edit mode + manager). Omit to hide. */
  onDelete?: (id: string) => void;
  deleting?: boolean;
  canDelete?: boolean;
  testID?: string;
}

type TimePickerMode = "start" | "end" | null;

type DeferredDateTimePickerProps = React.ComponentProps<
  (typeof import("@react-native-community/datetimepicker"))["default"]
>;
type DeferredPickerGlassCardProps = React.ComponentProps<
  (typeof import("../ui/GlassCard"))["GlassCard"]
>;

/**
 * The ordinary category sheet must stay importable in the stock Business Jest
 * lane. Both native-only dependencies reach ESM/native modules at evaluation
 * time, so resolve them only after a native picker is actually opened.
 */
const DeferredDateTimePicker = (
  props: DeferredDateTimePickerProps,
): React.ReactElement => {
  const pickerModule =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@react-native-community/datetimepicker") as typeof import("@react-native-community/datetimepicker");
  const Picker = pickerModule.default;
  return <Picker {...props} />;
};

const DeferredPickerGlassCard = (
  props: DeferredPickerGlassCardProps,
): React.ReactElement => {
  const glassCardModule =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../ui/GlassCard") as typeof import("../ui/GlassCard");
  const PickerGlassCard = glassCardModule.GlassCard;
  return <PickerGlassCard {...props} />;
};

const dateFromHhmm = (hhmm: string, fallback: string): Date => {
  const canonical = normalizeTimeInput(hhmm) ?? fallback;
  const [hours = "0", minutes = "0"] = canonical.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date;
};

const hhmmFromDate = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;

const localizedTimeLabel = (hhmm: string, emptyLabel: string): string => {
  const canonical = normalizeTimeInput(hhmm);
  if (canonical === null) return emptyLabel;
  return dateFromHhmm(canonical, canonical).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const categoryNameIds = menuTextFieldIds("menu-category-name");
const categoryDescriptionIds = menuTextFieldIds("menu-category-description");

const menuTextAccessibilityHint = (
  used: number,
  limit: number,
): string => `${used} of ${limit} characters will be saved.`;

const fieldFailureMessage = (
  failure: MenuTextSaveFailure | null,
  field: MenuTextFieldKind,
): string | null =>
  failure?.kind === "field" && failure.field === field
    ? failure.message
    : null;

const formFailureMessage = (
  failure: MenuTextSaveFailure | null,
  legacySaveFailed: boolean,
): string | null => {
  if (failure?.kind === "field") return failure.formMessage;
  if (failure !== null) return failure.message;
  return legacySaveFailed ? MENU_TEXT_SAVE_COPY.category.unknown : null;
};

export function MenuCategorySheet({
  visible,
  onClose,
  category,
  onSave,
  saving,
  saveFailed = false,
  saveFailure = null,
  onClearSaveFailure,
  onDelete,
  deleting = false,
  canDelete = false,
  testID,
}: MenuCategorySheetProps): React.ReactElement {
  const isEdit = category !== null;
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [windowStart, setWindowStart] = useState<string>("");
  const [windowEnd, setWindowEnd] = useState<string>("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [pickerMode, setPickerMode] = useState<TimePickerMode>(null);
  const [tempPickerValue, setTempPickerValue] = useState<Date | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);
  const [nameBlurred, setNameBlurred] = useState<boolean>(false);
  const [nameHadNonBlankValue, setNameHadNonBlankValue] =
    useState<boolean>(false);
  const addSessionIdRef = useRef<string | null>(null);
  const clearSaveFailureRef = useRef(onClearSaveFailure);

  useEffect(() => {
    clearSaveFailureRef.current = onClearSaveFailure;
  }, [onClearSaveFailure]);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      setPickerMode(null);
      setTempPickerValue(null);
      setNameBlurred(false);
      setNameHadNonBlankValue(false);
      addSessionIdRef.current = null;
      clearSaveFailureRef.current?.();
      return;
    }
    if (category === null && addSessionIdRef.current === null) {
      addSessionIdRef.current = createMenuCategoryId();
    } else if (category !== null) {
      addSessionIdRef.current = null;
    }
    const nextName = category?.name ?? "";
    setName(nextName);
    setDescription(category?.description ?? "");
    setNameBlurred(false);
    setNameHadNonBlankValue(
      validateMenuText("categoryName", nextName).canonicalValue !== "",
    );
    clearSaveFailureRef.current?.();
    // Postgres returns `time` as "HH:MM:SS"; the field shows "HH:MM".
    setWindowStart(
      normalizeTimeInput(category?.serviceWindowStart ?? "") ?? "",
    );
    setWindowEnd(normalizeTimeInput(category?.serviceWindowEnd ?? "") ?? "");
    setDays(category?.serviceDays ?? [1, 2, 3, 4, 5, 6, 7]);
  }, [visible, category]);

  const showDelete = isEdit && canDelete && onDelete !== undefined;
  const windowDraft = useMemo(
    () => ({
      start: windowStart.trim().length > 0 ? windowStart.trim() : null,
      end: windowEnd.trim().length > 0 ? windowEnd.trim() : null,
      days: days.length === 7 ? null : days,
    }),
    [windowStart, windowEnd, days],
  );
  const windowError = useMemo(
    () => validateServiceWindow(windowDraft),
    [windowDraft],
  );
  const windowSummary = useMemo(
    () =>
      windowError === null
        ? serviceWindowSummary(windowDraft)
        : "Finish setting the service window",
    [windowDraft, windowError],
  );
  const nameValidation = useMemo(
    () => validateMenuText("categoryName", name),
    [name],
  );
  const descriptionValidation = useMemo(
    () => validateMenuText("categoryDescription", description),
    [description],
  );
  const visibleNameLocalError =
    nameValidation.error?.kind === "too-long" ||
    (nameValidation.error?.kind === "required" &&
      (nameBlurred || nameHadNonBlankValue))
      ? nameValidation.error.message
      : null;
  const nameError =
    visibleNameLocalError ?? fieldFailureMessage(saveFailure, "categoryName");
  const descriptionError =
    descriptionValidation.error?.message ??
    fieldFailureMessage(saveFailure, "categoryDescription");
  const saveFailureMessage = formFailureMessage(saveFailure, saveFailed);
  const nameCounterInvalid =
    nameValidation.error?.kind === "too-long" ||
    fieldFailureMessage(saveFailure, "categoryName") !== null;
  const descriptionCounterInvalid =
    descriptionValidation.error?.kind === "too-long" ||
    fieldFailureMessage(saveFailure, "categoryDescription") !== null;
  const categoryFieldFailureActive =
    saveFailure?.kind === "field" &&
    (saveFailure.field === "categoryName" ||
      saveFailure.field === "categoryDescription");
  const canSave =
    nameValidation.isValid &&
    descriptionValidation.isValid &&
    !categoryFieldFailureActive &&
    windowError === null &&
    !saving;
  const snap = useMemo<number>(() => 0.9, []);

  const handleNameChange = useCallback(
    (next: string): void => {
      if (validateMenuText("categoryName", next).canonicalValue !== "") {
        setNameHadNonBlankValue(true);
      }
      onClearSaveFailure?.();
      setName(next);
    },
    [onClearSaveFailure],
  );

  const handleDescriptionChange = useCallback(
    (next: string): void => {
      onClearSaveFailure?.();
      setDescription(next);
    },
    [onClearSaveFailure],
  );

  const handleClose = useCallback((): void => {
    onClearSaveFailure?.();
    onClose();
  }, [onClearSaveFailure, onClose]);

  const handleWindowStartChange = useCallback(
    (next: string): void => {
      onClearSaveFailure?.();
      setWindowStart(next);
    },
    [onClearSaveFailure],
  );

  const handleWindowEndChange = useCallback(
    (next: string): void => {
      onClearSaveFailure?.();
      setWindowEnd(next);
    },
    [onClearSaveFailure],
  );

  const toggleDay = useCallback(
    (isoDay: number): void => {
      onClearSaveFailure?.();
      setDays((current) =>
        current.includes(isoDay)
          ? current.filter((d) => d !== isoDay)
          : [...current, isoDay].sort((a, b) => a - b),
      );
    },
    [onClearSaveFailure],
  );

  const commitTimePickerValue = useCallback(
    (mode: TimePickerMode, value: Date): void => {
      onClearSaveFailure?.();
      if (mode === "start") setWindowStart(hhmmFromDate(value));
      else if (mode === "end") setWindowEnd(hhmmFromDate(value));
    },
    [onClearSaveFailure],
  );

  const openTimePicker = useCallback(
    (mode: Exclude<TimePickerMode, null>): void => {
      const current = mode === "start" ? windowStart : windowEnd;
      const fallback = mode === "start" ? "09:00" : "17:00";
      setTempPickerValue(dateFromHhmm(current, fallback));
      setPickerMode(mode);
    },
    [windowStart, windowEnd],
  );

  const handleTimePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        const mode = pickerMode;
        setPickerMode(null);
        setTempPickerValue(null);
        if (event.type === "dismissed" || selected === undefined) return;
        commitTimePickerValue(mode, selected);
        return;
      }
      if (selected !== undefined) setTempPickerValue(selected);
    },
    [pickerMode, commitTimePickerValue],
  );

  const closeTimePicker = useCallback((): void => {
    if (pickerMode !== null && tempPickerValue !== null) {
      commitTimePickerValue(pickerMode, tempPickerValue);
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [pickerMode, tempPickerValue, commitTimePickerValue]);

  const clearTimes = useCallback((): void => {
    onClearSaveFailure?.();
    setWindowStart("");
    setWindowEnd("");
    setPickerMode(null);
    setTempPickerValue(null);
  }, [onClearSaveFailure]);

  const handleSave = useCallback((): void => {
    if (
      !nameValidation.isValid ||
      !descriptionValidation.isValid ||
      categoryFieldFailureActive ||
      windowError !== null ||
      saving
    ) {
      return;
    }
    const id =
      category?.id ?? addSessionIdRef.current ?? createMenuCategoryId();
    if (category === null) addSessionIdRef.current = id;
    onClearSaveFailure?.();
    onSave({
      id,
      name: nameValidation.canonicalValue,
      description: descriptionValidation.submitValue,
      serviceWindowStart:
        windowDraft.start === null
          ? null
          : normalizeTimeInput(windowDraft.start),
      serviceWindowEnd:
        windowDraft.end === null ? null : normalizeTimeInput(windowDraft.end),
      serviceDays: windowDraft.days,
    });
  }, [
    nameValidation,
    descriptionValidation,
    categoryFieldFailureActive,
    windowError,
    saving,
    category,
    onClearSaveFailure,
    onSave,
    windowDraft,
  ]);

  const handleConfirmDelete = useCallback((): void => {
    if (category === null || onDelete === undefined) return;
    onDelete(category.id);
  }, [category, onDelete]);

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint={snap}
      testID={testID ?? "menu-category-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>
          {isEdit ? "Edit category" : "Add category"}
        </Text>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MenuTextField
            label="Category name"
            labelId={categoryNameIds.labelId}
            error={nameError}
            errorId={categoryNameIds.errorId}
            counter={
              <MenuTextCounter
                used={nameValidation.storageCount}
                limit={nameValidation.limit}
                invalid={nameCounterInvalid}
                nativeID={categoryNameIds.counterId}
                testID="menu-category-name-counter"
              />
            }
          >
            <Input
              value={name}
              onChangeText={handleNameChange}
              onBlur={() => setNameBlurred(true)}
              placeholder="e.g. Starters, Drinks"
              accessibilityLabel="Category name"
              accessibilityHint={menuTextAccessibilityHint(
                nameValidation.storageCount,
                nameValidation.limit,
              )}
              aria-labelledby={categoryNameIds.labelId}
              aria-describedby={categoryNameIds.counterId}
              error={nameError}
              errorId={`${categoryNameIds.counterId} ${categoryNameIds.errorId}`}
              renderErrorMessage={false}
              testID="menu-category-name"
            />
          </MenuTextField>
          <MenuTextField
            label="Description (optional)"
            labelId={categoryDescriptionIds.labelId}
            error={descriptionError}
            errorId={categoryDescriptionIds.errorId}
            counter={
              <MenuTextCounter
                used={descriptionValidation.storageCount}
                limit={descriptionValidation.limit}
                invalid={descriptionCounterInvalid}
                nativeID={categoryDescriptionIds.counterId}
                testID="menu-category-description-counter"
              />
            }
          >
            <Input
              value={description}
              onChangeText={handleDescriptionChange}
              placeholder="A short line guests see under the heading"
              accessibilityLabel="Category description"
              accessibilityHint={menuTextAccessibilityHint(
                descriptionValidation.storageCount,
                descriptionValidation.limit,
              )}
              aria-labelledby={categoryDescriptionIds.labelId}
              aria-describedby={categoryDescriptionIds.counterId}
              error={descriptionError}
              errorId={`${categoryDescriptionIds.counterId} ${categoryDescriptionIds.errorId}`}
              renderErrorMessage={false}
              testID="menu-category-desc"
            />
          </MenuTextField>

          {/* Issue #1789 (P-12) — service window. Blank = always available. */}
          <Text style={styles.groupLabel}>When it&apos;s served</Text>
          <View style={styles.windowRow}>
            <View style={styles.windowCol}>
              <Field label="From">
                {Platform.OS === "web" ? (
                  <WebDateTimeInput
                    type="time"
                    value={windowStart}
                    onChangeValue={handleWindowStartChange}
                    ariaLabel="Service start time"
                    hasError={windowError !== null}
                    testID="menu-category-window-start"
                  />
                ) : (
                  <Pressable
                    onPress={() => openTimePicker("start")}
                    accessibilityRole="button"
                    accessibilityLabel={`Service start time, ${localizedTimeLabel(
                      windowStart,
                      "not set",
                    )}`}
                    accessibilityHint="Opens the time picker"
                    style={({ pressed }) => [
                      styles.timeTrigger,
                      windowError !== null && styles.timeTriggerError,
                      pressed && styles.pressed,
                    ]}
                    testID="menu-category-window-start"
                  >
                    <Text
                      style={[
                        styles.timeTriggerText,
                        windowStart.length === 0 &&
                          styles.timeTriggerPlaceholder,
                      ]}
                    >
                      {localizedTimeLabel(windowStart, "Set start time")}
                    </Text>
                  </Pressable>
                )}
              </Field>
            </View>
            <View style={styles.windowCol}>
              <Field label="Until">
                {Platform.OS === "web" ? (
                  <WebDateTimeInput
                    type="time"
                    value={windowEnd}
                    onChangeValue={handleWindowEndChange}
                    ariaLabel="Service end time"
                    hasError={windowError !== null}
                    testID="menu-category-window-end"
                  />
                ) : (
                  <Pressable
                    onPress={() => openTimePicker("end")}
                    accessibilityRole="button"
                    accessibilityLabel={`Service end time, ${localizedTimeLabel(
                      windowEnd,
                      "not set",
                    )}`}
                    accessibilityHint="Opens the time picker"
                    style={({ pressed }) => [
                      styles.timeTrigger,
                      windowError !== null && styles.timeTriggerError,
                      pressed && styles.pressed,
                    ]}
                    testID="menu-category-window-end"
                  >
                    <Text
                      style={[
                        styles.timeTriggerText,
                        windowEnd.length === 0 && styles.timeTriggerPlaceholder,
                      ]}
                    >
                      {localizedTimeLabel(windowEnd, "Set end time")}
                    </Text>
                  </Pressable>
                )}
              </Field>
            </View>
          </View>
          {windowStart.length > 0 || windowEnd.length > 0 ? (
            <Button
              label="Clear times — serve all day"
              onPress={clearTimes}
              variant="secondary"
              size="sm"
              style={styles.clearTimes}
              testID="menu-category-window-clear"
            />
          ) : null}
          <View style={styles.dayRow} accessibilityLabel="Service days">
            {DAY_LABELS.map((label, index) => {
              const isoDay = index + 1;
              const on = days.includes(isoDay);
              return (
                <Button
                  key={label}
                  label={label}
                  onPress={() => toggleDay(isoDay)}
                  variant={on ? "primary" : "secondary"}
                  size="sm"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={styles.dayChip}
                  testID={`menu-category-day-${isoDay}`}
                />
              );
            })}
          </View>
          <Text
            style={styles.windowSummary}
            accessibilityLiveRegion="polite"
            testID="menu-category-window-summary"
          >
            {windowSummary}
          </Text>
          {windowError !== null ? (
            <Text
              style={styles.windowError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="menu-category-window-error"
            >
              {windowError}
            </Text>
          ) : null}

          {saveFailureMessage !== null ? (
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              aria-live="assertive"
              style={styles.saveError}
              testID="menu-category-save-error"
            >
              <Text style={styles.saveErrorText}>{saveFailureMessage}</Text>
            </View>
          ) : null}

          <Button
            label={
              saveFailureMessage !== null
                ? "Try again"
                : isEdit
                  ? "Save category"
                  : "Add category"
            }
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            accessibilityLabel={
              saveFailureMessage !== null
                ? "Try saving category again"
                : undefined
            }
            style={styles.saveBtn}
            testID="menu-category-save"
          />

          {showDelete ? (
            <Button
              label="Delete category"
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructive"
              size="md"
              fullWidth
              disabled={deleting}
              loading={deleting}
              style={styles.deleteBtn}
              testID="menu-category-delete"
            />
          ) : null}
        </ScrollView>
      </View>

      {pickerMode !== null && Platform.OS === "ios" ? (
        <View
          style={styles.pickerDockWrap}
          testID="menu-category-time-picker-dock"
        >
          <DeferredPickerGlassCard
            variant="elevated"
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
                onPress={closeTimePicker}
                testID="menu-category-time-picker-done"
              />
            </View>
            {tempPickerValue !== null ? (
              <DeferredDateTimePicker
                value={tempPickerValue}
                mode="time"
                display="spinner"
                onChange={handleTimePickerChange}
                textColor="#FFFFFF"
                themeVariant="dark"
                style={styles.timePicker}
                testID="menu-category-native-time-picker"
              />
            ) : null}
          </DeferredPickerGlassCard>
        </View>
      ) : null}

      {pickerMode !== null && Platform.OS === "android" ? (
        <DeferredDateTimePicker
          value={
            tempPickerValue ??
            dateFromHhmm(
              pickerMode === "start" ? windowStart : windowEnd,
              "09:00",
            )
          }
          mode="time"
          display="default"
          onChange={handleTimePickerChange}
          testID="menu-category-native-time-picker"
        />
      ) : null}

      {showDelete ? (
        <ConfirmDialog
          visible={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
          title="Delete this category?"
          description={
            `“${category?.name ?? "This category"}” and all its items will be` +
            " removed from your menu and your public page. This can't be undone."
          }
          variant="simple"
          destructive
          confirmLabel="Delete"
          cancelLabel="Keep category"
          confirmLoading={deleting}
          confirmTestID="menu-category-delete-confirm"
          cancelTestID="menu-category-delete-cancel"
          testID="menu-category-delete-dialog"
        />
      ) : null}
    </Sheet>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

interface MenuTextFieldProps extends FieldProps {
  labelId: string;
  counter: React.ReactNode;
  error: string | null;
  errorId: string;
}

function MenuTextField({
  label,
  labelId,
  counter,
  error,
  errorId,
  children,
}: MenuTextFieldProps): React.ReactElement {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text
          nativeID={labelId}
          style={[styles.fieldLabel, styles.menuTextFieldLabel]}
        >
          {label}
        </Text>
        <View style={styles.menuTextCounterWrap}>{counter}</View>
      </View>
      {children}
      {error !== null ? (
        <Text
          nativeID={errorId}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          aria-live="assertive"
          style={styles.fieldError}
          testID={errorId}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Field({ label, children }: FieldProps): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so the CTA
  // scrolls into view instead of overflowing past the panel's overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  field: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  fieldHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  menuTextFieldLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  menuTextCounterWrap: {
    marginLeft: "auto",
    alignItems: "flex-end",
  },
  fieldError: {
    ...typography.bodySm,
    color: semantic.errorText,
    fontWeight: "600",
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  windowRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  windowCol: {
    flex: 1,
  },
  timeTrigger: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    alignItems: "flex-start",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  timeTriggerError: {
    borderColor: semantic.error,
  },
  timeTriggerText: {
    ...typography.body,
    color: textTokens.primary,
  },
  timeTriggerPlaceholder: {
    color: textTokens.quaternary,
  },
  clearTimes: {
    alignSelf: "flex-start",
  },
  dayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dayChip: {
    minWidth: 56,
    minHeight: 44,
    justifyContent: "center",
  },
  windowSummary: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  windowError: {
    ...typography.bodySm,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
  pickerDockWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  pickerDockCard: {
    gap: spacing.sm,
  },
  pickerDoneRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerDockTitle: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  timePicker: {
    width: "100%",
  },
  saveError: {
    gap: spacing.xxs,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    borderColor: semantic.error,
    overflow: "hidden",
    backgroundColor:
      Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint,
  },
  saveErrorText: {
    ...typography.bodySm,
    color: semantic.errorText,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

function createMenuCategoryId(): string {
  const cryptoValue = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof cryptoValue?.randomUUID === "function") {
    return cryptoValue.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default MenuCategorySheet;
