// Issue #4270 (Wave 4): add to the plan, or change one thing on your own item.
// On a phone it is a Sheet whose body is the keyboard-aware SmartScrollView; in
// the wide web rail the same form sits in the rail (inline). Nothing here
// listens to the keyboard: focused-field clearance belongs to the wrapper.
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, View, type TextInput } from "react-native";

import { glass, spacing, text as textTokens } from "../../constants/designSystem";
import { useBusinessMediaTranslation } from "../../i18n";
import { useBrandPlanWrites } from "../../hooks/useBrandPlan";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import {
  addIsoDays,
  BrandPlanError,
  brandPlanErrorKey,
  brandPlanFormProblems,
  brandPlanNewItem,
  brandPlanRequestKey,
  brandPlanTitleLimit,
  isBrandPlanLink,
  mapBrandPlanError,
  type BrandPlanFormField,
  type BrandPlanFormValues,
  type BrandPlanItem,
} from "../../services/brandPlanService";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { DateField } from "../ui/DateField";
import { Input } from "../ui/Input";
import { OptionCard } from "../ui/OptionCard";
import { Sheet } from "../ui/Sheet";

export type BrandPlanEdit = { field: "date" | "link"; item: BrandPlanItem };

export interface BrandPlanAddSheetProps {
  visible: boolean;
  inline?: boolean;
  brandId: string;
  today: string;
  /** The plan's limit on a title (title_max): the most this brand's plan can hold. */
  titleMax: number;
  initialDate?: string | null;
  edit?: BrandPlanEdit | null;
  onClose: () => void;
  /** Saved: `key` is the copy to show under plan. */
  onDone: (key: string) => void;
  /** A change the server refused because the plan moved on: the sheet closes. */
  onStale?: (key: string) => void;
}

function initialForm(today: string, initialDate: string | null | undefined, edit: BrandPlanEdit | null | undefined): BrandPlanFormValues {
  return {
    type: "post",
    title: edit?.item.title ?? "",
    on: edit?.item.on ?? initialDate ?? today,
    link: edit?.item.link?.url ?? "",
    note: "",
  };
}

// Tapping outside or dragging only puts the keyboard away. The sheet holds what
// the host typed, so only Cancel closes it (D31).
const holdTheSheet = (): boolean => true;
const putKeyboardAway = (): void => Keyboard.dismiss();

export function BrandPlanAddSheet(props: BrandPlanAddSheetProps): React.ReactElement | null {
  const { visible, inline = false, onClose } = props;
  const writes = useBrandPlanWrites(props.brandId);
  const busy = writes.add.isPending || writes.update.isPending;
  if (inline) return visible ? <PlanForm {...props} writes={writes} /> : null;
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full" dismissDisabled={busy} dismissGuard={holdTheSheet} onRequestClose={putKeyboardAway} testID="brand-plan-add-sheet">
      {visible ? <PlanForm {...props} writes={writes} /> : <View />}
    </Sheet>
  );
}

