/**
 * #4514 — Promote › Forms: the host's forms for the current brand.
 *
 * States: loading, failed (with Try again), empty, and a
 * list of draft / live / closed forms. A draft can only be continued; a live
 * form can be edited or its Responses opened; a closed form can be reopened.
 * The Blast shell owns the brand switcher, the section pills and the safe
 * area; this screen adds none of them.
 *
 * #4541 R6.1: the shell's tab action is the ONE "Create a form" control. This
 * screen registers it (through the shell bridge, never the action owner) so it
 * opens the name sheet in place; the list adds no button of its own.
 *
 * Reached through a lazily loaded route (`app/(tabs)/marketing/forms`), so
 * none of this is in the eager web bundle.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

// A form with text fields scrolls with the keyboard-aware wrapper (issue #1841 gate).
import { ScrollView } from "../../wrappers/SmartScrollView";

import { color, radius, space, type } from "../../constants/designSystem";
import { useBrandFormCounts, useBrandFormsList, useCreateBrandForm, useReopenBrandForm } from "../../hooks/useBrandForms";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import type { BrandFormListItem, BrandFormStatus } from "../../services/brandFormsService";
import { MIN_RANK } from "../../utils/permissionGates";
import { useMarketingActionRegistration } from "../people/MarketingBrandSwitcherContext";
import { BRAND_FORM_NAME_MAX, BRAND_FORM_NAME_MIN } from "../../utils/brandFormDefinition";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { Pill, type PillVariant } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { FORMS_COPY, formCountsLine, modeLabel } from "./brandFormsCopy";
import { errorSentence, useFormsToast } from "./useFormsToast";

const STATUS_VARIANT: Record<BrandFormStatus, PillVariant> = {
  draft: "draft",
  live: "live",
  closed: "muted",
  archived: "muted",
};

const STATUS_LABEL: Record<BrandFormStatus, string> = {
  draft: FORMS_COPY.statusDraft,
  live: FORMS_COPY.statusLive,
  closed: FORMS_COPY.statusClosed,
  archived: FORMS_COPY.statusClosed,
};

/** The "On {page} · {when guests answer}" line of a card. */
export function pagesLine(item: BrandFormListItem): string {
  if (item.attachments.length === 0) return FORMS_COPY.notOnAnyPage;
  const first = item.attachments[0];
  if (first === undefined) return FORMS_COPY.notOnAnyPage;
  const name = first.eventName ?? "a page";
  const more = item.attachments.length - 1;
  const when = modeLabel(first.mode, first.eventType === "rsvp").toLowerCase();
  return `On ${name}${more > 0 ? ` and ${more} more` : ""} · ${when}`;
}

const FormCard: React.FC<{
  item: BrandFormListItem;
  counts: { answered: number; toAnswer: number; blastReplies?: { known: number; unknown: number } } | undefined;
  busy: boolean;
  onEdit: () => void;
  onResponses: () => void;
  onReopen: () => void;
}> = ({ item, counts, busy, onEdit, onResponses, onReopen }) => {
  const { form } = item;
  const status = form.status;
  const answers = status === "draft" ? null : formCountsLine(counts);
  // #4541 R4.9: replies from Blasts (no page), when there are any.
  const blastTotal = counts?.blastReplies === undefined ? 0 : counts.blastReplies.known + counts.blastReplies.unknown;
  return (
    <GlassCard variant="base" radius="lg" padding={space[4]} testID={`brand-form-card-${form.id}`}>
      <View style={styles.cardHead}>
        <Pill variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Pill>
        <Text style={styles.meta}>
          {`${item.questionCount} ${item.questionCount === 1 ? "question" : "questions"}${
            item.version !== null ? ` · ${FORMS_COPY.version(item.version)}` : ""
          }`}
        </Text>
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {form.name}
      </Text>
      <Text style={styles.cardLine}>{pagesLine(item)}</Text>
      {answers !== null ? (
        <Text style={styles.cardSub} testID={`brand-form-counts-${form.id}`}>
          {answers}
        </Text>
      ) : null}
      {blastTotal > 0 ? (
        <Text style={styles.cardSub} testID={`brand-form-blast-replies-${form.id}`}>
          {FORMS_COPY.blastReplies(blastTotal)}
        </Text>
      ) : null}
      {status === "draft" ? <Text style={styles.cardSub}>{FORMS_COPY.publishToAdd}</Text> : null}
      <View style={styles.actions}>
        {status === "draft" ? (
          <Button
            label={FORMS_COPY.continueEditing}
            variant="primary"
            size="sm"
            onPress={onEdit}
            testID={`brand-form-edit-${form.id}`}
          />
        ) : null}
        {status === "live" ? (
          <>
            <Button
              label={FORMS_COPY.edit}
              variant="secondary"
              size="sm"
              onPress={onEdit}
              testID={`brand-form-edit-${form.id}`}
            />
            <Button
              label={FORMS_COPY.responses}
              variant="primary"
              size="sm"
              onPress={onResponses}
              testID={`brand-form-responses-${form.id}`}
            />
          </>
        ) : null}
        {status === "closed" ? (
          <>
            <Button
              label={FORMS_COPY.reopen}
              variant="secondary"
              size="sm"
              loading={busy}
              disabled={busy}
              onPress={onReopen}
              testID={`brand-form-reopen-${form.id}`}
            />
            <Button
              label={FORMS_COPY.responses}
              variant="primary"
              size="sm"
              onPress={onResponses}
              testID={`brand-form-responses-${form.id}`}
            />
          </>
        ) : null}
      </View>
    </GlassCard>
  );
};

