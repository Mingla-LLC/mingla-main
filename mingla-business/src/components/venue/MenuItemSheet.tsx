/**
 * ORCH-1186-C — add/edit MENU ITEM sheet.
 *
 * Mirrors VenueTableSheet + the VenueSettingsModule currency-aware price input.
 * Name (required), description, price (optional, currency-aware), availability
 * toggle. Price uses majorFromMinor to hydrate and the exact menu-draft parser
 * to commit, so it is zero-decimal-currency safe; a BLANK price commits NULL
 * ("price on request").
 * The currency is the brand default_currency (NO per-item currency picker, never
 * GBP-defaulted).
 *
 * SET-A, FOREVER (SPEC #1788 P-61): this is an AUTHORING form. Even though the
 * venue menu becomes an ordering surface under #1767, an authoring form never
 * becomes a buying form — no basket, no order control, no payment control here,
 * ever. Enforced by orch-1186c-menu-display-only.mjs SET-A.
 *
 * Issue #1789 (SPEC #1788 P-11, P-12) adds the depth an orderable dish needs:
 * a kitchen-note allowance, a prep station (the Phase-5 kiosk routing seam),
 * an opt-in food cost that is NEVER public, and the options groups. Options are
 * edited in a PANEL rendered inside this sheet — never a second Sheet stacked
 * over it (the shipped sub-sheet rule).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  androidOpaque,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import {
  formatCurrency,
  majorFromMinor,
  normalizeCurrency,
} from "../../utils/currency";
import type { MenuItem } from "../../services/menusService";
import {
  menuMoneyFractionDigits,
  parseMenuMoneyDraft,
  type MenuMoneyDraftResult,
} from "./menuMoneyDraft";
import { MenuTextCounter } from "./MenuTextCounter";
import {
  menuTextFieldIds,
  validateMenuText,
  type MenuTextField as MenuTextFieldKind,
  type MenuTextSaveFailure,
} from "./menuTextValidation";

export interface MenuItemSheetSaveInput {
  name: string;
  description: string | null;
  /** Minor units (cents/kobo); null = "price on request". */
  priceCents: number | null;
  isAvailable: boolean;
  // ---- Issue #1789 (SPEC #1788 P-12) — menu depth.
  /** Whether a guest may attach a kitchen note to this line. */
  allowsNotes: boolean;
  /** Phase-5 kiosk routing seam. Nullable, never required. */
  prepStation: "kitchen" | "bar" | "other" | null;
  /** Opt-in food cost, minor units. NEVER exposed on the public menu. */
  costCents: number | null;
}

export interface MenuItemSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  item: MenuItem | null;
  /** Brand default currency (3-letter ISO) — drives the price input + math. */
  currency: string;
  /**
   * #962 VM2 — whether the brand has an ESTABLISHED currency. False for a
   * pre-bank brand (brands.default_currency = NULL); the `currency` prop is a
   * normalized crash-guard value ("GBP") upstream, so this explicit signal is
   * what suppresses the currency code in the field label + a11y so a pre-bank
   * brand never SEES a fabricated £. The stored value + math are untouched.
   */
  brandHasCurrency: boolean;
  onSave: (input: MenuItemSheetSaveInput) => void;
  saving: boolean;
  /** Typed save failure owned by the parent mutation integration. */
  saveFailure?: MenuTextSaveFailure | null;
  /** Clear a stale parent-owned failure on correction, retry, or dismissal. */
  onClearSaveFailure?: () => void;
  /**
   * The nested options editor HOLDS this sheet.
   *
   * #3563 set it while an options transaction was in flight. #3572 widened what
   * the parent composes into it: it is ALSO true while the options editor holds
   * a draft that has not been written yet. Both halves arrive as one signal on
   * purpose — the shared Sheet has exactly one dismissal gate, and on native a
   * committed drag-to-close calls `onClose` and leaves the panel at its drag
   * offset, so a guard that merely swallows `onClose` strands the panel
   * mid-screen. Disabling the pan gesture is the only mechanism that cannot.
   */
  optionsSaving?: boolean;
  /**
   * #3572 — true for the UNSAVED-DRAFT half of the lock above, so this sheet can
   * say WHY it is locked. A disabled control that never explains itself is the
   * same silent failure in a new costume (Constitution #3).
   */
  optionsDirty?: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  canDelete?: boolean;
  /**
   * Issue #1789 — the options-group builder, rendered INSIDE this sheet's body
   * by the parent module (which owns the modifier hooks). Absent for an unsaved
   * item: a group cannot reference an item id that does not exist yet.
   */
  optionsSection?: React.ReactNode;
  testID?: string;
}

