/**
 * #4514 — the shared "Guest questions" attach sheet. One component, reused by
 * the event, experience, trip and RSVP edit screens, the manage-page tile and
 * Responses ("Change or remove"); the venues initiative reuses it later.
 *
 * Pick a form (or "Create a new form"), then "When guests answer" with exactly
 * three radio rows: On the page, optional / On the page, required (the
 * default) / After they purchase ("After they RSVP" on RSVP pages). Nothing
 * about journeys or steps. Save stays off until the sheet is valid and
 * something changed; Remove detaches the form. The sheet scrolls with its
 * buttons pinned, and every way out (Cancel, the scrim, Back) closes it.
 *
 * The attach RPC replaces the page's active form, and refuses a stale write
 * ("Someone else changed the questions on this page. Reload.").
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../constants/designSystem";
import { brandFormKeys } from "../../hooks/brandFormKeys";
import {
  useAttachBrandForm,
  useBrandFormsList,
  useCreateBrandForm,
  useDetachBrandForm,
} from "../../hooks/useBrandForms";
import {
  BrandFormsError,
  type AttachResult,
  type BrandFormAttachment,
  type BrandFormMode,
  type BrandFormRow,
} from "../../services/brandFormsService";
import { BRAND_FORM_NAME_MAX, BRAND_FORM_NAME_MIN } from "../../utils/brandFormDefinition";
import {
  canSaveAttach,
  defaultMode,
  formRowState,
  modeRows,
  type GuestQuestionsPageKind,
} from "../../utils/guestQuestionsModel";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { ATTACH_COPY, FORMS_COPY } from "./brandFormsCopy";
import { errorSentence, useFormsToast } from "./useFormsToast";

export interface GuestQuestionsSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string;
  eventId: string;
  kind: GuestQuestionsPageKind;
  /** The form on this page now, or null. */
  current: { attachment: BrandFormAttachment; form: BrandFormRow } | null;
  /** After a save. `existingGuests` feeds the "Ask earlier guests?" prompt (a later wave). */
  onSaved?: (info: { result: AttachResult; formId: string }) => void;
  onRemoved?: () => void;
}

const radioRow = (selected: boolean, disabled: boolean) => [
  styles.row,
  selected && styles.rowOn,
  disabled && styles.rowOff,
];