export const BrandFormsListScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();
  const { isWideDesktop } = useResponsiveLayout();
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const role = useCurrentBrandRole(brandId);
  const list = useBrandFormsList(brandId);
  // Counts are extra: while they load or if they fail, the cards simply omit the line.
  const counts = useBrandFormCounts(brandId);
  const countByForm = useMemo(
    () => new Map((counts.data?.forms ?? []).map((c) => [c.formId, c] as const)),
    [counts.data],
  );
  const create = useCreateBrandForm();
  const reopen = useReopenBrandForm();
  const { show, toast } = useFormsToast();

  const [nameOpen, setNameOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const canRead = role.rank >= MIN_RANK.READ_FORM_RESPONSES;
  const openCreate = useCallback((): void => {
    setName("");
    setNameOpen(true);
  }, []);

  // #4541 R6.1: the shared tab action opens the name sheet in place.
  const createAction = useMemo(
    () =>
      brandId !== null && canRead
        ? {
            id: "forms-create",
            label: FORMS_COPY.createForm,
            compactLabel: FORMS_COPY.createFormCompact,
            icon: "plus" as const,
            onPress: openCreate,
          }
        : null,
    [brandId, canRead, openCreate],
  );
  useMarketingActionRegistration(createAction);

  // Deep links and the phone's floating button open this screen with
  // ?action=create; open the name sheet once, then clear the param so the
  // action works again next time.
  useEffect(() => {
    if (params.action === "create") {
      openCreate();
      router.setParams({ action: undefined } as never);
    }
  }, [params.action, openCreate, router]);

  const trimmed = name.trim();
  const nameValid = trimmed.length >= BRAND_FORM_NAME_MIN && trimmed.length <= BRAND_FORM_NAME_MAX;

  const handleCreate = useCallback((): void => {
    if (brandId === null || !nameValid || create.isPending) return;
    create.mutate(
      { brandId, name: trimmed },
      {
        onSuccess: ({ formId }) => {
          setNameOpen(false);
          router.push(`/(tabs)/marketing/forms/${formId}` as never);
        },
        onError: (error) => show("error", errorSentence(error, "Couldn't create the form. Try again.")),
      },
    );
  }, [brandId, nameValid, create, trimmed, router, show]);

  const handleReopen = useCallback(
    (formId: string): void => {
      setReopeningId(formId);
      reopen.mutate(formId, {
        onSuccess: () => show("success", FORMS_COPY.reopenedToast),
        onError: (error) => show("error", errorSentence(error, "Couldn't reopen the form. Try again.")),
        onSettled: () => setReopeningId(null),
      });
    },
    [reopen, show],
  );

  const items = useMemo(() => list.data ?? [], [list.data]);

  let body: React.ReactElement;
  if (!role.isLoading && brandId !== null && !canRead) {
    body = (
      <EmptyState
        illustration="list"
        title="Forms are for marketing managers and above"
        description="Ask a brand admin to change your role."
      />
    );
  } else if (brandId === null || list.isLoading || (role.isLoading && list.data === undefined)) {
    body = (
      <View style={styles.center} testID="brand-forms-loading">
        <ActivityIndicator size="small" color={color.text2} />
      </View>
    );
  } else if (list.isError) {
    body = (
      <EmptyState
        illustration="list"
        title={FORMS_COPY.listLoadFailedTitle}
        description={errorSentence(list.error, FORMS_COPY.listLoadFailedBody)}
        cta={{ label: FORMS_COPY.tryAgain, onPress: () => void list.refetch(), variant: "secondary" }}
        testID="brand-forms-error"
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        illustration="list"
        title={FORMS_COPY.emptyTitle}
        description={FORMS_COPY.emptyBody}
        testID="brand-forms-empty"
      />
    );
  } else {
    body = (
      <View style={[styles.grid, isWideDesktop && styles.gridWide]} testID="brand-forms-list">
        {items.map((item) => (
          <View key={item.form.id} style={isWideDesktop ? styles.cellWide : styles.cell}>
            <FormCard
              item={item}
              counts={countByForm.get(item.form.id)}
              busy={reopeningId === item.form.id}
              onEdit={() => router.push(`/(tabs)/marketing/forms/${item.form.id}` as never)}
              onResponses={() => router.push(`/(tabs)/marketing/forms/${item.form.id}/responses` as never)}
              onReopen={() => handleReopen(item.form.id)}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {items.length > 0 && canRead ? (
          <View style={styles.headRow}>
            <Text style={styles.count} accessibilityRole="header" testID="brand-forms-count">
              {FORMS_COPY.formsHeading(items.length)}
            </Text>
          </View>
        ) : null}
        {body}
      </ScrollView>

      <Sheet visible={nameOpen} onClose={() => setNameOpen(false)} snapPoint="half">
        <SheetScrollLayout
          keyboardAware
          testID="brand-forms-name-sheet"
          footer={
            <View style={styles.footer}>
              <View style={styles.footerCell}>
                <Button label={FORMS_COPY.cancel} variant="secondary" size="md" fullWidth onPress={() => setNameOpen(false)} />
              </View>
              <View style={styles.footerCell}>
                <Button
                  label={create.isPending ? FORMS_COPY.creating : FORMS_COPY.create}
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={create.isPending}
                  disabled={!nameValid || create.isPending}
                  onPress={handleCreate}
                  testID="brand-forms-name-create"
                />
              </View>
            </View>
          }
        >
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {FORMS_COPY.nameSheetTitle}
          </Text>
          <Text style={styles.sheetHint}>{FORMS_COPY.nameSheetHint}</Text>
          <Text style={styles.fieldLabel}>{FORMS_COPY.nameFieldLabel}</Text>
          <TextInput
            value={name}
            onChangeText={(t) => setName(t.slice(0, BRAND_FORM_NAME_MAX))}
            placeholder={FORMS_COPY.nameFieldPlaceholder}
            placeholderTextColor={color.text4}
            maxLength={BRAND_FORM_NAME_MAX}
            style={styles.input}
            accessibilityLabel={FORMS_COPY.nameFieldLabel}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={handleCreate}
            testID="brand-forms-name-input"
          />
          <Text style={styles.counter}>{`${name.length} / ${BRAND_FORM_NAME_MAX}`}</Text>
        </SheetScrollLayout>
      </Sheet>
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: 120,
    gap: space[3],
  },
  center: { paddingVertical: space[8], alignItems: "center" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  count: { ...type.small, color: color.text2 },
  grid: { gap: space[3] },
  gridWide: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "100%" },
  cellWide: { width: "48.5%" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space[2], marginBottom: space[2] },
  meta: { ...type.caption, color: color.text3 },
  cardName: { ...type.row, color: color.text1 },
  cardLine: { ...type.small, color: color.text2, marginTop: space[1] },
  cardSub: { ...type.caption, color: color.text3, marginTop: space[1] },
  actions: { flexDirection: "row", gap: space[2], marginTop: space[3], flexWrap: "wrap" },
  sheetTitle: { ...type.title, color: color.text1 },
  sheetHint: { ...type.small, color: color.text2, marginTop: space[1] },
  fieldLabel: { ...type.label, color: color.text3, textTransform: "uppercase", marginTop: space[4], marginBottom: space[1] },
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
  counter: { ...type.caption, color: color.text3, textAlign: "right", marginTop: space[1] },
  footer: { flexDirection: "row", gap: space[2] },
  footerCell: { flex: 1 },
});