/**
 * Issue #3572 — said out loud, beside the control it blocks.
 *
 * Saving or dismissing the item used to unmount the options editor and destroy
 * whatever was typed into it, with no warning and no trace: reopening the group
 * showed "0 options". The item now waits, and this is the sentence that says so
 * — what is held, how to release it, and that nothing has been lost. A disabled
 * button with no explanation would be the same silent failure in a new costume
 * (Constitution #3).
 *
 * REWORK (P2-2). The hold reaches this sheet as the single `optionsSaving`
 * signal, and `optionsSaving` also carries `disabled=` on the item's own eight
 * fields, so while an options draft is unsaved those fields are read-only too.
 * Separating the two halves would mean writing the item's fields against a
 * narrower prop, which deletes the `disabled={optionsSaving}` literal that the
 * merged #3563 gate pins — so the freeze STAYS and the sentence names it. A
 * control that goes inert without saying why is the same Constitution #3
 * failure whichever direction it points.
 */
export const MENU_ITEM_OPTIONS_HOLD_NOTE =
  "Save or cancel the options group first. Until then the item's own fields" +
  " are read-only and it can't be saved, deleted or closed — nothing you" +
  " typed is lost.";

const itemNameIds = menuTextFieldIds("menu-item-name");
const itemDescriptionIds = menuTextFieldIds("menu-item-description");

const menuTextAccessibilityHint = (used: number, limit: number): string =>
  `${used} of ${limit} characters will be saved.`;

const fieldFailureMessage = (
  failure: MenuTextSaveFailure | null,
  field: MenuTextFieldKind,
): string | null =>
  failure?.kind === "field" && failure.field === field ? failure.message : null;

const formFailureMessage = (
  failure: MenuTextSaveFailure | null,
): string | null => {
  if (failure?.kind === "field") return failure.formMessage;
  return failure?.message ?? null;
};