export const GuestQuestionsSheet: React.FC<GuestQuestionsSheetProps> = ({
  visible,
  onClose,
  brandId,
  eventId,
  kind,
  current,
  onSaved,
  onRemoved,
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const forms = useBrandFormsList(visible ? brandId : null);
  const attach = useAttachBrandForm();
  const detach = useDetachBrandForm();
  const create = useCreateBrandForm();
  const { show, toast } = useFormsToast();

  const currentFormId = current?.form.id ?? null;
  const [formId, setFormId] = useState<string | null>(currentFormId);
  const [mode, setMode] = useState<BrandFormMode>(current?.attachment.mode ?? defaultMode(kind));
  const [creating, setCreating] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");

  // Start from what the page has every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setFormId(current?.form.id ?? null);
    setMode(current?.attachment.mode ?? defaultMode(kind));
    setCreating(false);
    setNewName("");
  }, [visible, current, kind]);

  const rows = useMemo(() => modeRows(kind), [kind]);
  const items = useMemo(() => forms.data ?? [], [forms.data]);
  const busy = attach.isPending || detach.isPending || create.isPending;
  const canSave = canSaveAttach(
    kind,
    { formId, mode },
    current !== null ? { formId: current.form.id, mode: current.attachment.mode } : null,
    busy,
  );
  const trimmed = newName.trim();
  const nameValid = trimmed.length >= BRAND_FORM_NAME_MIN && trimmed.length <= BRAND_FORM_NAME_MAX;
  const expectedId = current?.attachment.id ?? null;

  const handleFailure = useCallback(
    (error: unknown, fallback: string): void => {
      if (error instanceof BrandFormsError && error.code === "attachment_conflict") {
        void queryClient.invalidateQueries({ queryKey: brandFormKeys.eventAttachment(eventId) });
      }
      show("error", errorSentence(error, fallback));
    },
    [queryClient, eventId, show],
  );

  const handleSave = useCallback((): void => {
    if (formId === null || !canSave) return;
    attach.mutate(
      { formId, eventId, mode, expectedAttachmentId: expectedId },
      {
        onSuccess: (result) => {
          show("success", ATTACH_COPY.savedToast);
          onSaved?.({ result, formId });
          onClose();
        },
        onError: (error) => handleFailure(error, "Couldn't save the guest questions. Try again."),
      },
    );
  }, [formId, canSave, attach, eventId, mode, expectedId, show, onSaved, onClose, handleFailure]);

  const handleRemove = useCallback((): void => {
    if (current === null || busy) return;
    detach.mutate(current.attachment.id, {
      onSuccess: () => {
        show("success", ATTACH_COPY.removedToast);
        onRemoved?.();
        onClose();
      },
      onError: (error) => handleFailure(error, "Couldn't remove the form from this page. Try again."),
    });
  }, [current, busy, detach, show, onRemoved, onClose, handleFailure]);

  // A form made here is attached to this page as a draft and opened in the
  // builder; it starts asking only once it is published.
  const handleCreate = useCallback((): void => {
    if (!nameValid || busy) return;
    create.mutate(
      { brandId, name: trimmed },
      {
        onSuccess: ({ formId: createdId }) => {
          attach.mutate(
            { formId: createdId, eventId, mode, expectedAttachmentId: expectedId },
            {
              onSuccess: () => {
                onClose();
                router.push(`/(tabs)/marketing/forms/${createdId}` as never);
              },
              onError: (error) =>
                handleFailure(
                  error,
                  "We created the form but couldn't add it to this page. Find it in Promote › Forms.",
                ),
            },
          );
        },
        onError: (error) => handleFailure(error, "Couldn't create the form. Try again."),
      },
    );
  }, [nameValid, busy, create, brandId, trimmed, attach, eventId, mode, expectedId, onClose, router, handleFailure]);

  const footer = creating ? (
    <View style={styles.footer}>
      <View style={styles.footerCell}>
        <Button label="Back" variant="secondary" size="md" fullWidth disabled={busy} onPress={() => setCreating(false)} />
      </View>
      <View style={styles.footerCell}>
        <Button
          label={create.isPending || attach.isPending ? FORMS_COPY.creating : "Create and open"}
          variant="primary"
          size="md"
          fullWidth
          loading={create.isPending || attach.isPending}
          disabled={!nameValid || busy}
          onPress={handleCreate}
          testID="guest-questions-create-confirm"
        />
      </View>
    </View>
  ) : (
    <View style={styles.footerStack}>
      {formId === null ? <Text style={styles.why}>{ATTACH_COPY.pickFirst}</Text> : null}
      <View style={styles.footer}>
        <View style={styles.footerCell}>
          {current !== null ? (
            <Button
              label={detach.isPending ? ATTACH_COPY.removing : ATTACH_COPY.remove}
              variant="destructiveOutline"
              size="md"
              fullWidth
              loading={detach.isPending}
              disabled={busy}
              onPress={handleRemove}
              testID="guest-questions-remove"
            />
          ) : (
            <Button label={ATTACH_COPY.cancel} variant="secondary" size="md" fullWidth onPress={onClose} testID="guest-questions-cancel" />
          )}
        </View>
        <View style={styles.footerCell}>
          <Button
            label={attach.isPending ? ATTACH_COPY.saving : ATTACH_COPY.save}
            variant="primary"
            size="md"
            fullWidth
            loading={attach.isPending}
            disabled={!canSave}
            onPress={handleSave}
            testID="guest-questions-save"
          />
        </View>
      </View>
    </View>
  );

  const disabledReason = rows.find((r) => r.disabled)?.disabledReason ?? null;

  return (
    <>
      <Sheet visible={visible} onClose={onClose} snapPoint="full">
        <SheetScrollLayout keyboardAware={creating} footer={footer} testID="guest-questions-sheet">
          <Text style={styles.title} accessibilityRole="header">
            {ATTACH_COPY.sheetTitle}
          </Text>

          {creating ? (
            <View style={styles.block}>
              <Text style={styles.cap}>{FORMS_COPY.nameSheetTitle}</Text>
              <Text style={styles.line}>{FORMS_COPY.nameSheetHint}</Text>
              <TextInput
                value={newName}
                onChangeText={(t) => setNewName(t.slice(0, BRAND_FORM_NAME_MAX))}
                placeholder={FORMS_COPY.nameFieldPlaceholder}
                placeholderTextColor={color.text4}
                maxLength={BRAND_FORM_NAME_MAX}
                style={styles.input}
                accessibilityLabel={FORMS_COPY.nameFieldLabel}
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                testID="guest-questions-new-name"
              />
              <Text style={styles.counter}>{`${newName.length} / ${BRAND_FORM_NAME_MAX}`}</Text>
              <Text style={styles.line}>
                It is added to this page as a draft and starts asking once you publish it.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.block}>
                <Text style={styles.cap}>{ATTACH_COPY.formSection}</Text>
                {forms.isLoading ? <Text style={styles.line}>Loading…</Text> : null}
                {forms.isError ? (
                  <View style={styles.block}>
                    <Text style={styles.line}>{errorSentence(forms.error, ATTACH_COPY.loadFailed)}</Text>
                    <Button label={FORMS_COPY.tryAgain} variant="secondary" size="sm" onPress={() => void forms.refetch()} />
                  </View>
                ) : null}
                {!forms.isLoading && !forms.isError && items.length === 0 ? (
                  <Text style={styles.line}>{`${ATTACH_COPY.noFormsTitle}. ${ATTACH_COPY.noFormsBody}`}</Text>
                ) : null}
                <View accessibilityRole="radiogroup" accessibilityLabel={ATTACH_COPY.formSection} style={styles.group}>
                  {items.map(({ form, questionCount }) => {
                    const state = formRowState({ id: form.id, status: form.status }, currentFormId);
                    const selected = formId === form.id;
                    const sub =
                      state.hint === "draft"
                        ? ATTACH_COPY.draftHint
                        : state.hint === "closed"
                          ? ATTACH_COPY.closedHint
                          : form.status === "draft"
                            ? ATTACH_COPY.rowNotPublished
                            : ATTACH_COPY.questionsHint(questionCount);
                    return (
                      <Pressable
                        key={form.id}
                        onPress={() => setFormId(form.id)}
                        disabled={!state.selectable}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: !state.selectable }}
                        accessibilityLabel={`${form.name}. ${sub}`}
                        style={radioRow(selected, !state.selectable)}
                        testID={`guest-questions-form-${form.id}`}
                      >
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {form.name}
                          </Text>
                          <Text style={styles.rowLine}>{sub}</Text>
                        </View>
                        {selected ? <Icon name="check" size={18} color={color.accent} strokeWidth={2.5} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <Button
                  label={ATTACH_COPY.createNew}
                  variant="secondary"
                  size="md"
                  leadingIcon="plus"
                  fullWidth
                  disabled={busy}
                  onPress={() => setCreating(true)}
                  testID="guest-questions-create"
                />
              </View>

              <View style={styles.block}>
                <Text style={styles.cap}>{ATTACH_COPY.whenSection}</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel={ATTACH_COPY.whenSection} style={styles.group}>
                  {rows.map((row) => {
                    const selected = mode === row.value;
                    return (
                      <Pressable
                        key={row.value}
                        onPress={() => setMode(row.value)}
                        disabled={row.disabled}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: row.disabled }}
                        accessibilityLabel={`${row.label}. ${row.line}`}
                        style={radioRow(selected, row.disabled)}
                        testID={`guest-questions-mode-${row.value}`}
                      >
                        <View style={[styles.dot, selected && styles.dotOn]} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{row.label}</Text>
                          <Text style={styles.rowLine}>{row.line}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {disabledReason !== null ? <Text style={styles.line}>{disabledReason}</Text> : null}
              </View>
            </>
          )}
        </SheetScrollLayout>
      </Sheet>
      {toast}
    </>
  );
};

const styles = StyleSheet.create({
  title: { ...type.title, color: color.text1, marginBottom: space[3] },
  block: { gap: space[2], marginBottom: space[4] },
  cap: { ...type.label, textTransform: "uppercase", color: color.text3 },
  line: { ...type.small, color: color.text2 },
  group: { gap: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  rowOn: { borderColor: color.accent, backgroundColor: color.fill.inset },
  rowOff: { opacity: 0.5 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  rowLine: { ...type.caption, color: color.text3 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.lineStrong,
  },
  dotOn: { borderColor: color.accent, backgroundColor: color.accent },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    paddingHorizontal: space[4],
    ...type.body,
    color: color.text1,
  },
  counter: { ...type.caption, color: color.text3, textAlign: "right" },
  footerStack: { gap: space[2] },
  footer: { flexDirection: "row", gap: space[2] },
  footerCell: { flex: 1 },
  why: { ...type.caption, color: color.text3, textAlign: "center" },
});
