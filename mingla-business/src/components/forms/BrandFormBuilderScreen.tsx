/**
 * #4514 — Promote › Forms › one form: the builder.
 *
 * The trip question builder, extended in place (IntakeSchemaBuilder with its
 * brand form features on): question cards, the type picker, help text,
 * "Show only if", "Show at the door", the Required switch. Around it: the
 * form name, Save draft / Publish / Publish changes / Close form / Reopen,
 * the form-level "Door staff can open full answers" switch, the stale-draft
 * banner and a live preview with the brand header (beside the editor from
 * 1024 px; an Edit / Preview toggle on a phone).
 *
 * A save, publish, close or reopen that fails tells the host why. A stale
 * draft (someone else saved first) shows "Someone else changed this form.
 * Reload." and keeps the host's edits until they reload.
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
import {
  useArchiveBrandForm,
  useBrandFormDetail,
  useCloseBrandForm,
  usePublishBrandForm,
  useReopenBrandForm,
  useSaveBrandFormDraft,
  useSetDoorFullAnswers,
} from "../../hooks/useBrandForms";
import { useBrand } from "../../hooks/useBrands";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { BrandFormsError, type BrandFormDetail, type BrandFormStatus } from "../../services/brandFormsService";
import type { IntakeSchema } from "../../services/intakeSchemaService";
import {
  BRAND_FORM_NAME_MAX,
  BRAND_FORM_NAME_MIN,
  definitionToSchema,
  publishBlockers,
  sameDefinition,
  schemaToDefinition,
} from "../../utils/brandFormDefinition";
import { MIN_RANK } from "../../utils/permissionGates";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { IconChrome } from "../ui/IconChrome";
import { Pill, Segmented, type PillVariant } from "../ui/Pill";
import { Switch } from "../ui/Switch";
import type { IntakeSchemaBuilderProps } from "../trip/IntakeSchemaBuilder";
import { BRAND_FORM_FEATURES } from "./brandFormBuilderKit";
import { BrandFormPreview } from "./BrandFormPreview";
import { brandFormHeaderData } from "../../utils/brandFormHeader";
import { FORMS_COPY } from "./brandFormsCopy";
import { FormsNotice } from "./FormsNotice";
import { FormRequestSheet } from "./FormRequestSheet";
import { errorSentence, useFormsToast } from "./useFormsToast";

// #4514 — the question builder (with its editor and type picker) loads on
// demand. Trip create, trip edit and the brand form builder each declare this
// `import()` of the same module, so the builder stays in ONE async chunk; a
// shared static wrapper module would itself be hoisted into the eager
// `__common` chunk every Host web visitor downloads first.
const LazyBuilder = React.lazy(() =>
  import("../trip/IntakeSchemaBuilder").then((m) => ({ default: m.IntakeSchemaBuilder })),
);
const IntakeSchemaBuilder = (props: IntakeSchemaBuilderProps): React.ReactElement => (
  <React.Suspense fallback={null}>
    <LazyBuilder {...props} />
  </React.Suspense>
);

const WIDE_BREAKPOINT = 1024;

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

type MobileTab = "edit" | "preview";

export const BrandFormBuilderScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{ formId?: string }>();
  const formId = typeof params.formId === "string" ? params.formId : null;
  const { width } = useResponsiveLayout();
  const wide = width >= WIDE_BREAKPOINT;

  const detail = useBrandFormDetail(formId);
  const brandQuery = useBrand(detail.data?.form.brandId ?? null);
  const role = useCurrentBrandRole(detail.data?.form.brandId ?? null);
  const save = useSaveBrandFormDraft();
  const publish = usePublishBrandForm();
  const close = useCloseBrandForm();
  const reopen = useReopenBrandForm();
  const archive = useArchiveBrandForm();
  const doorFull = useSetDoorFullAnswers();
  const { show, toast } = useFormsToast();
  // Wave 4 (C12): publishing on live pages with guests asks "Ask earlier guests?", one page at a time.
  const [earlierQueue, setEarlierQueue] = useState<Array<{ eventId: string; count: number }>>([]);

  // Local editing state (the draft the host is working on).
  const [name, setName] = useState<string>("");
  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [rev, setRev] = useState<number>(0);
  const [baseline, setBaseline] = useState<string>("");
  const [hydratedRev, setHydratedRev] = useState<number | null>(null);
  const [stale, setStale] = useState<boolean>(false);
  const [tab, setTab] = useState<MobileTab>("edit");
  const [doorAcked, setDoorAcked] = useState<boolean>(false);
  const [confirmClose, setConfirmClose] = useState<boolean>(false);
  const [confirmArchive, setConfirmArchive] = useState<boolean>(false);

  const intro = detail.data?.form.draft.intro;

  const currentDef = useMemo(
    () => schemaToDefinition(schema, { title: name.trim(), intro }),
    [schema, name, intro],
  );
  const currentKey = useMemo(() => JSON.stringify([name.trim(), currentDef]), [name, currentDef]);
  const dirty = hydratedRev !== null && currentKey !== baseline;

  const hydrate = useCallback((d: BrandFormDetail): void => {
    const nextSchema = definitionToSchema(d.form.draft);
    setName(d.form.name);
    setSchema(nextSchema);
    setRev(d.form.draftRev);
    setHydratedRev(d.form.draftRev);
    setBaseline(
      JSON.stringify([
        d.form.name.trim(),
        schemaToDefinition(nextSchema, { title: d.form.name.trim(), intro: d.form.draft.intro }),
      ]),
    );
    setStale(false);
  }, []);

  // Take the server's draft when it is new to us. If the host has unsaved
  // edits and the server moved on, keep the edits and show the stale banner.
  useEffect(() => {
    const d = detail.data;
    if (d === undefined) return;
    // Only a NEWER server revision is news. The cached copy lags one refetch
    // behind a save of our own, and must not overwrite what we just saved.
    if (hydratedRev !== null && d.form.draftRev <= hydratedRev) return;
    if (hydratedRev !== null && dirty) {
      setStale(true);
      return;
    }
    hydrate(d);
  }, [detail.data, hydratedRev, dirty, hydrate]);

  const handleReload = useCallback((): void => {
    void detail.refetch().then((result) => {
      if (result.data !== undefined) hydrate(result.data);
      else show("error", "Couldn't reload this form. Try again.");
    });
  }, [detail, hydrate, show]);

  const reportError = useCallback(
    (error: unknown, fallback: string): void => {
      if (error instanceof BrandFormsError && error.code === "form_draft_conflict") {
        setStale(true);
      }
      show("error", errorSentence(error, fallback));
    },
    [show],
  );

  const nameValid = name.trim().length >= BRAND_FORM_NAME_MIN && name.trim().length <= BRAND_FORM_NAME_MAX;
  const form = detail.data?.form ?? null;
  const status: BrandFormStatus | null = form?.status ?? null;
  const busy =
    save.isPending || publish.isPending || close.isPending || reopen.isPending || archive.isPending;
  const published = detail.data?.published ?? null;
  const unpublished = published === null ? true : !sameDefinition(currentDef, published);
  const questions = schema?.questions ?? [];

  /** Save the working draft; resolves to the new revision or null when it failed. */
  const saveDraft = useCallback(async (): Promise<number | null> => {
    if (formId === null) return null;
    try {
      const result = await save.mutateAsync({
        formId,
        draft: currentDef,
        draftRev: rev,
        name: name.trim(),
      });
      setRev(result.draftRev);
      setHydratedRev(result.draftRev);
      setBaseline(currentKey);
      setStale(false);
      return result.draftRev;
    } catch (error) {
      reportError(error, "Couldn't save the draft. Try again.");
      return null;
    }
  }, [formId, save, currentDef, rev, name, currentKey, reportError]);

  const handleSaveDraft = useCallback((): void => {
    if (!nameValid) {
      show("error", "A form name needs 2 to 80 characters.");
      return;
    }
    void saveDraft().then((next) => {
      if (next !== null) show("success", FORMS_COPY.savedToast);
    });
  }, [nameValid, saveDraft, show]);

  const handlePublish = useCallback((): void => {
    if (formId === null) return;
    if (!nameValid) {
      show("error", "A form name needs 2 to 80 characters.");
      return;
    }
    const blockers = publishBlockers(questions);
    const first = blockers[0];
    if (first !== undefined) {
      show("error", first);
      return;
    }
    void (async () => {
      let revision: number | null = rev;
      if (dirty) revision = await saveDraft();
      if (revision === null) return;
      try {
        const published = await publish.mutateAsync({ formId, draftRev: revision });
        show("success", FORMS_COPY.publishedToast);
        setEarlierQueue(published.earlierGuests.filter((g) => g.count > 0));
      } catch (error) {
        reportError(error, "Couldn't publish the form. Try again.");
      }
    })();
  }, [formId, nameValid, questions, rev, dirty, saveDraft, publish, show, reportError]);

  const handleClose = useCallback((): void => {
    if (formId === null) return;
    close.mutate(formId, {
      onSuccess: () => {
        setConfirmClose(false);
        show("success", FORMS_COPY.closedToast);
      },
      onError: (error) => {
        setConfirmClose(false);
        show("error", errorSentence(error, "Couldn't close the form. Try again."));
      },
    });
  }, [formId, close, show]);

  const handleReopen = useCallback((): void => {
    if (formId === null) return;
    reopen.mutate(formId, {
      onSuccess: () => show("success", FORMS_COPY.reopenedToast),
      onError: (error) => show("error", errorSentence(error, "Couldn't reopen the form. Try again.")),
    });
  }, [formId, reopen, show]);

  const handleArchive = useCallback((): void => {
    if (formId === null) return;
    archive.mutate(formId, {
      onSuccess: () => {
        setConfirmArchive(false);
        router.replace("/(tabs)/marketing/forms" as never);
      },
      onError: (error) => {
        setConfirmArchive(false);
        show("error", errorSentence(error, "Couldn't archive the form. Try again."));
      },
    });
  }, [formId, archive, router, show]);

  const handleDoorFull = useCallback(
    (on: boolean): void => {
      if (formId === null) return;
      doorFull.mutate(
        { formId, on },
        { onError: (error) => show("error", errorSentence(error, "Couldn't change that setting. Try again.")) },
      );
    },
    [formId, doorFull, show],
  );

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/forms" as never);
  }, [router]);

  const header = brandFormHeaderData(brandQuery.data ?? null);

  // --- States -------------------------------------------------------------
  let content: React.ReactElement;
  if (formId === null || (detail.isLoading && detail.data === undefined)) {
    content = (
      <View style={styles.center} testID="brand-form-builder-loading">
        <ActivityIndicator size="small" color={color.text2} />
      </View>
    );
  } else if (detail.isError && detail.data === undefined) {
    content = (
      <EmptyState
        illustration="list"
        title={FORMS_COPY.loadFailedTitle}
        description={errorSentence(detail.error, FORMS_COPY.listLoadFailedBody)}
        cta={{ label: FORMS_COPY.tryAgain, onPress: () => void detail.refetch(), variant: "secondary" }}
        testID="brand-form-builder-error"
      />
    );
  } else if (!role.isLoading && role.rank < MIN_RANK.READ_FORM_RESPONSES) {
    content = (
      <EmptyState
        illustration="list"
        title="Forms are for marketing managers and above"
        description="Ask a brand admin to change your role."
      />
    );
  } else if (form === null || schema === null) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={color.text2} />
      </View>
    );
  } else {
    const closed = form.status === "closed";
    const versionText =
      form.status === "draft" || detail.data?.version === null || detail.data?.version === undefined
        ? null
        : `${FORMS_COPY.version(detail.data.version)} · ${unpublished || dirty ? FORMS_COPY.unpublishedChanges : FORMS_COPY.live}`;

    const actions: React.ReactElement[] = [];
    if (form.status === "draft") {
      actions.push(
        <Button key="save" label={save.isPending ? FORMS_COPY.saving : FORMS_COPY.saveDraft} variant="secondary" size="sm" loading={save.isPending} disabled={busy || !dirty} onPress={handleSaveDraft} testID="brand-form-save-draft" />,
        <Button key="publish" label={publish.isPending ? FORMS_COPY.publishing : FORMS_COPY.publish} variant="primary" size="sm" loading={publish.isPending} disabled={busy} onPress={handlePublish} testID="brand-form-publish" />,
      );
    } else if (form.status === "live") {
      if (dirty || unpublished) {
        actions.push(
          <Button key="save" label={save.isPending ? FORMS_COPY.saving : FORMS_COPY.saveDraft} variant="secondary" size="sm" loading={save.isPending} disabled={busy || !dirty} onPress={handleSaveDraft} testID="brand-form-save-draft" />,
          <Button key="publish" label={publish.isPending ? FORMS_COPY.publishing : FORMS_COPY.publishChanges} variant="primary" size="sm" loading={publish.isPending} disabled={busy} onPress={handlePublish} testID="brand-form-publish" />,
        );
      } else {
        actions.push(
          <Button key="responses" label={FORMS_COPY.responses} variant="secondary" size="sm" disabled={busy} onPress={() => router.push(`/(tabs)/marketing/forms/${form.id}/responses` as never)} testID="brand-form-open-responses" />,
          <Button key="close" label={FORMS_COPY.closeForm} variant="secondary" size="sm" disabled={busy} onPress={() => setConfirmClose(true)} testID="brand-form-close" />,
        );
      }
    } else if (closed) {
      if (dirty || unpublished) {
        actions.push(
          <Button key="save" label={save.isPending ? FORMS_COPY.saving : FORMS_COPY.saveDraft} variant="secondary" size="sm" loading={save.isPending} disabled={busy || !dirty} onPress={handleSaveDraft} testID="brand-form-save-draft" />,
          <Button key="publish" label={publish.isPending ? FORMS_COPY.publishing : FORMS_COPY.publishChanges} variant="secondary" size="sm" loading={publish.isPending} disabled={busy} onPress={handlePublish} testID="brand-form-publish" />,
        );
      }
      actions.push(
        <Button key="reopen" label={FORMS_COPY.reopen} variant="primary" size="sm" loading={reopen.isPending} disabled={busy} onPress={handleReopen} testID="brand-form-reopen" />,
      );
    }

    const editColumn = (
      <View style={styles.column}>
        {stale ? (
          <FormsNotice
            tone="warning"
            title={FORMS_COPY.staleBanner}
            action={{ label: FORMS_COPY.reload, onPress: handleReload }}
            testID="brand-form-stale-banner"
          />
        ) : null}
        {closed ? <FormsNotice tone="info" title={FORMS_COPY.closedBanner} testID="brand-form-closed-banner" /> : null}
        <IntakeSchemaBuilder
          schema={schema}
          activeTicketTypeId={form.id}
          activeTierName={name}
          onSchemaChange={setSchema}
          onClearAll={() => undefined}
          disabled={busy}
          features={BRAND_FORM_FEATURES}
          doorNoticeAcked={doorAcked}
          onDoorNoticeAck={() => setDoorAcked(true)}
          testID="brand-form-questions"
        />
          <View style={styles.switchRow} testID="brand-form-door-full-row">
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>{FORMS_COPY.doorFullTitle}</Text>
              <Text style={styles.switchLine}>{FORMS_COPY.doorFullLine}</Text>
              <Text style={styles.switchSub}>{FORMS_COPY.doorFullScope}</Text>
            </View>
            <Switch
              value={form.doorFullAnswers}
              onValueChange={handleDoorFull}
              disabled={doorFull.isPending}
              accessibilityLabel={FORMS_COPY.doorFullTitle}
              testID="brand-form-door-full-switch"
            />
          </View>
        {form.status !== "live" ? (
          <Button
            label="Archive form"
            variant="ghost"
            size="sm"
            disabled={busy}
            onPress={() => setConfirmArchive(true)}
            testID="brand-form-archive"
          />
        ) : null}
      </View>
    );

    const previewColumn = (
      <View style={styles.column}>
        <BrandFormPreview
          definition={currentDef}
          name={name.trim()}
          brand={header}
          doorFullAnswers={form.doorFullAnswers}
        />
      </View>
    );

    content = (
      <>
        <View style={styles.head}>
          <IconChrome icon="arrowL" size={36} onPress={handleBack} accessibilityLabel="Back to forms" />
          <TextInput
            value={name}
            onChangeText={(t) => setName(t.slice(0, BRAND_FORM_NAME_MAX))}
            placeholder={FORMS_COPY.untitledForm}
            placeholderTextColor={color.text4}
            maxLength={BRAND_FORM_NAME_MAX}
            style={styles.nameInput}
            accessibilityLabel={FORMS_COPY.formNameLabel}
            editable={!busy}
            testID="brand-form-name"
          />
        </View>
        <View style={styles.statusRow}>
          <Pill variant={STATUS_VARIANT[form.status]}>{STATUS_LABEL[form.status]}</Pill>
          {versionText !== null ? <Text style={styles.version}>{versionText}</Text> : null}
          <View style={styles.actions}>{actions}</View>
        </View>
        {wide ? (
          <View style={styles.cols}>
            <View style={styles.colEdit}>{editColumn}</View>
            <View style={styles.colPreview}>{previewColumn}</View>
          </View>
        ) : (
          <>
            <Segmented<MobileTab>
              options={[
                { key: "edit", label: FORMS_COPY.tabEdit },
                { key: "preview", label: FORMS_COPY.tabPreview },
              ]}
              value={tab}
              onChange={setTab}
              accessibilityLabel="Edit or preview"
            />
            {tab === "edit" ? editColumn : previewColumn}
          </>
        )}
      </>
    );
  }

  return (
    <View style={styles.host}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
      <ConfirmDialog
        visible={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleClose}
        title={FORMS_COPY.closeConfirmTitle}
        description={FORMS_COPY.closeConfirmBody}
        confirmLabel={FORMS_COPY.closeForm}
        cancelLabel={FORMS_COPY.keepOpen}
        confirmLoading={close.isPending}
        testID="brand-form-close-dialog"
      />
      <ConfirmDialog
        visible={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={handleArchive}
        title="Archive this form?"
        description="It leaves your list. Answers are kept. A form still on a page can't be archived until you remove it."
        confirmLabel="Archive form"
        cancelLabel="Keep it"
        destructive
        confirmLoading={archive.isPending}
        testID="brand-form-archive-dialog"
      />
      {earlierQueue.length > 0 && formId !== null ? (
        <FormRequestSheet
          key={earlierQueue[0].eventId}
          visible
          onClose={() => setEarlierQueue((q) => q.slice(1))}
          formId={formId}
          eventId={earlierQueue[0].eventId}
          mode="earlier"
          earlierCount={earlierQueue[0].count}
          eventTitle={detail.data?.attachments.find((a) => a.eventId === earlierQueue[0].eventId)?.eventName ?? null}
          notify={show}
        />
      ) : null}
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: 140,
    gap: space[3],
  },
  center: { paddingVertical: space[8], alignItems: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: space[2] },
  nameInput: {
    flex: 1,
    minHeight: 44,
    ...type.title,
    color: color.text1,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  version: { ...type.caption, color: color.text3 },
  actions: { flexDirection: "row", gap: space[2], marginLeft: "auto", flexWrap: "wrap" },
  cols: { flexDirection: "row", gap: space[5], alignItems: "flex-start" },
  colEdit: { flex: 1, minWidth: 0 },
  colPreview: { flex: 1, minWidth: 0 },
  column: { gap: space[3] },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space[3],
  },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  switchLine: { ...type.small, color: color.text2 },
  switchSub: { ...type.caption, color: color.text3 },
});