export function MenuItemSheet({
  visible,
  onClose,
  item,
  currency,
  brandHasCurrency,
  onSave,
  saving,
  saveFailure = null,
  onClearSaveFailure,
  optionsSaving = false,
  optionsDirty = false,
  onDelete,
  deleting = false,
  canDelete = false,
  optionsSection,
  testID,
}: MenuItemSheetProps): React.ReactElement {
  const isEdit = item !== null;
  const code = normalizeCurrency(currency);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [priceDraft, setPriceDraft] = useState<string>("");
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [allowsNotes, setAllowsNotes] = useState<boolean>(true);
  const [prepStation, setPrepStation] = useState<
    "kitchen" | "bar" | "other" | null
  >(null);
  const [costDraft, setCostDraft] = useState<string>("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);
  const [leaveOpen, setLeaveOpen] = useState<boolean>(false);
  const [nameBlurred, setNameBlurred] = useState<boolean>(false);
  const [nameHadNonBlankValue, setNameHadNonBlankValue] =
    useState<boolean>(false);
  const clearSaveFailureRef = useRef(onClearSaveFailure);

  useEffect(() => {
    clearSaveFailureRef.current = onClearSaveFailure;
  }, [onClearSaveFailure]);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      setLeaveOpen(false);
      setNameBlurred(false);
      setNameHadNonBlankValue(false);
      clearSaveFailureRef.current?.();
      return;
    }
    const nextName = item?.name ?? "";
    setName(nextName);
    setDescription(item?.description ?? "");
    setNameBlurred(false);
    setNameHadNonBlankValue(
      validateMenuText("itemName", nextName).canonicalValue !== "",
    );
    clearSaveFailureRef.current?.();
    // Hydrate the major-unit draft from stored minor cents (currency-aware).
    setPriceDraft(
      item?.priceCents != null && item.priceCents >= 0
        ? String(majorFromMinor(item.priceCents, code))
        : "",
    );
    setIsAvailable(item?.isAvailable ?? true);
    setAllowsNotes(item?.allowsNotes ?? true);
    setPrepStation(item?.prepStation ?? null);
    setCostDraft(
      item?.costCents != null && item.costCents >= 0
        ? String(majorFromMinor(item.costCents, code))
        : "",
    );
  }, [visible, item, code]);

  const priceResult = useMemo<MenuMoneyDraftResult>(
    () => parseMenuMoneyDraft(priceDraft, code),
    [priceDraft, code],
  );
  const costResult = useMemo<MenuMoneyDraftResult>(
    () => parseMenuMoneyDraft(costDraft, code),
    [costDraft, code],
  );
  const fractionDigits = menuMoneyFractionDigits(code);
  const priceError = menuMoneyDraftError(
    priceResult,
    code,
    brandHasCurrency,
    fractionDigits,
  );
  const costError = menuMoneyDraftError(
    costResult,
    code,
    brandHasCurrency,
    fractionDigits,
  );
  const moneyPlaceholder = fractionDigits === 0 ? "0" : "0.00";
  const nameValidation = useMemo(
    () => validateMenuText("itemName", name),
    [name],
  );
  const descriptionValidation = useMemo(
    () => validateMenuText("itemDescription", description),
    [description],
  );
  const visibleNameLocalError =
    nameValidation.error?.kind === "too-long" ||
    (nameValidation.error?.kind === "required" &&
      (nameBlurred || nameHadNonBlankValue))
      ? nameValidation.error.message
      : null;
  const nameFieldFailure = fieldFailureMessage(saveFailure, "itemName");
  const descriptionFieldFailure = fieldFailureMessage(
    saveFailure,
    "itemDescription",
  );
  const nameError = visibleNameLocalError ?? nameFieldFailure;
  const descriptionError =
    descriptionValidation.error?.message ?? descriptionFieldFailure;
  const saveFailureMessage = formFailureMessage(saveFailure);
  const itemFieldFailureActive =
    saveFailure?.kind === "field" &&
    (saveFailure.field === "itemName" ||
      saveFailure.field === "itemDescription");

  const showDelete = isEdit && canDelete && onDelete !== undefined;
  const canSave =
    nameValidation.isValid &&
    descriptionValidation.isValid &&
    !itemFieldFailureActive &&
    !saving &&
    !optionsSaving &&
    priceResult.kind !== "invalid" &&
    costResult.kind !== "invalid" &&
    // #3572 — appended, never folded into the line above: the exact text of the
    // #3563 terms is a merged source-string contract.
    !optionsDirty;

  // #3655 P2 — dish-field dirty (price/name/etc.) must prompt on dismiss.
  // Options-group dirty stays on the #3572 hold path (dismissDisabled).
  const itemDirty = useMemo((): boolean => {
    if (!visible) return false;
    const baseName = item?.name ?? "";
    const baseDescription = item?.description ?? "";
    const basePrice =
      item?.priceCents != null && item.priceCents >= 0
        ? String(majorFromMinor(item.priceCents, code))
        : "";
    const baseCost =
      item?.costCents != null && item.costCents >= 0
        ? String(majorFromMinor(item.costCents, code))
        : "";
    const baseAvailable = item?.isAvailable ?? true;
    const baseAllowsNotes = item?.allowsNotes ?? true;
    const basePrep = item?.prepStation ?? null;
    return (
      name !== baseName ||
      description !== baseDescription ||
      priceDraft !== basePrice ||
      costDraft !== baseCost ||
      isAvailable !== baseAvailable ||
      allowsNotes !== baseAllowsNotes ||
      prepStation !== basePrep
    );
  }, [
    visible,
    item,
    code,
    name,
    description,
    priceDraft,
    costDraft,
    isAvailable,
    allowsNotes,
    prepStation,
  ]);

  const snap = useMemo<number>(() => 0.9, []);

  const handleNameChange = useCallback(
    (next: string): void => {
      if (validateMenuText("itemName", next).canonicalValue !== "") {
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

  const handleSave = useCallback((): void => {
    if (
      !nameValidation.isValid ||
      !descriptionValidation.isValid ||
      itemFieldFailureActive ||
      priceResult.kind === "invalid" ||
      costResult.kind === "invalid" ||
      !canSave
    ) {
      return;
    }
    onClearSaveFailure?.();
    onSave({
      name: nameValidation.canonicalValue,
      description: descriptionValidation.submitValue,
      priceCents: priceResult.cents,
      isAvailable,
      allowsNotes,
      prepStation,
      costCents: costResult.cents,
    });
  }, [
    canSave,
    nameValidation,
    descriptionValidation,
    itemFieldFailureActive,
    priceResult,
    isAvailable,
    allowsNotes,
    prepStation,
    costResult,
    onClearSaveFailure,
    onSave,
  ]);

  const handleConfirmDelete = useCallback((): void => {
    if (item === null || onDelete === undefined) return;
    onDelete(item.id);
  }, [item, onDelete]);

  const handleClose = useCallback((): void => {
    /*
     * #3572 — an unsaved options draft holds this sheet shut, exactly the way an
     * in-flight options save does. Every dismissal route funnels through here —
     * scrim tap, hardware back, web Escape, and a programmatic close — and each
     * one used to unmount the options subtree and take the draft with it. The
     * reason is on screen beside Save, so nothing is refused in silence.
     */
    if (optionsDirty) return;
    if (optionsSaving) return;
    // #3655 P2 — dirty dish fields get a leave prompt (not a silent discard).
    if (itemDirty) {
      setLeaveOpen(true);
      return;
    }
    onClearSaveFailure?.();
    onClose();
  }, [
    itemDirty,
    onClearSaveFailure,
    onClose,
    optionsDirty,
    optionsSaving,
  ]);

  const handleLeaveDiscard = useCallback((): void => {
    setLeaveOpen(false);
    onClearSaveFailure?.();
    onClose();
  }, [onClearSaveFailure, onClose]);

  const handleLeaveSave = useCallback(async (): Promise<void> => {
    if (!canSave) {
      throw new Error("invalid");
    }
    setLeaveOpen(false);
    handleSave();
  }, [canSave, handleSave]);

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint={snap}
      dismissDisabled={optionsSaving}
      dismissGuard={() => itemDirty && !optionsSaving}
      onRequestClose={handleClose}
      testID={testID ?? "menu-item-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>{isEdit ? "Edit item" : "Add item"}</Text>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupLabel}>Item</Text>
          <MenuTextField
            label="Item name"
            labelId={itemNameIds.labelId}
            error={nameError}
            errorId={itemNameIds.errorId}
            counter={
              <MenuTextCounter
                used={nameValidation.storageCount}
                limit={nameValidation.limit}
                invalid={
                  nameValidation.error?.kind === "too-long" ||
                  nameFieldFailure !== null
                }
                nativeID={itemNameIds.counterId}
                testID="menu-item-name-counter"
              />
            }
          >
            <Input
              value={name}
              onChangeText={handleNameChange}
              onBlur={() => setNameBlurred(true)}
              placeholder="e.g. Margherita"
              accessibilityLabel="Item name"
              accessibilityHint={menuTextAccessibilityHint(
                nameValidation.storageCount,
                nameValidation.limit,
              )}
              aria-labelledby={itemNameIds.labelId}
              aria-describedby={itemNameIds.counterId}
              error={nameError}
              errorId={`${itemNameIds.counterId} ${itemNameIds.errorId}`}
              renderErrorMessage={false}
              disabled={optionsSaving}
              testID="menu-item-name"
            />
          </MenuTextField>
          <MenuTextField
            label="Description (optional)"
            labelId={itemDescriptionIds.labelId}
            error={descriptionError}
            errorId={itemDescriptionIds.errorId}
            counter={
              <MenuTextCounter
                used={descriptionValidation.storageCount}
                limit={descriptionValidation.limit}
                invalid={
                  descriptionValidation.error?.kind === "too-long" ||
                  descriptionFieldFailure !== null
                }
                nativeID={itemDescriptionIds.counterId}
                testID="menu-item-description-counter"
              />
            }
          >
            <Input
              value={description}
              onChangeText={handleDescriptionChange}
              placeholder="What's in it"
              accessibilityLabel="Item description"
              accessibilityHint={menuTextAccessibilityHint(
                descriptionValidation.storageCount,
                descriptionValidation.limit,
              )}
              aria-labelledby={itemDescriptionIds.labelId}
              aria-describedby={itemDescriptionIds.counterId}
              error={descriptionError}
              errorId={`${itemDescriptionIds.counterId} ${itemDescriptionIds.errorId}`}
              renderErrorMessage={false}
              disabled={optionsSaving}
              testID="menu-item-desc"
            />
          </MenuTextField>

          <Text style={styles.groupLabel}>Price</Text>
          <Field label={`Price${brandHasCurrency ? ` (${code})` : ""}`}>
            <Input
              value={priceDraft}
              onChangeText={(next) => {
                onClearSaveFailure?.();
                setPriceDraft(next);
              }}
              variant="number"
              placeholder={moneyPlaceholder}
              accessibilityLabel={`Item price${brandHasCurrency ? ` in ${code}` : ""}`}
              error={priceError}
              errorId="menu-item-price-error"
              renderErrorMessage={false}
              disabled={optionsSaving}
              testID="menu-item-price"
            />
            {priceError !== null ? (
              <Text
                accessibilityRole="alert"
                aria-live="assertive"
                nativeID="menu-item-price-error"
                style={styles.moneyError}
                testID="menu-item-price-error"
              >
                {priceError}
              </Text>
            ) : null}
          </Field>
          <Text style={styles.helper}>
            Leave blank to show “Price on request”.
          </Text>

          {/*
            Issue #1789 (P-12) — the venue's own food cost. Opt-in, never
            public, and the ONLY honest input to a margin figure: until a venue
            fills it, menu quadrants are labelled BY PRICE and never called
            profit (SPEC #1788 P-58). Nothing on this screen computes a margin.
          */}
          <Field
            label={`What it costs you (optional${brandHasCurrency ? `, ${code}` : ""})`}
          >
            <Input
              value={costDraft}
              onChangeText={(next) => {
                onClearSaveFailure?.();
                setCostDraft(next);
              }}
              variant="number"
              placeholder={moneyPlaceholder}
              accessibilityLabel={`What this item costs you${brandHasCurrency ? ` in ${code}` : ""}`}
              error={costError}
              errorId="menu-item-cost-error"
              renderErrorMessage={false}
              disabled={optionsSaving}
              testID="menu-item-cost"
            />
            {costError !== null ? (
              <Text
                accessibilityRole="alert"
                aria-live="assertive"
                nativeID="menu-item-cost-error"
                style={styles.moneyError}
                testID="menu-item-cost-error"
              >
                {costError}
              </Text>
            ) : null}
          </Field>
          <Text style={styles.helper}>
            Only you ever see this. Guests never do.
          </Text>

          <Text style={styles.groupLabel}>Availability</Text>
          <ToggleRow
            label="Show this item to guests"
            value={isAvailable}
            onValueChange={(next) => {
              onClearSaveFailure?.();
              setIsAvailable(next);
            }}
            disabled={optionsSaving}
            testID="menu-item-available"
          />

          <Text style={styles.groupLabel}>Kitchen</Text>
          <ToggleRow
            label="Let guests add a note (no ice, extra hot)"
            value={allowsNotes}
            onValueChange={(next) => {
              onClearSaveFailure?.();
              setAllowsNotes(next);
            }}
            disabled={optionsSaving}
            testID="menu-item-allows-notes"
          />
          <Text style={styles.helper}>
            Notes are capped so a kitchen ticket stays readable.
          </Text>
          <Field label="Where it's made (optional)">
            <View style={styles.stationRow}>
              {STATION_CHOICES.map((choice) => (
                <Button
                  key={choice.label}
                  label={choice.label}
                  onPress={() => {
                    onClearSaveFailure?.();
                    setPrepStation(
                      prepStation === choice.value ? null : choice.value,
                    );
                  }}
                  variant={
                    prepStation === choice.value ? "primary" : "secondary"
                  }
                  size="sm"
                  disabled={optionsSaving}
                  accessibilityRole="togglebutton"
                  accessibilityState={{
                    checked: prepStation === choice.value,
                  }}
                  style={styles.stationChip}
                  testID={`menu-item-station-${choice.value ?? "none"}`}
                />
              ))}
            </View>
          </Field>

          {optionsSection !== undefined ? (
            <View testID="menu-item-options-section">{optionsSection}</View>
          ) : null}

          {saveFailureMessage !== null ? (
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              aria-live="assertive"
              style={styles.saveError}
              testID="menu-item-save-error"
            >
              <Text style={styles.saveErrorText}>{saveFailureMessage}</Text>
            </View>
          ) : null}

          {optionsDirty ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              aria-live="assertive"
              style={styles.optionsHoldNote}
              testID="menu-item-options-hold-note"
            >
              {MENU_ITEM_OPTIONS_HOLD_NOTE}
            </Text>
          ) : null}

          <Button
            label={
              saveFailureMessage !== null
                ? "Try again"
                : isEdit
                  ? "Save item"
                  : "Add item"
            }
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            accessibilityLabel={
              optionsDirty
                ? `${isEdit ? "Save item" : "Add item"}. Unavailable. ${MENU_ITEM_OPTIONS_HOLD_NOTE}`
                : saveFailureMessage !== null
                  ? "Try saving item again"
                  : undefined
            }
            style={styles.saveBtn}
            testID="menu-item-save"
          />

          {showDelete ? (
            <Button
              label="Delete item"
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructive"
              size="md"
              fullWidth
              disabled={deleting || optionsSaving}
              loading={deleting}
              style={styles.deleteBtn}
              testID="menu-item-delete"
            />
          ) : null}
        </ScrollView>
      </View>

      {showDelete ? (
        <ConfirmDialog
          visible={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
          title="Delete this item?"
          description={
            `“${item?.name ?? "This item"}” will be removed from your menu and` +
            " your public page. This can't be undone."
          }
          variant="simple"
          destructive
          confirmLabel="Delete"
          cancelLabel="Keep item"
          confirmLoading={deleting}
          confirmTestID="menu-item-delete-confirm"
          cancelTestID="menu-item-delete-cancel"
          testID="menu-item-delete-dialog"
        />
      ) : null}

      {leaveOpen ? (
        <ConfirmDialog
          visible
          onClose={() => setLeaveOpen(false)}
          onConfirm={handleLeaveDiscard}
          title={
            isEdit ? "Save your item changes?" : "Save this new item?"
          }
          description={
            isEdit
              ? "You changed this dish. If you leave without saving, those changes are gone."
              : "This dish has not been saved yet. If you leave, it will be discarded."
          }
          variant="leave"
          onSave={handleLeaveSave}
          onDiscard={handleLeaveDiscard}
          saveDisabled={!canSave}
          confirmLoading={saving}
          saveTestID="menu-item-leave-save"
          discardTestID="menu-item-leave-discard"
          keepTestID="menu-item-leave-keep"
          testID="menu-item-leave-dialog"
        />
      ) : null}
    </Sheet>
  );
}

const STATION_CHOICES: readonly {
  label: string;
  value: "kitchen" | "bar" | "other";
}[] = [
  { label: "Kitchen", value: "kitchen" },
  { label: "Bar", value: "bar" },
  { label: "Somewhere else", value: "other" },
];

function menuMoneyDraftError(
  result: MenuMoneyDraftResult,
  code: string,
  brandHasCurrency: boolean,
  fractionDigits: 0 | 2,
): string | null {
  if (result.kind !== "invalid") return null;
  if (result.reason === "format") {
    return "Enter a valid amount, for example 14.90.";
  }
  if (result.reason === "precision") {
    if (fractionDigits === 0) {
      return brandHasCurrency
        ? `${code} uses whole amounts; remove the decimal places.`
        : "Use whole amounts; remove the decimal places.";
    }
    return brandHasCurrency
      ? `${code} supports at most 2 decimal places.`
      : "Use no more than 2 decimal places.";
  }
  if (!brandHasCurrency) {
    return fractionDigits === 0
      ? "Amount must be 100,000,000 or less."
      : "Amount must be 1,000,000.00 or less.";
  }
  return `Amount must be ${formatCurrency(100_000_000, code, true)} or less.`;
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

interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID: string;
  disabled?: boolean;
}

function ToggleRow({
  label,
  value,
  onValueChange,
  testID,
  disabled = false,
}: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <BrandSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        testID={testID}
      />
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
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
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
  menuTextFieldLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  menuTextCounterWrap: {
    marginLeft: "auto",
    alignItems: "flex-end",
  },
  stationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  stationChip: {
    minHeight: 44,
    justifyContent: "center",
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  fieldError: {
    ...typography.bodySm,
    color: semantic.errorText,
    fontWeight: "600",
    marginTop: spacing.xxs,
  },
  helper: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  moneyError: {
    ...typography.bodySm,
    color: semantic.errorText,
    fontWeight: "600",
    marginTop: spacing.xs,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  /*
   * #3572 — the held-item note. It is a HOLD, not a failure, so it takes the
   * readable body token rather than the error palette: nothing has gone wrong
   * and nothing has been lost. `marginTop` matches `saveBtn` so the note takes
   * the Save button's own top gap and sits directly against it.
   */
  optionsHoldNote: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.lg,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

export default MenuItemSheet;