function PlanForm({ today, titleMax: planTitleMax, initialDate, edit, onClose, onDone, onStale, writes }: BrandPlanAddSheetProps & { writes: ReturnType<typeof useBrandPlanWrites> }): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  const { add, update } = writes;
  const network = useNetInfoSafe();
  // Only NetInfo's own "false" is offline. A failed request of unknown state
  // is a failure, never "offline".
  const offline = network?.isConnected === false;
  const [form, setForm] = useState<BrandPlanFormValues>(() => initialForm(today, initialDate, edit));
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // A newer limit the server gave when it refused the title; the plan's own
  // limit takes over again once the plan has been read again.
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const titleMax = refusedAt ?? planTitleMax;
  const keyRef = useRef<{ key: string; value: string } | null>(null);
  const titleRef = useRef<TextInput>(null);
  const linkRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);
  const busy = add.isPending || update.isPending;
  const showWhat = !edit;
  const showDate = !edit || edit.field === "date";
  const showLink = !edit || edit.field === "link";

  useEffect(() => {
    setForm(initialForm(today, initialDate, edit));
    setTried(false);
    setFailed(null);
    keyRef.current = null;
  }, [edit, initialDate, today]);

  useEffect(() => {
    setRefusedAt(null);
  }, [planTitleMax]);

  const problems = edit
    ? brandPlanFormProblems({ ...form, type: "post", title: edit.item.title }, today).filter((p) => p.field === (edit.field === "date" ? "on" : "link"))
    : brandPlanFormProblems(form, today, titleMax);
  const problem = (field: BrandPlanFormField): string | null => {
    const found = tried ? problems.find((p) => p.field === field) : undefined;
    return found ? t(`plan.${found.key}`, { max: titleMax }) : null;
  };
  const set = (patch: Partial<BrandPlanFormValues>): void => {
    setFailed(null);
    setForm((current) => ({ ...current, ...patch }));
  };
  const focus = (field: BrandPlanFormField): void => {
    if (field === "title") titleRef.current?.focus();
    if (field === "link") linkRef.current?.focus();
    if (field === "note") noteRef.current?.focus();
  };

  async function submit(): Promise<void> {
    if (busy || offline) return;
    setTried(true);
    setFailed(null);
    if (problems.length) {
      focus(problems[0].field);
      return;
    }
    try {
      if (edit) {
        const link = form.link.trim();
        const changes = edit.field === "date" ? { on: form.on } : { link: link && isBrandPlanLink(link) ? link : null };
        await update.mutateAsync({ item: edit.item, changes });
        onDone("saved");
        return;
      }
      const item = brandPlanNewItem(form);
      const value = JSON.stringify(item);
      // A retry of the same item is the same request, so it can never add two.
      if (keyRef.current?.value !== value) keyRef.current = { key: brandPlanRequestKey(), value };
      await add.mutateAsync({ item, requestKey: keyRef.current.key });
      keyRef.current = null;
      onDone(form.type === "task" ? "added_task" : "added_post");
    } catch (cause) {
      const error: BrandPlanError = mapBrandPlanError(cause);
      const key = brandPlanErrorKey(error, edit ? "save_failed" : "add_failed");
      const limit = brandPlanTitleLimit(error);
      if (limit !== null) {
        // The brand's name changed while this was open. Nothing is cut: the
        // title stays as typed and the host is told the new limit.
        setRefusedAt(limit);
        focus("title");
        setFailed(t(`plan.${key}`, { max: limit }));
        return;
      }
      if (edit && (error.code === "stale_write" || error.code === "not_found" || error.code === "locked")) {
        onStale?.(key);
        return;
      }
      // What was typed stays; the line says what failed.
      setFailed(t(`plan.${key}`));
    }
  }

  return (
    <ScrollView
      style={styles.scrollFlex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="brand-plan-form-scroll"
    >
      <Text style={styles.title} accessibilityRole="header">{edit ? t(edit.field === "date" ? "plan.change_date" : "plan.change_link") : t("plan.submit")}</Text>
      {showWhat ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t("plan.what")}</Text>
          <Input
            ref={titleRef}
            value={form.title}
            onChangeText={(title) => set({ title })}
            maxLength={titleMax}
            disabled={busy}
            accessibilityLabel={t("plan.what")}
            error={problem("title")}
            testID="brand-plan-what"
          />
          {form.title.length >= titleMax - 20 ? <Text style={styles.counter} testID="brand-plan-counter">{`${form.title.length}/${titleMax}`}</Text> : null}
        </View>
      ) : null}
      {showDate ? (
        <View style={styles.field}>
          <DateField
            label={t("plan.date")}
            value={form.on}
            onChangeValue={(on) => set({ on })}
            accessibilityLabel={t("plan.date")}
            min={today}
            max={addIsoDays(today, 365)}
            disabled={busy}
            hasError={Boolean(problem("on"))}
            testID="brand-plan-date"
          />
          {problem("on") ? <Text style={styles.error} accessibilityRole="alert">{problem("on")}</Text> : null}
        </View>
      ) : null}
      {showWhat ? (
        <View style={styles.types} accessibilityRole="radiogroup">
          <OptionCard label={t("plan.kind_post")} helper={t("plan.help_post")} selected={form.type === "post"} onPress={() => set({ type: "post" })} disabled={busy} testID="brand-plan-type-post" />
          <OptionCard label={t("plan.kind_task")} helper={t("plan.help_task")} selected={form.type === "task"} onPress={() => set({ type: "task" })} disabled={busy} testID="brand-plan-type-task" />
        </View>
      ) : null}
      {showLink ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t("plan.link")}</Text>
          <Input
            ref={linkRef}
            value={form.link}
            onChangeText={(link) => set({ link })}
            maxLength={2000}
            variant="text"
            placeholder="https://"
            disabled={busy}
            accessibilityLabel={t("plan.link")}
            error={problem("link")}
            testID="brand-plan-link"
          />
        </View>
      ) : null}
      {showWhat ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t("plan.note")}</Text>
          <Input
            ref={noteRef}
            value={form.note}
            onChangeText={(note) => set({ note })}
            maxLength={500}
            multiline
            disabled={busy}
            accessibilityLabel={t("plan.note")}
            error={problem("note")}
            testID="brand-plan-note"
          />
        </View>
      ) : null}
      {offline ? <Text style={styles.error} accessibilityRole="alert" testID="brand-plan-offline">{t("plan.offline")}</Text> : null}
      {failed ? <Text style={styles.error} accessibilityRole="alert" testID="brand-plan-failed">{failed}</Text> : null}
      <View style={styles.footer}>
        <Button
          label={busy ? t(edit ? "plan.saving" : "plan.adding") : t(edit ? "plan.save" : "plan.submit")}
          variant="primary"
          fullWidth
          disabled={busy || offline}
          onPress={() => void submit()}
          testID="brand-plan-submit"
        />
        <Button label={t("plan.cancel")} variant="ghost" fullWidth disabled={busy} onPress={onClose} testID="brand-plan-cancel" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollFlex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  field: { gap: spacing.xs },
  label: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  counter: { color: textTokens.tertiary, fontSize: 12, textAlign: "right" },
  types: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  error: { color: "#ff8b8b", fontSize: 13, lineHeight: 18 },
  footer: { gap: spacing.sm, paddingTop: spacing.xs },
});
